import type { Bounds3, CameraState, Vec3 } from './types';

export function boundsFromPositions(positions: Float32Array): Bounds3 {
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i]);
    min[1] = Math.min(min[1], positions[i + 1]);
    min[2] = Math.min(min[2], positions[i + 2]);
    max[0] = Math.max(max[0], positions[i]);
    max[1] = Math.max(max[1], positions[i + 1]);
    max[2] = Math.max(max[2], positions[i + 2]);
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    radius = Math.max(radius, distance(center, [positions[i], positions[i + 1], positions[i + 2]]));
  }
  return { min, max, center, radius: Math.max(radius, 0.001) };
}

export function distance(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return Math.hypot(x, y, z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cameraPosition(camera: CameraState): Vec3 {
  const cp = Math.cos(camera.pitch);
  return add(camera.target, [
    Math.sin(camera.yaw) * cp * camera.distance,
    Math.sin(camera.pitch) * camera.distance,
    Math.cos(camera.yaw) * cp * camera.distance,
  ]);
}

export function viewBasis(camera: CameraState): { eye: Vec3; forward: Vec3; right: Vec3; up: Vec3 } {
  const eye = cameraPosition(camera);
  const forward = normalize(sub(camera.target, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  return { eye, forward, right, up };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
