import { describe, expect, it } from 'vitest';
import { makeDemoScene } from '../src/domain/demoScene';
import { estimateView } from '../src/domain/metrics';
import { DEFAULT_THRESHOLDS } from '../src/domain/types';

describe('demo scene diagnostics', () => {
  const scene = makeDemoScene();

  it('contains enough opacity variation for threshold previews', () => {
    let below15 = 0;
    let below30 = 0;
    let below50 = 0;
    for (const opacity of scene.opacities) {
      if (opacity < 0.15) below15++;
      if (opacity < 0.3) below30++;
      if (opacity < 0.5) below50++;
    }

    expect(below15).toBeGreaterThan(scene.count * 0.04);
    expect(below30).toBeGreaterThan(scene.count * 0.18);
    expect(below50).toBeGreaterThan(scene.count * 0.35);
  });

  it('contains a broad outlier score distribution', () => {
    let above50 = 0;
    let above75 = 0;
    let above90 = 0;
    for (const score of scene.metrics.outlierScore) {
      if (score > 0.5) above50++;
      if (score > 0.75) above75++;
      if (score > 0.9) above90++;
    }

    expect(above50).toBeGreaterThan(scene.count * 0.06);
    expect(above75).toBeGreaterThan(scene.count * 0.025);
    expect(above90).toBeGreaterThan(scene.count * 0.01);
  });

  it('shows meaningful flagged-count movement across thresholds', () => {
    const camera = { target: scene.bounds.center, yaw: 0.6, pitch: 0.28, distance: scene.bounds.radius * 2.8, fov: 55 };
    const permissive = {
      ...DEFAULT_THRESHOLDS,
      opacityFloor: 0,
      densityCutoff: 1,
      overdrawCutoff: 1,
      projectedSizeCutoff: 1,
      outlierPercentile: 1,
      deadCutoff: 1,
      blurRiskCutoff: 1,
    };
    const loose = estimateView(scene, camera, permissive);
    const opacity = estimateView(scene, camera, { ...permissive, opacityFloor: 0.5 });
    const outliers = estimateView(scene, camera, { ...permissive, outlierPercentile: 0.5 });

    expect(opacity.flaggedSplats - loose.flaggedSplats).toBeGreaterThan(scene.count * 0.35);
    expect(outliers.flaggedSplats - loose.flaggedSplats).toBeGreaterThan(scene.count * 0.12);
  });
});
