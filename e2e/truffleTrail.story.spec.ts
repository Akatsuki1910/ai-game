import { expect, type Locator, type Page, test } from "@playwright/test";
import { DOG_SPEED, MAX_ACTIVE_TRUFFLES } from "../src/app/games/truffle-trail/engine/world";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/truffle-trail";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readScentPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("truffle-trail-scent").innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `匂いの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 見つかった(isLocated)トリュフのDOM上の目印のうち、現在見えているものの中心座標を返す。 */
async function findVisibleMarkerCenter(page: Page): Promise<{ x: number; y: number } | null> {
  for (let slot = 0; slot < MAX_ACTIVE_TRUFFLES; slot++) {
    const marker = page.getByTestId(`truffle-trail-located-marker-${slot}`);
    if (await marker.isVisible().catch(() => false)) {
      const box = await marker.boundingBox();
      if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
  }
  return null;
}

/**
 * 見つけたトリュフの真上へ持ち直して掘ってみる。新鮮さが尽きて掘り切る前に
 * 腐ってしまう(目印が消える)こともあるため、その場合は false を返して
 * 呼び出し側がまた探索を続けられるようにする。
 */
async function tryDigAt(
  page: Page,
  point: { x: number; y: number },
  budgetMs: number,
): Promise<boolean> {
  await page.mouse.up();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();

  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if ((await readScore(page)) > 0) return true;
    if (!(await findVisibleMarkerCenter(page))) return false; // 腐って消えた
    await page.waitForTimeout(120);
  }
  return false;
}

/**
 * トリュフの正確な位置は見つかるまでUIに出さない(＝このゲームの核)ため、
 * 犬を実際にジグザグへ動かし続けて「見つかる」まで探索し、見つけたらその場で掘ってみる。
 * 掘り切る前に新鮮さが尽きて腐ってしまった場合は、諦めずに探索を続け次のトリュフを探す。
 * 各区間は犬の移動速度(DOG_SPEED)から実際に到達しうる時間だけ待ってから次へ進むことで、
 * 目的地へジャンプする前に途中の経路も確実に通過させる。
 */
async function huntAndDig(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) throw new Error("stage bounding box not available");

  // トリュフは最大でエンジン側の MARGIN_RATIO(0.08) まで寄って湧くため、
  // 探索範囲はそれより広く、行の間隔は LOCATE_RADIUS(56px) の2倍より十分短くして
  // 取りこぼし(未走査の死角)が出ないようにする。
  const marginRatio = 0.05;
  const rows = 6;
  const waypoints: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const yRatio = marginRatio + (1 - marginRatio * 2) * (row / (rows - 1));
    const y = box.y + box.height * yRatio;
    const leftX = box.x + box.width * marginRatio;
    const rightX = box.x + box.width * (1 - marginRatio);
    const pair = row % 2 === 0 ? [leftX, rightX] : [rightX, leftX];
    for (const x of pair) waypoints.push({ x, y });
  }

  await page.mouse.move(waypoints[0].x, waypoints[0].y);
  await page.mouse.down();

  const DIG_ATTEMPT_BUDGET_MS = 2_500;
  let scored = false;

  const found = await findVisibleMarkerCenter(page);
  if (found) scored = await tryDigAt(page, found, DIG_ATTEMPT_BUDGET_MS);

  let lastPoint = waypoints[0];
  for (let i = 1; i < waypoints.length && !scored; i++) {
    const point = waypoints[i];
    await page.mouse.move(point.x, point.y, { steps: 6 });
    const legDistance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    const travelDeadline = Date.now() + (legDistance / DOG_SPEED) * 1000 + 250;
    lastPoint = point;

    while (Date.now() < travelDeadline && !scored) {
      const duringLeg = await findVisibleMarkerCenter(page);
      if (duringLeg) {
        scored = await tryDigAt(page, duringLeg, DIG_ATTEMPT_BUDGET_MS);
        if (!scored) {
          // 腐って消えた → この区間の探索を続行する
          await page.mouse.move(point.x, point.y, { steps: 6 });
        }
      }
      if (!scored) await page.waitForTimeout(120);
    }
  }

  expect(scored, "探して掘りきれば得点が入る").toBe(true);
}

test.describe("Truffle Trail のストーリー", () => {
  test("匂いを頼りに探して見つけ、掘りきると得点が入る", async ({ page }) => {
    const errors = collectPageErrors(page);
    // 探索範囲を小さくして、実時間で動く移動を現実的な時間内に通しで検証できるようにする。
    await page.setViewportSize({ width: 380, height: 380 });
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    await expect(page.getByTestId("truffle-trail-miss")).toHaveText(`MISS 0/5`);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await huntAndDig(page, stage);
    await page.mouse.up();

    expect(await readScore(page), "掘りきると得点が入っている").toBeGreaterThan(0);
    expect(errors, "探索・採掘中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は進行も匂いの変化も掘りも止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 動き回って匂いの表示が有効な値を返していることを確認する
    await dragOnStage(page, stage, { xRatio: 0.2, yRatio: 0.3 }, { xRatio: 0.8, yRatio: 0.7 });
    await waitForFrames(page, 20);
    const scentWhileMoving = await readScentPercent(page);
    expect(scentWhileMoving, "匂いは0〜100の範囲").toBeGreaterThanOrEqual(0);
    expect(scentWhileMoving, "匂いは0〜100の範囲").toBeLessThanOrEqual(100);

    // 一時停止するとオーバーレイが出て、スコアも匂いも変化しなくなる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const scentWhilePaused = await readScentPercent(page);

    // 一時停止中に長押し(掘る操作)してもスコアは増えない
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.3 }, { xRatio: 0.6, yRatio: 0.6 });
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが増えない").toBe(scoreWhilePaused);
    expect(await readScentPercent(page), "一時停止中は匂いも変化しない").toBe(scentWhilePaused);

    // 再開すると動き出す
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // 一時停止ボタンを連打しても最終状態がずれない
    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける(ミス数の表示も壊れていない)
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.35 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("truffle-trail-miss")).toContainText("MISS");

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
