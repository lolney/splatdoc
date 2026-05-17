import { clamp01, dot, viewBasis } from '../domain/math';
import type { CameraState, DiagnosticThresholds, SplatScene, ViewMode } from '../domain/types';

export function drawCanvasFallback(
  canvas: HTMLCanvasElement,
  scene: SplatScene,
  camera: CameraState,
  mode: ViewMode,
  thresholds: DiagnosticThresholds,
): void {
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const { eye, forward, right, up } = viewBasis(camera);
  const fovScale = 1 / Math.tan((camera.fov * Math.PI / 180) / 2);
  const items: Array<{ x: number; y: number; r: number; depth: number; color: string; alpha: number; fade: number }> = [];
  const step = Math.max(1, Math.floor(scene.count / 9000));

  for (let i = 0; i < scene.count; i += step) {
    const px = scene.positions[i * 3];
    const py = scene.positions[i * 3 + 1];
    const pz = scene.positions[i * 3 + 2];
    const toPoint: [number, number, number] = [px - eye[0], py - eye[1], pz - eye[2]];
    const depth = dot(toPoint, forward);
    if (depth <= 0.01) continue;
    const x = (dot(toPoint, right) * fovScale / depth) * height + width / 2;
    const y = (-dot(toPoint, up) * fovScale / depth) * height + height / 2;
    if (x < -80 || x > width + 80 || y < -80 || y > height + 80) continue;
    const size = Math.max(scene.scales[i * 3], scene.scales[i * 3 + 1], scene.scales[i * 3 + 2]);
    const r = Math.max(1.2, Math.min(42, (size * fovScale / depth) * height));
    const metric = metricFor(scene, i, mode, thresholds);
    const fade = thresholdSignal(scene, i, mode, thresholds);
    const color = mode === 'normal' ? rgb(scene.colors[i * 3], scene.colors[i * 3 + 1], scene.colors[i * 3 + 2]) : heat(metric);
    items.push({ x, y, r, depth, color, alpha: scene.opacities[i] * (mode === 'normal' ? 0.72 : 0.84), fade });
  }

  items.sort((a, b) => b.depth - a.depth);
  ctx.globalCompositeOperation = 'lighter';
  for (const item of items) {
    const alpha = mode === 'simplificationPreview'
      ? item.alpha * (1 - item.fade * 0.92)
      : mode !== 'normal' && item.fade <= 0
        ? item.alpha * 0.34
        : item.alpha;
    ctx.globalAlpha = alpha;
    const gradient = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.r);
    gradient.addColorStop(0, item.color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = '#090b0c';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function metricFor(scene: SplatScene, i: number, mode: ViewMode, thresholds: DiagnosticThresholds): number {
  const size = Math.max(scene.scales[i * 3], scene.scales[i * 3 + 1], scene.scales[i * 3 + 2]);
  if (mode === 'opacity') return scene.opacities[i];
  if (mode === 'density') return scene.metrics.density[i];
  if (mode === 'outliers') return scene.metrics.outlierScore[i];
  if (mode === 'dead') return scene.metrics.deadScore[i];
  if (mode === 'blurRisk') return scene.metrics.blurRisk[i];
  if (mode === 'projectedSize') return clamp01(size / Math.max(scene.metrics.averageScale * 4, 0.0001));
  if (mode === 'overdraw') return clamp01(scene.opacities[i] * scene.metrics.density[i] + size / Math.max(scene.bounds.radius * 0.08, 0.0001));
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
  const metric = metricFor(scene, i, mode, thresholds);
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

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function heat(value: number): string {
  const v = clamp01(value);
  const r = v < 0.55 ? 40 + v * 360 : 238 + v * 17;
  const g = v < 0.6 ? 116 + v * 210 : 212 - v * 110;
  const b = v < 0.45 ? 245 - v * 110 : 70 - v * 45;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.max(25, Math.round(b))})`;
}
