export type ViewMode =
  | 'normal'
  | 'opacity'
  | 'density'
  | 'overdraw'
  | 'projectedSize'
  | 'outliers'
  | 'dead'
  | 'blurRisk'
  | 'simplificationPreview';

export interface SplatScene {
  name: string;
  count: number;
  positions: Float32Array;
  scales: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  rotations: Float32Array;
  sourceIndices: Uint32Array;
  bounds: Bounds3;
  metrics: SceneMetrics;
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  radius: number;
}

export interface SceneMetrics {
  center: Vec3;
  averageScale: number;
  maxScale: number;
  averageOpacity: number;
  density: Float32Array;
  outlierScore: Float32Array;
  deadScore: Float32Array;
  blurRisk: Float32Array;
}

export interface CameraState {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

export interface DiagnosticThresholds {
  opacityFloor: number;
  outlierPercentile: number;
}

export interface ViewEstimate {
  projectedSizeP50: number;
  projectedSizeP95: number;
  overdrawScore: number;
  soupRisk: number;
  estimatedMs: number;
  flaggedSplats: number;
}

export interface StressSample extends ViewEstimate {
  label: string;
  camera: CameraState;
}

export type Vec3 = [number, number, number];

export const VIEW_LABELS: Record<ViewMode, string> = {
  normal: 'Normal',
  opacity: 'Opacity',
  density: 'Density',
  overdraw: 'Overdraw',
  projectedSize: 'Size',
  outliers: 'Floaters',
  dead: 'Dead',
  blurRisk: 'Soup',
  simplificationPreview: 'Simplify',
};

export const DEFAULT_THRESHOLDS: DiagnosticThresholds = {
  opacityFloor: 0.08,
  outlierPercentile: 0.96,
};
