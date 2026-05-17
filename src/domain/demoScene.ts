import { createScene } from './metrics';

export function makeDemoScene(): ReturnType<typeof createScene> {
  const count = 5200;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const rotations = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const arm = i % 3;
    const angle = t * Math.PI * 9 + arm * 2.1;
    const radius = 0.35 + t * 1.35 + noise(i) * 0.09;
    const soupBand = Math.sin(angle * 1.7) > 0.72;
    const floater = i % 97 === 0;
    const x = Math.cos(angle) * radius + noise(i + 8) * 0.08;
    const y = Math.sin(t * Math.PI * 2) * 0.35 + noise(i + 19) * 0.28 + (floater ? 1.5 + noise(i) : 0);
    const z = Math.sin(angle) * radius + noise(i + 31) * 0.08 + (floater ? 1.3 : 0);
    const size = soupBand ? 0.09 + noise(i + 44) * 0.06 : 0.025 + noise(i + 11) * 0.018;
    positions.set([x, y, z], i * 3);
    scales.set([size * (1.2 + noise(i) * 0.2), size, size * 0.7], i * 3);
    colors.set([
      0.35 + t * 0.45,
      0.72 - t * 0.22,
      0.95 - t * 0.48,
    ], i * 3);
    opacities[i] = floater ? 0.14 : soupBand ? 0.54 : 0.78;
    rotations.set([0, 0, 0, 1], i * 4);
  }

  return createScene('generated-diagnostic-soup.splat', positions, scales, colors, opacities, rotations);
}

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
