import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COIN_RADIUS,
  type Coin,
  CoinTideWorld,
  MAX_ACTIVE_COINS,
  ROUND_SECONDS,
  STOCK_MAX,
} from "./world.ts";

const WIDTH = 300;
const HEIGHT = 400;
const FRAME = 1 / 60;

function makeCoin(overrides: Partial<Coin>): Coin {
  return {
    id: -1,
    kind: "standard",
    x: WIDTH / 2,
    y: HEIGHT / 2,
    radius: COIN_RADIUS,
    ...overrides,
  };
}

function assertFinite(world: CoinTideWorld, label: string): void {
  assert.ok(Number.isFinite(world.score), `${label}: score`);
  assert.ok(Number.isFinite(world.timeRemaining), `${label}: timeRemaining`);
  assert.ok(Number.isFinite(world.pusherY), `${label}: pusherY`);
  for (const coin of world.coins) {
    assert.ok(Number.isFinite(coin.x) && Number.isFinite(coin.y), `${label}: coin position`);
  }
}

test("起動直後はコイン0枚・スコア0・満タンのストックで始まる", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);

  assert.equal(world.coins.length, 0);
  assert.equal(world.score, 0);
  assert.equal(world.stock, STOCK_MAX);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
  assert.equal(world.isOver, false);
  assert.ok(world.pusherMaxY > world.pusherMinY, "プッシャーの可動域がある");
});

test("狙った位置にコインを投入できる / ストックが尽きると投入できない", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);

  world.setAim(120);
  const dropped = world.dropCoin();
  assert.equal(dropped, true);
  assert.equal(world.coins.length, 1);
  assert.equal(world.coins[0].x, 120);
  assert.equal(world.stock, STOCK_MAX - 1);

  // 画面外を狙っても壁の内側にクランプされる
  world.setAim(-9999);
  assert.ok(world.aimX >= COIN_RADIUS);
  world.setAim(9999);
  assert.ok(world.aimX <= WIDTH - COIN_RADIUS);

  for (let i = 0; i < STOCK_MAX; i++) world.dropCoin();
  assert.equal(world.stock, 0, "ストックを使い切る");
  const blocked = world.dropCoin();
  assert.equal(blocked, false, "ストックが0なら投入できない");
});

test("満タンのまま長時間待っても、1枚投入した直後に満タンへ即復帰しない", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);

  // ストックが満タンのまま10秒放置(内部の積算時間が無限に貯まっていないか)
  for (let i = 0; i < 600; i++) world.step(FRAME);
  assert.equal(world.stock, STOCK_MAX);

  world.dropCoin();
  assert.equal(world.stock, STOCK_MAX - 1, "投入直後は1枚減っている");

  // 減った直後の1フレームだけでは補充されない
  world.step(FRAME);
  assert.equal(world.stock, STOCK_MAX - 1, "減った直後はまだ補充されない");
});

test("最大枚数に達すると、ストックがあっても投入できない", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  for (let i = 0; i < MAX_ACTIVE_COINS; i++) {
    world.coins.push(makeCoin({ id: i, x: WIDTH / 2, y: HEIGHT / 2 }));
  }
  const stockBefore = world.stock;

  const dropped = world.dropCoin();

  assert.equal(dropped, false);
  assert.equal(world.coins.length, MAX_ACTIVE_COINS, "枚数が増えない");
  assert.equal(world.stock, stockBefore, "失敗した投入はストックを消費しない");
});

test("時間経過でストックが補充される(上限まで)", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  for (let i = 0; i < STOCK_MAX; i++) world.dropCoin();
  assert.equal(world.stock, 0);

  for (let i = 0; i < 180; i++) world.step(FRAME); // 3秒ぶん

  assert.ok(world.stock > 0, "時間経過でストックが回復する");
  assert.ok(world.stock <= STOCK_MAX, "上限を超えない");

  for (let i = 0; i < 600; i++) world.step(FRAME); // さらに10秒
  assert.equal(world.stock, STOCK_MAX, "上限で止まる");
});

test("前縁を越えたコインは除去されて得点になる", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  world.coins.push(makeCoin({ id: 1, kind: "bonus", x: WIDTH / 2, y: HEIGHT + COIN_RADIUS + 1 }));

  const scored: number[] = [];
  world.onCoinScored = ({ points }) => scored.push(points);

  world.step(FRAME);

  assert.equal(world.coins.length, 0, "縁を越えたコインは消える");
  assert.equal(scored.length, 1, "得点イベントが1回発生する");
  assert.ok(scored[0] > 0, "得点が入っている");
  assert.equal(world.score, scored[0]);
});

test("プッシャーに触れたコインはプッシャーの前面より奥へ戻らない", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  world.coins.push(makeCoin({ id: 1, x: WIDTH / 2, y: world.pusherMinY }));

  for (let i = 0; i < 90; i++) {
    world.step(FRAME);
    const coin = world.coins[0];
    assert.ok(
      coin.y >= world.pusherY + coin.radius - 0.01,
      "コインはプッシャーの前面より手前(小さいy)に留まらない",
    );
  }
});

test("奥のコインを押すと、接していた手前のコインも連鎖して押される", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  const back = makeCoin({ id: 1, x: WIDTH / 2, y: world.pusherMinY });
  const front = makeCoin({ id: 2, x: WIDTH / 2, y: back.y + COIN_RADIUS * 2 });
  world.coins.push(back, front);

  const backStart = back.y;
  const frontStart = front.y;

  for (let i = 0; i < 300; i++) world.step(FRAME); // 5秒ぶん

  assert.ok(back.y > backStart, "奥のコインが前進する");
  assert.ok(front.y > frontStart, "連鎖して手前のコインも前進する");
  assert.ok(front.y - back.y >= COIN_RADIUS * 2 - 0.5, "押し出されても重なり合わない");
});

test("画面の左右端を越えない", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  world.coins.push(makeCoin({ id: 1, x: -500, y: HEIGHT / 2 }));
  world.coins.push(makeCoin({ id: 2, x: 9999, y: HEIGHT / 2 }));

  world.step(FRAME);

  assert.ok(world.coins[0].x >= COIN_RADIUS - 0.01, "左端を越えない");
  assert.ok(world.coins[1].x <= WIDTH - COIN_RADIUS + 0.01, "右端を越えない");
});

test("ラウンドが終了し、リセットで最初から遊べる", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  world.dropCoin();

  for (let i = 0; i < Math.ceil(ROUND_SECONDS / FRAME) + 5 && !world.isOver; i++) {
    world.step(FRAME);
    assertFinite(world, "ラウンド中");
  }

  assert.equal(world.isOver, true, "ラウンドが終了する");
  assert.equal(world.timeRemaining, 0);

  // 終了後に進めても壊れない
  world.step(FRAME);
  assertFinite(world, "ラウンド終了後");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.score, 0);
  assert.equal(world.coins.length, 0);
  assert.equal(world.stock, STOCK_MAX);
  assert.equal(world.timeRemaining, ROUND_SECONDS);
});

test("画面サイズが変わってもコインと狙いが画面内に収まる", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  world.setAim(WIDTH * 0.8);
  world.dropCoin();

  // PC横長 → スマホ縦長
  world.resize(375, 720);

  assert.ok(world.aimX >= 0 && world.aimX <= 375, "狙いが画面内に収まる");
  for (const coin of world.coins) {
    assert.ok(coin.x >= -1 && coin.x <= 376, "コインが画面内");
    assert.ok(coin.y >= -1 && coin.y <= 721, "コインが画面内");
  }

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});

test("極端に小さい画面でもNaNや例外を起こさない", () => {
  const world = new CoinTideWorld(WIDTH, HEIGHT);
  world.dropCoin();
  world.resize(10, 10);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assertFinite(world, "極小サイズ");
});
