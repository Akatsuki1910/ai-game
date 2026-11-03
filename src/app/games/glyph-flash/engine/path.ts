export interface Point {
  readonly x: number;
  readonly y: number;
}

const RESAMPLE_POINTS = 24;
const SHAPE_WEIGHT = 0.7;
const LENGTH_WEIGHT = 0.3;
const SHAPE_SENSITIVITY = 220;
const MARGIN_RATIO = 0.18;
const MAX_TURN_RADIANS = Math.PI * 0.6;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** 折れ線を弧長が等間隔になるよう count 個の点へ再標本化する。 */
export function resamplePath(points: readonly Point[], count: number): Point[] {
  if (count <= 0) return [];
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => points[0]);

  const total = pathLength(points);
  if (total < 1e-6 || count === 1) return Array.from({ length: count }, () => points[0]);

  const step = total / (count - 1);
  const result: Point[] = [];
  let segmentIndex = 0;
  let accumulated = 0;
  let segmentLength = distance(points[0], points[1]);

  for (let i = 0; i < count; i++) {
    const target = Math.min(step * i, total);
    while (segmentIndex < points.length - 2 && accumulated + segmentLength < target - 1e-9) {
      accumulated += segmentLength;
      segmentIndex += 1;
      segmentLength = distance(points[segmentIndex], points[segmentIndex + 1]);
    }

    const start = points[segmentIndex];
    const end = points[Math.min(segmentIndex + 1, points.length - 1)];
    const ratio = segmentLength < 1e-9 ? 0 : clamp((target - accumulated) / segmentLength, 0, 1);
    result.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    });
  }

  return result;
}

/**
 * 記憶してなぞった形が、お題の軌跡とどれだけ一致しているかを 0〜100 で評価する。
 * 形の近さ（弧長で揃えた対応点どうしの距離）と、長さの近さ（なぞり切れたか）の
 * 両方を見ないと、「お題の一部分だけを正確になぞる」ショートカットが満点になってしまう。
 */
export function compareGlyphPaths(
  target: readonly Point[],
  drawn: readonly Point[],
  referenceSize: number,
): number {
  if (target.length < 2 || drawn.length < 2 || referenceSize <= 0) return 0;

  const targetLength = pathLength(target);
  const drawnLength = pathLength(drawn);
  if (targetLength < 1e-6) return 0;

  const resampledTarget = resamplePath(target, RESAMPLE_POINTS);
  const resampledDrawn = resamplePath(drawn, RESAMPLE_POINTS);

  let totalDistance = 0;
  for (let i = 0; i < RESAMPLE_POINTS; i++) {
    totalDistance += distance(resampledTarget[i], resampledDrawn[i]);
  }
  const averageDistance = totalDistance / RESAMPLE_POINTS;
  const shapeScore = clamp(100 - (averageDistance / referenceSize) * SHAPE_SENSITIVITY, 0, 100);

  const lengthRatio = Math.min(drawnLength, targetLength) / Math.max(drawnLength, targetLength);
  const lengthScore = lengthRatio * 100;

  return clamp(shapeScore * SHAPE_WEIGHT + lengthScore * LENGTH_WEIGHT, 0, 100);
}

/**
 * 折れ線の先頭から弧長 maxLength ぶんだけを切り出す。
 * プレビュー表示で「お題を少しずつ描いて見せる」アニメーションに使う。
 */
export function trimPathToLength(points: readonly Point[], maxLength: number): Point[] {
  if (points.length === 0 || maxLength <= 0) return [];

  const result: Point[] = [points[0]];
  let remaining = maxLength;

  for (let i = 1; i < points.length; i++) {
    const segmentLength = distance(points[i - 1], points[i]);
    if (segmentLength <= remaining) {
      result.push(points[i]);
      remaining -= segmentLength;
      continue;
    }
    if (segmentLength > 1e-9) {
      const ratio = remaining / segmentLength;
      result.push({
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * ratio,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * ratio,
      });
    }
    break;
  }

  return result;
}

/**
 * ランダムウォークでお題の折れ線（グリフ）を生成する。
 * 壁際では角度を跳ね返すことで、矩形の余白内に収まる形を保証する。
 */
export function generateGlyphPath(width: number, height: number, segmentCount: number): Point[] {
  const marginX = width * MARGIN_RATIO;
  const marginY = height * MARGIN_RATIO;
  const minX = marginX;
  const maxX = Math.max(marginX, width - marginX);
  const minY = marginY;
  const maxY = Math.max(marginY, height - marginY);
  const stepLength = Math.max(1, Math.min(maxX - minX, maxY - minY) * 0.32);

  let x = minX + Math.random() * (maxX - minX);
  let y = minY + Math.random() * (maxY - minY);
  let angle = Math.random() * Math.PI * 2;

  const points: Point[] = [{ x, y }];
  for (let i = 0; i < segmentCount; i++) {
    angle += (Math.random() - 0.5) * 2 * MAX_TURN_RADIANS;
    let nextX = x + Math.cos(angle) * stepLength;
    let nextY = y + Math.sin(angle) * stepLength;

    if (nextX < minX || nextX > maxX) {
      angle = Math.PI - angle;
      nextX = clamp(nextX, minX, maxX);
    }
    if (nextY < minY || nextY > maxY) {
      angle = -angle;
      nextY = clamp(nextY, minY, maxY);
    }

    x = nextX;
    y = nextY;
    points.push({ x, y });
  }

  return points;
}
