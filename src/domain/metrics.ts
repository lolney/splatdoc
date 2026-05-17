import { boundsFromPositions, clamp01, distance, dot, percentile, viewBasis } from './math';
import type { CameraState, DiagnosticThresholds, SceneMetrics, SplatScene, StressSample, Vec3, ViewEstimate } from './types';

export function createScene(
  name: string,
  positions: Float32Array,
  scales: Float32Array,
  colors: Float32Array,
  opacities: Float32Array,
  rotations?: Float32Array,
): SplatScene {
  const count = positions.length / 3;
  const bounds = boundsFromPositions(positions);
  const safeScales = scales.length === count * 3 ? scales : fillScales(count, bounds.radius * 0.01);
  const safeColors = colors.length === count * 3 ? colors : fillColors(count);
  const safeOpacities = opacities.length === count ? opacities : fillOpacities(count);
  return {
    name,
    count,
    positions,
    scales: safeScales,
    colors: safeColors,
    opacities: safeOpacities,
    rotations: rotations && rotations.length === count * 4 ? rotations : fillRotations(count),
    sourceIndices: sourceIndices(count),
    bounds,
    metrics: computeSceneMetrics(positions, safeScales, safeOpacities, bounds.center, bounds.radius),
  };
}

export function computeSceneMetrics(
  positions: Float32Array,
  scales: Float32Array,
  opacities: Float32Array,
  center: Vec3,
  radius: number,
): SceneMetrics {
  const count = opacities.length;
  const metricCenter = meanPosition(positions, center);
  const density = new Float32Array(count);
  const outlierScore = new Float32Array(count);
  const deadScore = new Float32Array(count);
  const blurRisk = new Float32Array(count);
  let scaleTotal = 0;
  let maxScale = 0;
  let opacityTotal = 0;
  const distances = new Float32Array(count);
  const densityGrid = buildDensityGrid(positions, metricCenter, radius);

  for (let i = 0; i < count; i++) {
    const s = Math.max(scales[i * 3], scales[i * 3 + 1], scales[i * 3 + 2]);
    const p: Vec3 = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const d = distance(p, metricCenter) / Math.max(radius, 0.0001);
    distances[i] = d;
    scaleTotal += s;
    maxScale = Math.max(maxScale, s);
    opacityTotal += opacities[i];
    blurRisk[i] = clamp01((s / Math.max(radius, 0.0001)) * 18 + opacities[i] * 0.2);
  }

  const sortedDistances = new Float32Array(distances);
  sortedDistances.sort();
  const p70 = sortedDistances[Math.min(count - 1, Math.max(0, Math.floor((count - 1) * 0.7)))] || 0;
  const p98 = sortedDistances[Math.min(count - 1, Math.max(0, Math.floor((count - 1) * 0.98)))] || 1;
  for (let i = 0; i < count; i++) {
    const local = densityFor(densityGrid, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    density[i] = local;
    outlierScore[i] = clamp01((distances[i] - p70) / Math.max(0.001, p98 - p70));
    deadScore[i] = clamp01((1 - opacities[i] * 6) * 0.72 + (1 - density[i] * 0.8) * 0.28);
  }

  return {
    center: metricCenter,
    averageScale: count ? scaleTotal / count : 0,
    maxScale,
    averageOpacity: count ? opacityTotal / count : 0,
    density: normalizeArray(density),
    outlierScore,
    deadScore,
    blurRisk,
  };
}

function meanPosition(positions: Float32Array, fallback: Vec3): Vec3 {
  const count = positions.length / 3;
  if (!count) return fallback;
  const total: Vec3 = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    total[0] += positions[i];
    total[1] += positions[i + 1];
    total[2] += positions[i + 2];
  }
  return [total[0] / count, total[1] / count, total[2] / count];
}

export function estimateView(scene: SplatScene, camera: CameraState, thresholds: DiagnosticThresholds): ViewEstimate {
  const { eye, forward } = viewBasis(camera);
  const projected: number[] = [];
  let overdraw = 0;
  let soup = 0;
  let flagged = 0;
  const sampleStep = Math.max(1, Math.floor(scene.count / 10000));
  const fovScale = 1 / Math.tan((camera.fov * Math.PI / 180) / 2);

  for (let i = 0; i < scene.count; i += sampleStep) {
    const p: Vec3 = [scene.positions[i * 3], scene.positions[i * 3 + 1], scene.positions[i * 3 + 2]];
    const toPoint: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const depth = Math.max(0.01, dot(toPoint, forward));
    const maxScale = Math.max(scene.scales[i * 3], scene.scales[i * 3 + 1], scene.scales[i * 3 + 2]);
    const size = (maxScale / depth) * fovScale * 900;
    projected.push(size);
    const alpha = scene.opacities[i];
    const sizeRisk = clamp01(size / 36);
    overdraw += sizeRisk * alpha;
    soup += (scene.metrics.blurRisk[i] * 0.45 + scene.metrics.outlierScore[i] * 0.2 + sizeRisk * 0.35) * alpha;
    if (alpha < thresholds.opacityFloor || scene.metrics.outlierScore[i] > thresholds.outlierPercentile || scene.metrics.deadScore[i] > 0.65) {
      flagged++;
    }
  }

  const sampleCount = Math.max(1, Math.ceil(scene.count / sampleStep));
  const projectedSizeP95 = percentile(projected, 0.95);
  const overdrawScore = clamp01(overdraw / sampleCount);
  const soupRisk = clamp01(soup / sampleCount);
  return {
    projectedSizeP50: percentile(projected, 0.5),
    projectedSizeP95,
    overdrawScore,
    soupRisk,
    estimatedMs: 1.4 + scene.count / 180000 + overdrawScore * 8 + projectedSizeP95 / 38,
    flaggedSplats: Math.round((flagged / sampleCount) * scene.count),
  };
}

export function runStressTest(scene: SplatScene, camera: CameraState, thresholds: DiagnosticThresholds): StressSample[] {
  const samples = [
    ['Front', 0, 0],
    ['Right', Math.PI / 2, 0.05],
    ['Back', Math.PI, 0],
    ['Left', -Math.PI / 2, -0.05],
    ['High', Math.PI / 4, 0.75],
    ['Low', -Math.PI / 4, -0.55],
  ] as const;
  return samples
    .map(([label, yaw, pitch]) => {
      const sampleCamera = { ...camera, yaw, pitch, target: scene.bounds.center, distance: scene.bounds.radius * 2.6 };
      return { label, camera: sampleCamera, ...estimateView(scene, sampleCamera, thresholds) };
    })
    .sort((a, b) => b.soupRisk + b.overdrawScore - (a.soupRisk + a.overdrawScore));
}

interface DensityGrid {
  cells: Uint32Array;
  gridSize: number;
  min: Vec3;
  invCellSize: number;
}

function buildDensityGrid(positions: Float32Array, center: Vec3, radius: number): DensityGrid {
  const gridSize = 48;
  const cells = new Uint32Array(gridSize * gridSize * gridSize);
  const diameter = Math.max(radius * 2, 0.001);
  const min: Vec3 = [center[0] - radius, center[1] - radius, center[2] - radius];
  const invCellSize = gridSize / diameter;
  for (let i = 0; i < positions.length; i += 3) {
    const ix = quantizeCell((positions[i] - min[0]) * invCellSize, gridSize);
    const iy = quantizeCell((positions[i + 1] - min[1]) * invCellSize, gridSize);
    const iz = quantizeCell((positions[i + 2] - min[2]) * invCellSize, gridSize);
    cells[ix + gridSize * (iy + gridSize * iz)]++;
  }
  return { cells, gridSize, min, invCellSize };
}

function densityFor(grid: DensityGrid, x: number, y: number, z: number): number {
  const ix = quantizeCell((x - grid.min[0]) * grid.invCellSize, grid.gridSize);
  const iy = quantizeCell((y - grid.min[1]) * grid.invCellSize, grid.gridSize);
  const iz = quantizeCell((z - grid.min[2]) * grid.invCellSize, grid.gridSize);
  let total = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x2 = ix + dx;
        const y2 = iy + dy;
        const z2 = iz + dz;
        if (x2 < 0 || y2 < 0 || z2 < 0 || x2 >= grid.gridSize || y2 >= grid.gridSize || z2 >= grid.gridSize) continue;
        total += grid.cells[x2 + grid.gridSize * (y2 + grid.gridSize * z2)];
      }
    }
  }
  return total;
}

function quantizeCell(value: number, gridSize: number): number {
  return Math.max(0, Math.min(gridSize - 1, Math.floor(value)));
}

function sourceIndices(count: number): Uint32Array {
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return indices;
}

function normalizeArray(values: Float32Array): Float32Array {
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  if (max <= 0) return values;
  for (let i = 0; i < values.length; i++) values[i] = clamp01(values[i] / max);
  return values;
}

function fillScales(count: number, value: number): Float32Array {
  const data = new Float32Array(count * 3);
  for (let i = 0; i < data.length; i++) data[i] = value;
  return data;
}

function fillColors(count: number): Float32Array {
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = 0.9;
    data[i * 3 + 1] = 0.72;
    data[i * 3 + 2] = 0.42;
  }
  return data;
}

function fillOpacities(count: number): Float32Array {
  const data = new Float32Array(count);
  data.fill(0.7);
  return data;
}

function fillRotations(count: number): Float32Array {
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data[i * 4 + 3] = 1;
  return data;
}
