import { createScene } from '../domain/metrics';
import type { SplatScene } from '../domain/types';

type PlyFormat = 'ascii' | 'binary_little_endian';

interface PlyProperty {
  name: string;
  type: string;
}

interface PlyHeader {
  format: PlyFormat;
  vertexCount: number;
  properties: PlyProperty[];
  dataOffset: number;
}

const TYPE_SIZE: Record<string, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

export async function parseSplatFile(file: File): Promise<SplatScene> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (extension === 'ply') return parsePly(buffer, file.name);
  if (extension === 'splat') return parseRawSplat(buffer, file.name);
  throw new Error(`Unsupported file type ".${extension ?? 'unknown'}". V1 accepts .ply and .splat.`);
}

export function parseRawSplat(buffer: ArrayBuffer, name = 'scene.splat'): SplatScene {
  if (buffer.byteLength % 32 !== 0) {
    throw new Error('Raw .splat files must use 32-byte rows.');
  }
  const view = new DataView(buffer);
  const count = buffer.byteLength / 32;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const rotations = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const base = i * 32;
    positions[i * 3] = view.getFloat32(base, true);
    positions[i * 3 + 1] = view.getFloat32(base + 4, true);
    positions[i * 3 + 2] = view.getFloat32(base + 8, true);
    scales[i * 3] = Math.exp(view.getFloat32(base + 12, true));
    scales[i * 3 + 1] = Math.exp(view.getFloat32(base + 16, true));
    scales[i * 3 + 2] = Math.exp(view.getFloat32(base + 20, true));
    colors[i * 3] = view.getUint8(base + 24) / 255;
    colors[i * 3 + 1] = view.getUint8(base + 25) / 255;
    colors[i * 3 + 2] = view.getUint8(base + 26) / 255;
    opacities[i] = view.getUint8(base + 27) / 255;
    rotations[i * 4] = view.getUint8(base + 28) / 127.5 - 1;
    rotations[i * 4 + 1] = view.getUint8(base + 29) / 127.5 - 1;
    rotations[i * 4 + 2] = view.getUint8(base + 30) / 127.5 - 1;
    rotations[i * 4 + 3] = view.getUint8(base + 31) / 127.5 - 1;
  }

  return createScene(name, positions, scales, colors, opacities, rotations);
}

export function parsePly(buffer: ArrayBuffer, name = 'scene.ply'): SplatScene {
  const header = readPlyHeader(buffer);
  if (header.vertexCount <= 0) throw new Error('PLY does not contain vertices.');
  if (!findProperty(header, ['x']) || !findProperty(header, ['y']) || !findProperty(header, ['z'])) {
    throw new Error('PLY must include x, y, and z vertex properties.');
  }
  if (header.format === 'ascii') return parseAsciiPly(buffer, header, name);
  return parseBinaryLittlePly(buffer, header, name);
}

function readPlyHeader(buffer: ArrayBuffer): PlyHeader {
  const bytes = new Uint8Array(buffer);
  const marker = '\nend_header\n';
  const text = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 65536)));
  let endIndex = text.indexOf(marker);
  let markerLength = marker.length;
  if (endIndex < 0) {
    const alt = '\r\nend_header\r\n';
    endIndex = text.indexOf(alt);
    markerLength = alt.length;
  }
  if (endIndex < 0) throw new Error('Invalid PLY: missing end_header.');
  const headerText = text.slice(0, endIndex);
  const lines = headerText.split(/\r?\n/);
  if (lines[0] !== 'ply') throw new Error('Invalid PLY magic header.');
  const formatLine = lines.find((line) => line.startsWith('format '));
  if (!formatLine?.includes('ascii') && !formatLine?.includes('binary_little_endian')) {
    throw new Error('Only ASCII and binary_little_endian PLY are supported.');
  }
  const format: PlyFormat = formatLine.includes('ascii') ? 'ascii' : 'binary_little_endian';
  let vertexCount = 0;
  let inVertex = false;
  const properties: PlyProperty[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element') {
      inVertex = parts[1] === 'vertex';
      if (inVertex) vertexCount = Number(parts[2]);
      continue;
    }
    if (inVertex && parts[0] === 'property' && parts[1] !== 'list') {
      properties.push({ type: parts[1], name: parts[2] });
    }
  }
  return { format, vertexCount, properties, dataOffset: endIndex + markerLength };
}

function parseAsciiPly(buffer: ArrayBuffer, header: PlyHeader, name: string): SplatScene {
  const body = new TextDecoder().decode(new Uint8Array(buffer, header.dataOffset));
  const lines = body.trim().split(/\r?\n/);
  const columns = propertyColumns(header);
  const data = allocate(header.vertexCount);

  for (let i = 0; i < header.vertexCount; i++) {
    const values = lines[i]?.trim().split(/\s+/).map(Number);
    if (!values || values.length < header.properties.length) throw new Error(`PLY vertex row ${i} is incomplete.`);
    assignVertex(data, i, columns, (name) => values[columns[name] ?? -1]);
  }
  return createScene(name, data.positions, data.scales, data.colors, data.opacities, data.rotations);
}

function parseBinaryLittlePly(buffer: ArrayBuffer, header: PlyHeader, name: string): SplatScene {
  const view = new DataView(buffer, header.dataOffset);
  const columns = propertyColumns(header);
  const data = allocate(header.vertexCount);
  let offset = 0;

  for (let i = 0; i < header.vertexCount; i++) {
    const row: Record<string, number> = {};
    for (const property of header.properties) {
      row[property.name] = readScalar(view, offset, property.type);
      offset += TYPE_SIZE[property.type] ?? 0;
    }
    assignVertex(data, i, columns, (name) => row[name]);
  }
  return createScene(name, data.positions, data.scales, data.colors, data.opacities, data.rotations);
}

function assignVertex(
  data: ReturnType<typeof allocate>,
  i: number,
  columns: Record<string, number>,
  valueOf: (name: string) => number | undefined,
): void {
  data.positions[i * 3] = valueOf('x') ?? 0;
  data.positions[i * 3 + 1] = valueOf('y') ?? 0;
  data.positions[i * 3 + 2] = valueOf('z') ?? 0;

  const sx = valueOf('scale_0') ?? valueOf('scale_x') ?? valueOf('sx') ?? -4;
  const sy = valueOf('scale_1') ?? valueOf('scale_y') ?? valueOf('sy') ?? sx;
  const sz = valueOf('scale_2') ?? valueOf('scale_z') ?? valueOf('sz') ?? sx;
  data.scales[i * 3] = Math.exp(sx);
  data.scales[i * 3 + 1] = Math.exp(sy);
  data.scales[i * 3 + 2] = Math.exp(sz);

  const red = valueOf('red') ?? valueOf('r') ?? sigmoid(valueOf('f_dc_0') ?? 0);
  const green = valueOf('green') ?? valueOf('g') ?? sigmoid(valueOf('f_dc_1') ?? 0);
  const blue = valueOf('blue') ?? valueOf('b') ?? sigmoid(valueOf('f_dc_2') ?? 0);
  data.colors[i * 3] = red > 1 ? red / 255 : red;
  data.colors[i * 3 + 1] = green > 1 ? green / 255 : green;
  data.colors[i * 3 + 2] = blue > 1 ? blue / 255 : blue;
  data.opacities[i] = sigmoid(valueOf('opacity') ?? valueOf('alpha') ?? 1);

  data.rotations[i * 4] = valueOf('rot_0') ?? 0;
  data.rotations[i * 4 + 1] = valueOf('rot_1') ?? 0;
  data.rotations[i * 4 + 2] = valueOf('rot_2') ?? 0;
  data.rotations[i * 4 + 3] = valueOf('rot_3') ?? 1;

  void columns;
}

function allocate(count: number) {
  return {
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    opacities: new Float32Array(count),
    rotations: new Float32Array(count * 4),
  };
}

function propertyColumns(header: PlyHeader): Record<string, number> {
  return Object.fromEntries(header.properties.map((property, index) => [property.name, index]));
}

function findProperty(header: PlyHeader, names: string[]): PlyProperty | undefined {
  return header.properties.find((property) => names.includes(property.name));
}

function readScalar(view: DataView, offset: number, type: string): number {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(offset);
    case 'uchar':
    case 'uint8':
      return view.getUint8(offset);
    case 'short':
    case 'int16':
      return view.getInt16(offset, true);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, true);
    case 'int':
    case 'int32':
      return view.getInt32(offset, true);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, true);
    case 'float':
    case 'float32':
      return view.getFloat32(offset, true);
    case 'double':
    case 'float64':
      return view.getFloat64(offset, true);
    default:
      throw new Error(`Unsupported PLY property type "${type}".`);
  }
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}
