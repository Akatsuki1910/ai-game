export interface Vec2 {
  x: number;
  y: number;
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function length(a: Vec2): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/** ベクトル d を法線 n の面で反射する（n は単位ベクトル前提）。 */
export function reflect(d: Vec2, n: Vec2): Vec2 {
  const k = 2 * dot(d, n);
  return { x: d.x - k * n.x, y: d.y - k * n.y };
}

/** 点 p から線分 ab までの最短距離。 */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const abLenSq = dot(ab, ab);
  if (abLenSq < 1e-9) return length(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / abLenSq));
  const projection = add(a, scale(ab, t));
  return length(sub(p, projection));
}
