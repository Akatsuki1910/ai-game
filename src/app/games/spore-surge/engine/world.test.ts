import assert from "node:assert/strict";
import { test } from "node:test";
import { SporeSurgeWorld, type UpgradeId } from "./world.ts";

const WIDTH = 900;
const HEIGHT = 600;
const FRAME = 1 / 60;

function assertFinite(world: SporeSurgeWorld, label: string): void {
  assert.ok(
    Number.isFinite(world.player.x) && Number.isFinite(world.player.y),
    `${label}: player位置`,
  );
  assert.ok(Number.isFinite(world.player.hp), `${label}: player HP`);
  for (const enemy of world.enemies) {
    assert.ok(Number.isFinite(enemy.x) && Number.isFinite(enemy.y), `${label}: enemy位置`);
  }
  for (const projectile of world.projectiles) {
    assert.ok(
      Number.isFinite(projectile.x) && Number.isFinite(projectile.y),
      `${label}: projectile位置`,
    );
  }
}

test("起動直後はプレイヤーが満タンHPでレベル1、敵はまだいない", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);

  assert.equal(world.player.hp, world.player.maxHp);
  assert.equal(world.level, 1);
  assert.equal(world.xp, 0);
  assert.equal(world.kills, 0);
  assert.equal(world.enemies.length, 0);
  assert.equal(world.isOver, false);
  assert.equal(world.isChoosingUpgrade, false);
});

test("ドラッグ先の方向へプレイヤーが移動し、画面外には出ない", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);
  const startX = world.player.x;

  world.setMoveTarget(-9999, -9999);
  for (let i = 0; i < 90; i++) world.step(FRAME);

  assert.ok(world.player.x < startX, "目標方向（左）へ移動している");
  assert.ok(world.player.x >= world.player.radius - 0.01, "左端からはみ出さない");
  assert.ok(world.player.y >= world.player.radius - 0.01, "上端からはみ出さない");
  assertFinite(world, "移動後");
});

test("キーボード入力でもプレイヤーが移動する", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);
  const startX = world.player.x;

  world.setKeyboardDirection(1, 0);
  for (let i = 0; i < 10; i++) world.step(FRAME);

  assert.ok(world.player.x > startX, "右方向のキー入力で右へ移動する");
});

test("敵に接触し続けるとプレイヤーのHPが減り、0になるとゲームオーバーになる", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);
  world.enemies.push({
    id: 9001,
    x: world.player.x,
    y: world.player.y,
    radius: 14,
    hp: 9999,
    maxHp: 9999,
    speed: 0,
    damage: 40,
  });

  const hpBefore = world.player.hp;
  world.step(FRAME);
  assert.ok(world.player.hp < hpBefore, "接触でHPが減る");

  for (let i = 0; i < 200 && !world.isOver; i++) {
    world.step(FRAME);
    assertFinite(world, "戦闘中");
  }

  assert.equal(world.isOver, true, "HPが尽きるとゲームオーバーになる");
  assert.equal(world.player.hp, 0);

  const hpAfterOver = world.player.hp;
  world.step(FRAME);
  assert.equal(world.player.hp, hpAfterOver, "ゲームオーバー後は状態が変化しない");

  world.reset();
  assert.equal(world.isOver, false);
  assert.equal(world.player.hp, world.player.maxHp);
  assert.equal(world.enemies.length, 0);
  assert.equal(world.level, 1);
});

test("自動攻撃が最も近い敵を倒すと撃破数が増え、その場に花粉が出る", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);
  world.enemies.push({
    id: 9002,
    x: world.player.x + 60,
    y: world.player.y,
    radius: 14,
    hp: 1,
    maxHp: 1,
    speed: 0,
    damage: 0,
  });

  const killed: number[] = [];
  world.onEnemyKilled = ({ enemy }) => killed.push(enemy.id);

  for (let i = 0; i < 60 && killed.length === 0; i++) {
    world.step(FRAME);
  }

  assert.equal(killed.length, 1, "自動攻撃で敵を1体倒した");
  assert.equal(world.kills, 1);
  assert.equal(world.enemies.length, 0);
  assert.equal(world.pollens.length, 1, "倒した場所に花粉が1つ出る");
  assertFinite(world, "撃破後");
});

test("花粉を十分に集めるとレベルアップし、強化の選択肢が3つ出る。選ぶまで進行は止まる", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);
  const levelUps: number[] = [];
  world.onLevelUp = ({ level }) => levelUps.push(level);

  world.xp = world.xpToNext - 1;
  world.pollens.push({
    id: 9100,
    x: world.player.x,
    y: world.player.y,
    radius: 6,
    value: 10,
  });

  world.step(FRAME);

  assert.equal(levelUps.length, 1, "レベルアップイベントが発火する");
  assert.equal(world.level, 2);
  assert.equal(world.isChoosingUpgrade, true);
  assert.equal(world.upgradeOptions.length, 3, "強化の選択肢は3つ");

  const ids = new Set(world.upgradeOptions.map((o) => o.id));
  assert.equal(ids.size, 3, "選択肢は重複しない");

  // 選ぶまでシミュレーションは止まる
  const frozenX = world.player.x;
  const frozenEnemyCount = world.enemies.length;
  world.setKeyboardDirection(1, 0);
  for (let i = 0; i < 30; i++) world.step(FRAME);
  assert.equal(world.player.x, frozenX, "選択待ち中はプレイヤーが動かない");
  assert.equal(world.enemies.length, frozenEnemyCount, "選択待ち中は敵が湧かない");

  const chosenId: UpgradeId = world.upgradeOptions[0].id;
  const before = { ...world.player };
  world.chooseUpgrade(chosenId);

  assert.equal(world.isChoosingUpgrade, false, "選択後は再開する");
  assert.equal(world.upgradeOptions.length, 0);

  switch (chosenId) {
    case "attack-speed":
      assert.ok(world.player.attackCooldown < before.attackCooldown);
      break;
    case "damage":
      assert.ok(world.player.attackDamage > before.attackDamage);
      break;
    case "move-speed":
      assert.ok(world.player.speed > before.speed);
      break;
    case "max-hp":
      assert.ok(world.player.maxHp > before.maxHp);
      break;
    case "magnet":
      assert.ok(world.player.magnetSpeed > before.magnetSpeed);
      break;
    case "multi-shot":
      assert.ok(world.player.projectileCount > before.projectileCount);
      break;
  }
});

test("時間が経つと敵が自動的に出現する", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);
  for (let i = 0; i < 200; i++) world.step(FRAME);
  assert.ok(world.enemies.length > 0, "3秒以上経てば少なくとも1体は出現している");
});

test("画面サイズが変わってもプレイヤーが画面内に収まる", () => {
  const world = new SporeSurgeWorld(WIDTH, HEIGHT);

  world.resize(390, 780);
  assert.ok(world.player.x >= 0 && world.player.x <= 390, "プレイヤーが画面内(横)");
  assert.ok(world.player.y >= 0 && world.player.y <= 780, "プレイヤーが画面内(縦)");

  for (let i = 0; i < 60; i++) world.step(FRAME);
  assertFinite(world, "リサイズ後");
});
