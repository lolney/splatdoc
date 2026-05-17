import { describe, expect, it } from 'vitest';
import { createScene, estimateView, runStressTest } from '../src/domain/metrics';
import { DEFAULT_THRESHOLDS } from '../src/domain/types';

describe('diagnostic metrics', () => {
  const scene = createScene(
    'fixture',
    new Float32Array([
      0, 0, 0,
      0.05, 0, 0,
      5, 5, 5,
    ]),
    new Float32Array([
      0.04, 0.04, 0.04,
      0.05, 0.05, 0.05,
      0.4, 0.4, 0.4,
    ]),
    new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]),
    new Float32Array([0.8, 0.02, 0.5]),
  );

  it('marks low opacity and isolated splats', () => {
    expect(scene.metrics.deadScore[1]).toBeGreaterThan(scene.metrics.deadScore[0]);
    expect(scene.metrics.outlierScore[2]).toBeGreaterThan(scene.metrics.outlierScore[0]);
    expect(scene.metrics.blurRisk[2]).toBeGreaterThan(scene.metrics.blurRisk[0]);
  });

  it('estimates view cost and flagged splats', () => {
    const estimate = estimateView(scene, { target: scene.bounds.center, yaw: 0.4, pitch: 0.2, distance: 8, fov: 55 }, DEFAULT_THRESHOLDS);
    expect(estimate.estimatedMs).toBeGreaterThan(0);
    expect(estimate.flaggedSplats).toBeGreaterThan(0);
  });

  it('produces sorted camera stress samples', () => {
    const samples = runStressTest(scene, { target: scene.bounds.center, yaw: 0, pitch: 0, distance: 8, fov: 55 }, DEFAULT_THRESHOLDS);
    expect(samples).toHaveLength(6);
    expect(samples[0].soupRisk + samples[0].overdrawScore).toBeGreaterThanOrEqual(samples[5].soupRisk + samples[5].overdrawScore);
  });
});
