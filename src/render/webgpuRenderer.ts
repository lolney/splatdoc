import { clamp01, viewBasis } from '../domain/math';
import type { CameraState, DiagnosticThresholds, SplatScene, ViewMode } from '../domain/types';

const SPLAT_STRIDE = 12 * 4;
const UNIFORM_SIZE = 32 * 4;

export class WebGpuSplatRenderer {
  private adapter?: GPUAdapter;
  private device?: GPUDevice;
  private context?: GPUCanvasContext;
  private format?: GPUTextureFormat;
  private pipeline?: GPURenderPipeline;
  private bindGroup?: GPUBindGroup;
  private uniformBuffer?: GPUBuffer;
  private splatBuffer?: GPUBuffer;
  private scene?: SplatScene;
  private viewMode: ViewMode = 'normal';
  private thresholds: DiagnosticThresholds;
  private sortedData?: Float32Array;
  private lastSortKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    thresholds: DiagnosticThresholds,
  ) {
    this.thresholds = thresholds;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available in this browser. Try a current Chrome or Edge build.');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was found.');
    this.adapter = adapter;
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext | null ?? undefined;
    if (!this.context) throw new Error('Could not create a WebGPU canvas context.');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
    this.createPipeline();
  }

  setScene(scene?: SplatScene): void {
    this.scene = scene;
    this.sortedData = undefined;
    this.lastSortKey = '';
  }

  setViewMode(viewMode: ViewMode): void {
    if (this.viewMode === viewMode) return;
    this.viewMode = viewMode;
    this.sortedData = undefined;
    this.lastSortKey = '';
  }

  setThresholds(thresholds: DiagnosticThresholds): void {
    if (
      this.thresholds.opacityFloor === thresholds.opacityFloor
      && this.thresholds.densityCutoff === thresholds.densityCutoff
      && this.thresholds.overdrawCutoff === thresholds.overdrawCutoff
      && this.thresholds.projectedSizeCutoff === thresholds.projectedSizeCutoff
      && this.thresholds.outlierPercentile === thresholds.outlierPercentile
      && this.thresholds.deadCutoff === thresholds.deadCutoff
      && this.thresholds.blurRiskCutoff === thresholds.blurRiskCutoff
    ) {
      return;
    }
    this.thresholds = thresholds;
    this.sortedData = undefined;
    this.lastSortKey = '';
  }

  render(camera: CameraState): void {
    if (!this.device || !this.context || !this.pipeline || !this.uniformBuffer || !this.scene) return;
    this.resize();
    this.uploadScene(camera);
    this.uploadUniforms(camera);
    if (!this.bindGroup || !this.splatBuffer) return;

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.025, g: 0.028, b: 0.032, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.scene.count);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.splatBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }

  private resize(): void {
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private createPipeline(): void {
    if (!this.device || !this.format) return;
    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const module = this.device.createShaderModule({ code: shader });
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private uploadUniforms(camera: CameraState): void {
    if (!this.device || !this.scene || !this.uniformBuffer) return;
    const { eye, forward, right, up } = viewBasis(camera);
    const aspect = Math.max(0.1, this.canvas.width / Math.max(1, this.canvas.height));
    const uniform = new Float32Array(32);
    uniform.set(eye, 0);
    uniform.set(right, 4);
    uniform.set(up, 8);
    uniform.set(forward, 12);
    uniform[16] = 1 / Math.tan((camera.fov * Math.PI / 180) / 2);
    uniform[17] = aspect;
    uniform[18] = this.scene.bounds.radius;
    uniform[19] = this.scene.count;
    uniform[20] = this.viewModeToNumber(this.viewMode);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniform.buffer as ArrayBuffer, uniform.byteOffset, uniform.byteLength);
  }

  private uploadScene(camera: CameraState): void {
    if (!this.device || !this.pipeline || !this.uniformBuffer || !this.scene) return;
    const sortKey = `${this.scene.name}:${this.scene.count}:${this.viewMode}:${Object.values(this.thresholds).join(':')}`;
    if (this.sortedData && sortKey === this.lastSortKey) return;
    const data = this.buildDisplayData();
    this.splatBuffer?.destroy();
    this.splatBuffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.splatBuffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.splatBuffer } },
      ],
    });
    this.sortedData = data;
    this.lastSortKey = sortKey;
  }

  private buildDisplayData(): Float32Array {
    const scene = this.scene!;
    const data = new Float32Array(scene.count * 12);
    for (let i = 0; i < scene.count; i++) {
      const maxScale = Math.max(scene.scales[i * 3], scene.scales[i * 3 + 1], scene.scales[i * 3 + 2]);
      const alpha = scene.opacities[i];
      const metric = metricForMode(scene, i, this.viewMode, this.thresholds);
      const base = i * 12;
      data[base] = scene.positions[i * 3];
      data[base + 1] = scene.positions[i * 3 + 1];
      data[base + 2] = scene.positions[i * 3 + 2];
      data[base + 3] = maxScale;
      data[base + 4] = scene.colors[i * 3];
      data[base + 5] = scene.colors[i * 3 + 1];
      data[base + 6] = scene.colors[i * 3 + 2];
      data[base + 7] = alpha;
      data[base + 8] = metric;
      data[base + 9] = 0;
      data[base + 10] = scene.sourceIndices[i];
      data[base + 11] = thresholdSignal(scene, i, this.viewMode, this.thresholds);
    }
    return data;
  }

  private viewModeToNumber(mode: ViewMode): number {
    return ['normal', 'opacity', 'density', 'overdraw', 'projectedSize', 'outliers', 'dead', 'blurRisk', 'simplificationPreview'].indexOf(mode);
  }
}

function metricForMode(scene: SplatScene, i: number, mode: ViewMode, thresholds: DiagnosticThresholds): number {
  const scale = Math.max(scene.scales[i * 3], scene.scales[i * 3 + 1], scene.scales[i * 3 + 2]);
  if (mode === 'opacity') return scene.opacities[i];
  if (mode === 'density') return scene.metrics.density[i];
  if (mode === 'outliers') return scene.metrics.outlierScore[i];
  if (mode === 'dead') return scene.metrics.deadScore[i];
  if (mode === 'blurRisk') return scene.metrics.blurRisk[i];
  if (mode === 'projectedSize') return clamp01(scale / Math.max(scene.metrics.averageScale * 4, 0.0001));
  if (mode === 'overdraw') return clamp01(scene.opacities[i] * scene.metrics.density[i] + scale / Math.max(scene.bounds.radius * 0.08, 0.0001));
  if (mode === 'simplificationPreview') return simplificationScore(scene, i, thresholds);
  return 0;
}

function simplificationScore(scene: SplatScene, i: number, thresholds: DiagnosticThresholds): number {
  return clamp01(Math.max(
    thresholdSignal(scene, i, 'opacity', thresholds),
    thresholdSignal(scene, i, 'density', thresholds),
    thresholdSignal(scene, i, 'overdraw', thresholds),
    thresholdSignal(scene, i, 'projectedSize', thresholds),
    thresholdSignal(scene, i, 'outliers', thresholds),
    thresholdSignal(scene, i, 'dead', thresholds),
    thresholdSignal(scene, i, 'blurRisk', thresholds),
  ));
}

function thresholdSignal(scene: SplatScene, i: number, mode: ViewMode, thresholds: DiagnosticThresholds): number {
  if (mode === 'simplificationPreview') {
    const risk = simplificationScore(scene, i, thresholds);
    return risk <= 0 ? 0 : clamp01(0.22 + risk * 0.68);
  }
  const metric = metricForMode(scene, i, mode, thresholds);
  if (mode === 'opacity') {
    if (thresholds.opacityFloor <= 0 || metric >= thresholds.opacityFloor) return 0;
    return clamp01(0.25 + ((thresholds.opacityFloor - metric) / Math.max(thresholds.opacityFloor, 0.001)) * 0.75);
  }
  const cutoff = cutoffForMode(mode, thresholds);
  if (cutoff === undefined || metric <= cutoff) return 0;
  return clamp01(0.25 + ((metric - cutoff) / Math.max(1 - cutoff, 0.001)) * 0.75);
}

function cutoffForMode(mode: ViewMode, thresholds: DiagnosticThresholds): number | undefined {
  if (mode === 'density') return thresholds.densityCutoff;
  if (mode === 'overdraw') return thresholds.overdrawCutoff;
  if (mode === 'projectedSize') return thresholds.projectedSizeCutoff;
  if (mode === 'outliers') return thresholds.outlierPercentile;
  if (mode === 'dead') return thresholds.deadCutoff;
  if (mode === 'blurRisk') return thresholds.blurRiskCutoff;
  return undefined;
}

const shader = /* wgsl */ `
struct Uniforms {
  eye: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  forward: vec4<f32>,
  fovScale: f32,
  aspect: f32,
  radius: f32,
  count: f32,
  viewMode: f32,
};

struct Splat {
  positionScale: vec4<f32>,
  colorOpacity: vec4<f32>,
  metricDepthIndexHidden: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) metric: f32,
  @location(3) hidden: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> splats: array<Splat>;

fn quad(vertexIndex: u32) -> vec2<f32> {
  let verts = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  return verts[vertexIndex];
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let splat = splats[instanceIndex];
  let local = quad(vertexIndex);
  let world = splat.positionScale.xyz;
  let toPoint = world - uniforms.eye.xyz;
  let x = dot(toPoint, uniforms.right.xyz);
  let y = dot(toPoint, uniforms.up.xyz);
  let z = max(0.01, dot(toPoint, uniforms.forward.xyz));
  let baseSize = max(0.002, splat.positionScale.w);
  let pixelish = clamp(baseSize * uniforms.fovScale / z, 0.0015, 0.16);
  var out: VertexOut;
  out.position = vec4<f32>(
    (x * uniforms.fovScale / z + local.x * pixelish) / uniforms.aspect,
    y * uniforms.fovScale / z + local.y * pixelish,
    1.0 - clamp(z / max(uniforms.radius * 8.0, 0.01), 0.0, 1.0),
    1.0
  );
  out.uv = local;
  out.color = splat.colorOpacity;
  out.metric = splat.metricDepthIndexHidden.x;
  out.hidden = splat.metricDepthIndexHidden.w;
  return out;
}

fn heat(value: f32) -> vec3<f32> {
  let v = clamp(value, 0.0, 1.0);
  let cold = vec3<f32>(0.08, 0.33, 0.95);
  let mid = vec3<f32>(0.98, 0.78, 0.18);
  let hot = vec3<f32>(1.0, 0.16, 0.08);
  return mix(mix(cold, mid, smoothstep(0.0, 0.62, v)), hot, smoothstep(0.55, 1.0, v));
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let r2 = dot(input.uv, input.uv);
  let gaussian = exp(-2.7 * r2);
  if (gaussian < 0.025) {
    discard;
  }
  var color = input.color.rgb;
  var alpha = input.color.a * gaussian;
  if (uniforms.viewMode > 7.5) {
    let fade = clamp(input.hidden, 0.0, 1.0);
    let warm = vec3<f32>(1.0, 0.48, 0.16);
    color = mix(input.color.rgb, warm, fade * 0.62);
    alpha = input.color.a * gaussian * mix(1.08, 0.92, fade);
  } else if (uniforms.viewMode > 0.5) {
    color = heat(input.metric);
    alpha = max(0.08, input.color.a) * gaussian * 0.92;
    if (input.hidden <= 0.0) {
      color = mix(color, vec3<f32>(0.1, 0.12, 0.14), 0.72);
      alpha = alpha * 0.34;
    }
  }
  return vec4<f32>(color * alpha, alpha);
}
`;
