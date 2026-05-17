import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Camera,
  Eye,
  Flame,
  Gauge,
  GitCompare,
  Layers,
  MousePointer2,
  Radar,
  ScanSearch,
  Sparkles,
  Upload,
} from 'lucide-react';
import { type CSSProperties, type HTMLAttributes, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeDemoScene } from './domain/demoScene';
import { estimateView, runStressTest } from './domain/metrics';
import { DEFAULT_THRESHOLDS, VIEW_LABELS, type CameraState, type DiagnosticThresholds, type SplatScene, type ViewMode } from './domain/types';
import { useLocalStorageState } from './hooks/useLocalStorage';
import { parseSplatFile } from './io/parsers';
import { drawCanvasFallback } from './render/canvasFallback';
import { WebGpuSplatRenderer } from './render/webgpuRenderer';
import './styles.css';

const VIEW_ICONS: Record<ViewMode, typeof Eye> = {
  normal: Eye,
  opacity: Sparkles,
  density: Boxes,
  overdraw: Flame,
  projectedSize: BarChart3,
  outliers: Radar,
  dead: AlertTriangle,
  blurRisk: ScanSearch,
  simplificationPreview: GitCompare,
};

const VIEW_MODES = Object.keys(VIEW_LABELS) as ViewMode[];

const VIEW_DESCRIPTIONS: Record<ViewMode, string> = {
  normal: 'Composite splats with their source colors and opacity. Use this as the baseline before switching to a diagnostic overlay.',
  opacity: 'Maps each splat by alpha contribution. Bright hot regions are carrying the image; dark regions barely affect the final frame.',
  density: 'Shows where many splats occupy the same local volume. Dense clusters often explain cloudy regions or slow views.',
  overdraw: 'Highlights areas likely to blend many translucent splats over the same pixels. Hot regions are expensive and may look muddy.',
  projectedSize: 'Colors splats by their screen-space footprint from the current camera. Oversized splats are common soup and blur culprits.',
  outliers: 'Flags spatial floaters far from the scene mass. These are candidates for cleanup or simplification masks.',
  dead: 'Finds low-opacity, low-density splats that contribute little to the image. These are early simplification candidates.',
  blurRisk: 'Combines size, opacity, and outlier signals to answer why this angle looks like soup.',
  simplificationPreview: 'Previews which splats would be faded by the current thresholds. This is reversible and does not export changes.',
};

const THRESHOLD_DESCRIPTIONS: Record<keyof DiagnosticThresholds, string> = {
  opacityFloor: 'Splats below this alpha are treated as low contribution and become candidates for dead-splat and simplification views.',
  outlierPercentile: 'Controls how aggressively far-away splats are flagged as floaters. Lower values mark more splats as outliers.',
  simplificationAggression: 'Adjusts how strongly the preview fades dead, low-contribution, and outlier splats.',
};

const DEFAULT_CAMERA: CameraState = {
  target: [0, 0, 0],
  yaw: 0.6,
  pitch: 0.28,
  distance: 4,
  fov: 55,
};

interface PersistedUi {
  viewMode: ViewMode;
  thresholds: DiagnosticThresholds;
  camera: CameraState;
}

interface TooltipState {
  text: string;
  x: number;
  y: number;
  side: 'top' | 'bottom';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGpuSplatRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; camera: CameraState } | null>(null);
  const liveCameraRef = useRef<CameraState>(DEFAULT_CAMERA);
  const pendingCameraRef = useRef<CameraState | null>(null);
  const frameRef = useRef<number | null>(null);
  const [ui, setUi] = useLocalStorageState<PersistedUi>('splatdoc-ui', {
    viewMode: 'normal',
    thresholds: DEFAULT_THRESHOLDS,
    camera: DEFAULT_CAMERA,
  });
  const [scene, setScene] = useState<SplatScene>(() => makeDemoScene());
  const [status, setStatus] = useState('Generated demo scene loaded. Drop a .ply or .splat to inspect your own.');
  const [webGpuError, setWebGpuError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const estimate = useMemo(() => estimateView(scene, ui.camera, ui.thresholds), [scene, ui.camera, ui.thresholds]);
  const stressCamera = useMemo<CameraState>(() => ({
    target: scene.bounds.center,
    yaw: 0,
    pitch: 0,
    distance: scene.bounds.radius * 2.8,
    fov: ui.camera.fov,
  }), [scene, ui.camera.fov]);
  const stress = useMemo(() => runStressTest(scene, stressCamera, ui.thresholds), [scene, stressCamera, ui.thresholds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const renderer = new WebGpuSplatRenderer(canvas, ui.thresholds);
    rendererRef.current = renderer;
    withTimeout(renderer.init(), 2200)
      .then(() => {
        if (disposed) return;
        renderer.setScene(scene);
        renderer.setViewMode(ui.viewMode);
        renderer.render(ui.camera);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        renderer.dispose();
        rendererRef.current = null;
        setWebGpuError(error instanceof Error ? error.message : 'WebGPU initialization failed.');
        drawCanvasFallback(canvas, scene, ui.camera, ui.viewMode, ui.thresholds);
      });
    return () => {
      disposed = true;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    renderer?.setScene(scene);
    if (renderer) renderer.render(ui.camera);
    else if (canvasRef.current) drawCanvasFallback(canvasRef.current, scene, ui.camera, ui.viewMode, ui.thresholds);
  }, [scene]);

  useEffect(() => {
    liveCameraRef.current = ui.camera;
    const renderer = rendererRef.current;
    renderer?.setViewMode(ui.viewMode);
    renderer?.setThresholds(ui.thresholds);
    if (renderer) renderer.render(ui.camera);
    else if (canvasRef.current) drawCanvasFallback(canvasRef.current, scene, ui.camera, ui.viewMode, ui.thresholds);
  }, [ui]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const renderer = rendererRef.current;
      if (renderer) renderer.render(ui.camera);
      else if (canvasRef.current) drawCanvasFallback(canvasRef.current, scene, ui.camera, ui.viewMode, ui.thresholds);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ui.camera]);

  const updateUi = useCallback((patch: Partial<PersistedUi>) => {
    setUi({ ...ui, ...patch });
  }, [setUi, ui]);

  const updateThresholds = useCallback((thresholds: DiagnosticThresholds) => {
    setUi({ ...ui, thresholds, viewMode: 'simplificationPreview' });
  }, [setUi, ui]);

  const showTooltip = useCallback((text: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const x = Math.min(window.innerWidth - width / 2 - 12, Math.max(width / 2 + 12, rect.left + rect.width / 2));
    const showBelow = rect.top < 96;
    setTooltip({
      text,
      x,
      y: showBelow ? rect.bottom + 12 : rect.top - 12,
      side: showBelow ? 'bottom' : 'top',
    });
  }, []);

  const tooltipProps = useCallback((text: string): HTMLAttributes<HTMLElement> & { 'data-tooltip': string } => ({
    'data-tooltip': text,
    onBlur: () => setTooltip(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) => showTooltip(text, event.currentTarget),
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => showTooltip(text, event.currentTarget),
    onMouseLeave: () => setTooltip(null),
  }), [showTooltip]);

  const renderPreviewCamera = useCallback((camera: CameraState) => {
    pendingCameraRef.current = camera;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const nextCamera = pendingCameraRef.current;
      if (!nextCamera) return;
      const renderer = rendererRef.current;
      if (renderer) renderer.render(nextCamera);
      else if (canvasRef.current) drawCanvasFallback(canvasRef.current, scene, nextCamera, ui.viewMode, ui.thresholds);
    });
  }, [scene, ui.thresholds, ui.viewMode]);

  const loadFile = useCallback(async (file: File) => {
    setStatus(`Loading ${file.name}...`);
    try {
      const parsed = await parseSplatFile(file);
      setScene(parsed);
      updateUi({ camera: { ...DEFAULT_CAMERA, target: parsed.bounds.center, distance: parsed.bounds.radius * 2.8 } });
      setStatus(`${file.name}: ${parsed.count.toLocaleString()} splats normalized for diagnostics.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load file.');
    }
  }, [updateUi]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, camera: ui.camera };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    const camera = {
      ...dragRef.current.camera,
      yaw: dragRef.current.camera.yaw + dx * 0.008,
      pitch: Math.max(-1.35, Math.min(1.35, dragRef.current.camera.pitch + dy * 0.006)),
    };
    liveCameraRef.current = camera;
    renderPreviewCamera(camera);
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    updateUi({ camera: liveCameraRef.current });
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    updateUi({ camera: { ...ui.camera, distance: Math.max(scene.bounds.radius * 0.5, ui.camera.distance * (1 + event.deltaY * 0.001)) } });
  };

  return (
    <main className="app-shell">
      <aside className="left-rail">
        <div className="brand">
          <div className="brand-mark"><Layers size={18} /></div>
          <div>
            <h1>SplatDoc</h1>
            <p>Diagnostic view for Gaussian splats</p>
          </div>
        </div>

        <label className="drop-zone" onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void loadFile(file);
        }} onDragOver={(event) => event.preventDefault()}>
          <Upload size={20} />
          <span>Drop .ply or .splat</span>
          <input aria-label="Load splat file" type="file" accept=".ply,.splat" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
          }} />
        </label>

        <section className="panel">
          <h2>View</h2>
          <div className="mode-grid">
            {VIEW_MODES.map((mode) => {
              const Icon = VIEW_ICONS[mode];
              return (
                <button
                  key={mode}
                  className={mode === ui.viewMode ? 'mode active' : 'mode'}
                  aria-label={`${VIEW_LABELS[mode]} view: ${VIEW_DESCRIPTIONS[mode]}`}
                  {...tooltipProps(VIEW_DESCRIPTIONS[mode])}
                  onClick={() => updateUi({ viewMode: mode })}
                >
                  <Icon size={17} />
                  <span>{VIEW_LABELS[mode]}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Thresholds</h2>
          <Slider label="Opacity floor" description={THRESHOLD_DESCRIPTIONS.opacityFloor} tooltipProps={tooltipProps(THRESHOLD_DESCRIPTIONS.opacityFloor)} value={ui.thresholds.opacityFloor} min={0} max={0.5} step={0.01} onChange={(value) => updateThresholds({ ...ui.thresholds, opacityFloor: value })} />
          <Slider label="Outlier cutoff" description={THRESHOLD_DESCRIPTIONS.outlierPercentile} tooltipProps={tooltipProps(THRESHOLD_DESCRIPTIONS.outlierPercentile)} value={ui.thresholds.outlierPercentile} min={0.75} max={1} step={0.01} onChange={(value) => updateThresholds({ ...ui.thresholds, outlierPercentile: value })} />
          <Slider label="Simplify" description={THRESHOLD_DESCRIPTIONS.simplificationAggression} tooltipProps={tooltipProps(THRESHOLD_DESCRIPTIONS.simplificationAggression)} value={ui.thresholds.simplificationAggression} min={0} max={1} step={0.01} onChange={(value) => updateThresholds({ ...ui.thresholds, simplificationAggression: value })} />
        </section>
      </aside>

      <section className="viewport-wrap">
        <div className="top-bar">
          <div>
            <strong>{scene.name}</strong>
            <span>{scene.count.toLocaleString()} splats</span>
          </div>
          <div className="status" {...tooltipProps('Drag the viewport to orbit the current camera. Use the mouse wheel or trackpad scroll to zoom toward or away from the scene.')}><MousePointer2 size={15} /> drag orbit · wheel zoom</div>
        </div>
        <div className="canvas-stage">
          <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} />
          {webGpuError && <div className="gpu-fallback"><AlertTriangle size={14} />CPU preview · {webGpuError}</div>}
        </div>
        <p className="load-status">{status}</p>
      </section>

      <aside className="right-rail">
        <section className="panel hero-metric">
          <h2><Gauge size={17} /> View Estimate</h2>
          <div className="metric-row" {...tooltipProps('Rough CPU/GPU cost estimate for this viewpoint based on splat count, projected size, and overdraw.')}><span>Frame cost</span><strong>{estimate.estimatedMs.toFixed(1)} ms</strong></div>
          <div className="metric-row" {...tooltipProps('Approximate chance that this angle will look cloudy or smeared because of large, dense, or suspicious splats.')}><span>Soup risk</span><strong>{Math.round(estimate.soupRisk * 100)}%</strong></div>
          <div className="metric-row" {...tooltipProps('Estimated repeated blending work for the current camera. Higher overdraw means more translucent splats pile onto the same pixels.')}><span>Overdraw</span><strong>{Math.round(estimate.overdrawScore * 100)}%</strong></div>
          <div className="metric-row" {...tooltipProps('Number of splats currently caught by opacity, outlier, or dead-splat thresholds.')}><span>Flagged</span><strong>{estimate.flaggedSplats.toLocaleString()}</strong></div>
        </section>

        <section className="panel">
          <h2><BarChart3 size={17} /> Distribution</h2>
          <Histogram values={[
            scene.metrics.averageOpacity,
            scene.metrics.averageScale / Math.max(scene.metrics.maxScale, 0.0001),
            estimate.projectedSizeP50 / 50,
            estimate.projectedSizeP95 / 80,
            estimate.overdrawScore,
            estimate.soupRisk,
          ]} />
          <div className="mini-grid">
            <span {...tooltipProps('Median projected splat radius in pixels from the current camera.')}><span>P50 size</span> <b>{estimate.projectedSizeP50.toFixed(1)}px</b></span>
            <span {...tooltipProps('95th percentile projected splat radius in pixels. Big values point to blur and soup risk.')}><span>P95 size</span> <b>{estimate.projectedSizeP95.toFixed(1)}px</b></span>
          </div>
        </section>

        <section className="panel stress">
          <h2><Camera size={17} /> Stress Path</h2>
          {stress.slice(0, 4).map((sample) => (
            <button key={sample.label} {...tooltipProps('Jump to a sampled camera angle ranked by combined soup and overdraw risk.')} onClick={() => updateUi({ camera: sample.camera })}>
              <span>{sample.label}</span>
              <b>{Math.round((sample.soupRisk + sample.overdrawScore) * 50)} risk</b>
            </button>
          ))}
        </section>
      </aside>
      <TooltipOverlay tooltip={tooltip} />
    </main>
  );
}

function Slider({
  label,
  description,
  tooltipProps,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  description: string;
  tooltipProps: HTMLAttributes<HTMLElement> & { 'data-tooltip': string };
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider" {...tooltipProps}>
      <span>{label}<b>{value.toFixed(2)}</b></span>
      <input type="range" aria-label={`${label}: ${description}`} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TooltipOverlay({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  const style = {
    '--tooltip-x': `${tooltip.x}px`,
    '--tooltip-y': `${tooltip.y}px`,
  } as CSSProperties;
  return (
    <div className={`tooltip-layer ${tooltip.side}`} style={style} role="tooltip">
      {tooltip.text}
    </div>
  );
}

function Histogram({ values }: { values: number[] }) {
  return (
    <div className="histogram" aria-label="Diagnostic distribution">
      {values.map((value, index) => <i key={index} style={{ height: `${Math.max(8, Math.min(100, value * 100))}%` }} />)}
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('WebGPU adapter request timed out. Showing CPU preview.')), timeoutMs);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}
