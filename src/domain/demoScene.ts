import { createScene } from './metrics';

export function makeDemoScene(): ReturnType<typeof createScene> {
  const count = 7200;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const rotations = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const arm = i % 3;
    const band = i % 20;
    const angle = t * Math.PI * 9 + arm * 2.1;
    const weakVeil = band >= 11 && band <= 14;
    const floater = band >= 15;
    const soupBand = !floater && Math.sin(angle * 1.7) > 0.55;
    const radius = 0.34 + t * 1.28 + noise(i) * 0.1 + (weakVeil ? 0.18 * noise(i + 3) : 0);
    const drift = floater ? 1.05 + (band - 15) * 0.24 : 0;
    const x = Math.cos(angle) * (radius + drift) + noise(i + 8) * (weakVeil ? 0.22 : 0.08);
    const y = Math.sin(t * Math.PI * 2) * 0.35 + noise(i + 19) * (weakVeil ? 0.55 : 0.28) + (floater ? 0.85 + noise(i) * 0.75 : 0);
    const z = Math.sin(angle) * (radius + drift * 1.15) + noise(i + 31) * (weakVeil ? 0.22 : 0.08) + (floater ? 0.8 + noise(i + 17) * 0.72 : 0);
    const size = soupBand
      ? 0.075 + Math.abs(noise(i + 44)) * 0.07
      : weakVeil
        ? 0.032 + Math.abs(noise(i + 11)) * 0.045
        : floater
          ? 0.026 + Math.abs(noise(i + 71)) * 0.04
          : 0.022 + Math.abs(noise(i + 11)) * 0.02;
    positions.set([x, y, z], i * 3);
    scales.set([size * (1.2 + noise(i) * 0.2), size, size * 0.7], i * 3);
    colors.set([
      floater ? 0.95 : 0.35 + t * 0.45,
      weakVeil ? 0.45 : 0.72 - t * 0.22,
      floater ? 0.28 : 0.95 - t * 0.48,
    ], i * 3);
    opacities[i] = floater
      ? 0.1 + Math.abs(noise(i + 81)) * 0.58
      : weakVeil
        ? 0.03 + Math.abs(noise(i + 61)) * 0.42
        : soupBand
          ? 0.22 + Math.abs(noise(i + 41)) * 0.45
          : 0.58 + Math.abs(noise(i + 21)) * 0.34;
    rotations.set([0, 0, 0, 1], i * 4);
  }

  return createScene('generated-diagnostic-soup.splat', positions, scales, colors, opacities, rotations);
}

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
