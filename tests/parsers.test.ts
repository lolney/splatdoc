import { describe, expect, it } from 'vitest';
import { parsePly, parseRawSplat } from '../src/io/parsers';

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('PLY parser', () => {
  it('loads ascii PLY splats with common gaussian properties', () => {
    const scene = parsePly(encode(`ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property float scale_0
property float scale_1
property float scale_2
property uchar red
property uchar green
property uchar blue
property float opacity
end_header
0 0 0 -4 -4 -4 255 128 0 2
1 0 0 -3 -3 -3 0 255 64 -2
`));
    expect(scene.count).toBe(2);
    expect(scene.positions[3]).toBe(1);
    expect(scene.colors[0]).toBeCloseTo(1);
    expect(scene.opacities[0]).toBeGreaterThan(scene.opacities[1]);
  });

  it('rejects PLY without xyz properties', () => {
    expect(() => parsePly(encode(`ply
format ascii 1.0
element vertex 1
property float nope
end_header
0
`))).toThrow(/x, y, and z/);
  });
});

describe('raw .splat parser', () => {
  it('loads 32-byte rows', () => {
    const buffer = new ArrayBuffer(32);
    const view = new DataView(buffer);
    view.setFloat32(0, 1, true);
    view.setFloat32(4, 2, true);
    view.setFloat32(8, 3, true);
    view.setFloat32(12, -4, true);
    view.setFloat32(16, -4, true);
    view.setFloat32(20, -4, true);
    view.setUint8(24, 255);
    view.setUint8(25, 128);
    view.setUint8(26, 64);
    view.setUint8(27, 200);
    view.setUint8(31, 255);

    const scene = parseRawSplat(buffer);
    expect(scene.count).toBe(1);
    expect([...scene.positions]).toEqual([1, 2, 3]);
    expect(scene.colors[0]).toBe(1);
    expect(scene.opacities[0]).toBeCloseTo(200 / 255);
  });

  it('rejects partial rows', () => {
    expect(() => parseRawSplat(new ArrayBuffer(31))).toThrow(/32-byte/);
  });
});
