export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Verlet積分で次の位置を求める（速度は現在位置と直前位置の差から暗黙的に導く）。
 * ロープの距離拘束と自然に組み合わせられるため、振り子運動を安定して表現できる。
 */
export function integrateVerlet(
  pos: Point,
  prevPos: Point,
  gravity: number,
  deltaSeconds: number,
  damping: number,
): Point {
  const velocityX = (pos.x - prevPos.x) * damping;
  const velocityY = (pos.y - prevPos.y) * damping;
  return {
    x: pos.x + velocityX,
    y: pos.y + velocityY + gravity * deltaSeconds * deltaSeconds,
  };
}

/**
 * pos をロープの長さぶんだけ anchor から離れた円周上へ投影する（距離拘束）。
 * pos が anchor とちょうど重なる縮退ケースでは、真下へ垂らした位置を返す。
 */
export function constrainDistance(pos: Point, anchor: Point, targetDistance: number): Point {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const currentDistance = Math.hypot(dx, dy);

  if (currentDistance < 1e-6) {
    return { x: anchor.x, y: anchor.y + targetDistance };
  }

  const scale = targetDistance / currentDistance;
  return { x: anchor.x + dx * scale, y: anchor.y + dy * scale };
}
