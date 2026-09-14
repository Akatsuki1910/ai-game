const TWO_PI = Math.PI * 2;

/** 角度を [-PI, PI) の範囲に正規化する。 */
export function normalizeAngle(angleRad: number): number {
  let angle = angleRad % TWO_PI;
  if (angle < -Math.PI) angle += TWO_PI;
  if (angle >= Math.PI) angle -= TWO_PI;
  return angle;
}

/** target - current の最短角度差（-PI〜PI）。値の符号が回転すべき向きを表す。 */
export function shortestAngleDiff(current: number, target: number): number {
  return normalizeAngle(target - current);
}

/**
 * 風上方向からの角度差（ラジアン。0=風上/ノーゴーゾーン中心）に対する推進効率(0〜1)を返す。
 * ノーゴーゾーン境界（クローズホールド）と真後ろの追い風の両端で0になり、
 * その中間（ビームリーチ付近）が最速になる単純化した極線(polar curve)。
 * 実際のヨットの極線は追い風側でも速度が出るが、「風上/風下どちらの極端も避けて
 * ジグザグに進路を取る」というプロトタイプの駆け引きを単純な式1本で表すため、
 * あえて両端0の対称なカーブにしている。
 */
export function computeSpeedFraction(angleFromWindSourceRad: number, noGoAngleRad: number): number {
  const angle = Math.abs(normalizeAngle(angleFromWindSourceRad));
  if (angle <= noGoAngleRad) return 0;
  const span = Math.PI - noGoAngleRad;
  if (span <= 0) return 0;
  const t = Math.min((angle - noGoAngleRad) / span, 1);
  return Math.sin(t * Math.PI);
}

/** 値を [min, max] にクランプする。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
