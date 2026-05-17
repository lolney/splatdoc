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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGpuSplatRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; camera: CameraState } | null>(null);
  const [ui, setUi] = useLocalStorageState<PersistedUi>('splatdoc-ui', {
    viewMode: 'normal',
    thresholds: DEFAULT_THRESHOLDS,
    camera: DEFAULT_CAMERA,
  });
  const [scene, setScene] = useState<SplatScene>(() => makeDemoScene());
  const [status, setStatus] = useState('Generated demo scene loaded. Drop a .ply or .splat to inspect your own.');
  const [webGpuError, setWebGpuError] = useState<string | null>(null);
  const estimate = useMemo(() => estimateView(scene, ui.camera, ui.thresholds), [scene, ui.camera, ui.thresholds]);
  const stress = useMemo(() => runStressTest(scene, ui.camera, ui.thresholds), [scene, ui.camera, ui.thresholds]);

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
    const renderer = rendererRef.current;
    renderer?.setViewMode(ui.viewMode);
    renderer?.setThresholds(ui.thresholds);
    if (renderer) renderer.render(ui.camera);
    else if (canvasRef.current) drawCanvasFallback(canvasRef.current, scene, ui.camera, ui.viewMode, ui.thresholds);
  }, [ui]);

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
    updateUi({
      camera: {
        ...dragRef.current.camera,
        yaw: dragRef.current.camera.yaw + dx * 0.008,
        pitch: Math.max(-1.35, Math.min(1.35, dragRef.current.camera.pitch + dy * 0.006)),
      },
    });
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
                  title={VIEW_LABELS[mode]}
                  aria-label={`${VIEW_LABELS[mode]} view`}
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
          <Slider label="Opacity floor" value={ui.thresholds.opacityFloor} min={0} max={0.5} step={0.01} onChange={(value) => updateUi({ thresholds: { ...ui.thresholds, opacityFloor: value } })} />
          <Slider label="Outlier cutoff" value={ui.thresholds.outlierPercentile} min={0.75} max={1} step={0.01} onChange={(value) => updateUi({ thresholds: { ...ui.thresholds, outlierPercentile: value } })} />
          <Slider label="Simplify" value={ui.thresholds.simplificationAggression} min={0} max={1} step={0.01} onChange={(value) => updateUi({ thresholds: { ...ui.thresholds, simplificationAggression: value } })} />
        </section>
      </aside>

      <section className="viewport-wrap">
        <div className="top-bar">
          <div>
            <strong>{scene.name}</strong>
            <span>{scene.count.toLocaleString()} splats</span>
          </div>
          <div className="status"><MousePointer2 size={15} /> drag orbit · wheel zoom</div>
        </div>
        <div className="canvas-stage">
          <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null; }} onWheel={onWheel} />
          {webGpuError && <div className="gpu-fallback"><AlertTriangle size={14} />CPU preview · {webGpuError}</div>}
        </div>
        <p className="load-status">{status}</p>
      </section>

      <aside className="right-rail">
        <section className="panel hero-metric">
          <h2><Gauge size={17} /> View Estimate</h2>
          <div className="metric-row"><span>Frame cost</span><strong>{estimate.estimatedMs.toFixed(1)} ms</strong></div>
          <div className="metric-row"><span>Soup risk</span><strong>{Math.round(estimate.soupRisk * 100)}%</strong></div>
          <div className="metric-row"><span>Overdraw</span><strong>{Math.round(estimate.overdrawScore * 100)}%</strong></div>
          <div className="metric-row"><span>Flagged</span><strong>{estimate.flaggedSplats.toLocaleString()}</strong></div>
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
            <span>P50 size <b>{estimate.projectedSizeP50.toFixed(1)}px</b></span>
            <span>P95 size <b>{estimate.projectedSizeP95.toFixed(1)}px</b></span>
          </div>
        </section>

        <section className="panel stress">
          <h2><Camera size={17} /> Stress Path</h2>
          {stress.slice(0, 4).map((sample) => (
            <button key={sample.label} onClick={() => updateUi({ camera: sample.camera })}>
              <span>{sample.label}</span>
              <b>{Math.round((sample.soupRisk + sample.overdrawScore) * 50)} risk</b>
            </button>
          ))}
        </section>
      </aside>
    </main>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="slider">
      <span>{label}<b>{value.toFixed(2)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
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
