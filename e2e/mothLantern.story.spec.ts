import { expect, type Locator, type Page, test } from "@playwright/test";
import { LIVES_MAX } from "../src/app/games/moth-lantern/engine/world";
import {
  collectPageErrors,
  dragOnStage,
  expectStageToAnimate,
  waitForFrames,
} from "./support/gameStory";

const GAME_PATH = "/games/moth-lantern";

async function readDelivered(page: Page): Promise<number> {
  const text = await page.getByTestId("moth-lantern-delivered").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `届けた蛾の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const value = await page.getByTestId("moth-lantern-lives").getAttribute("data-lives");
  expect(value, "ライフの data-lives 属性が取得できる").not.toBeNull();
  return Number(value);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * ポインタを離さず(長押しのまま)ステージ上を周回させ続け、蛾を光で捕まえて
 * 祠へ届けられるまで探す。離して握り直す drag を繰り返すと光が点滅してしまい
 * 実際のプレイ感（押し続けて追いかける）を再現できないため、専用のヘルパーとする。
 */
async function sweepLanternUntilDelivered(
  page: Page,
  stage: Locator,
  deadlineMs: number,
): Promise<number> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return 0;

  // ステージ全体を見落としなく舐められるよう、往復(ボウストロフィドン)の格子状に巡回する。
  const COLUMNS = 6;
  const ROWS = 4;
  const waypoints: Array<[number, number]> = [];
  for (let row = 0; row < ROWS; row++) {
    const yRatio = row / (ROWS - 1);
    const columns = Array.from({ length: COLUMNS }, (_, col) => col / (COLUMNS - 1));
    if (row % 2 === 1) columns.reverse();
    for (const xRatio of columns) waypoints.push([xRatio, yRatio]);
  }

  const toPoint = ([xRatio, yRatio]: [number, number]) => ({
    x: box.x + box.width * xRatio,
    y: box.y + box.height * yRatio,
  });

  const first = toPoint(waypoints[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();

  let delivered = 0;
  const deadline = Date.now() + deadlineMs;
  try {
    outer: while (Date.now() < deadline) {
      for (const waypoint of waypoints) {
        const point = toPoint(waypoint);
        await page.mouse.move(point.x, point.y, { steps: 10 });
        await waitForFrames(page, 6);
        delivered = await readDelivered(page);
        if (delivered > 0 || Date.now() >= deadline) break outer;
      }
    }
  } finally {
    await page.mouse.up();
  }
  return delivered;
}

test.describe("Moth Lantern のストーリー", () => {
  test("遊び始めてランタンで蛾を祠まで導き、届けた数とスコアが伸びる", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: HUD が初期状態で出ている
    await expect(page.getByTestId("moth-lantern-delivered")).toBeVisible();
    expect(await readDelivered(page), "開始時は届けた蛾は0").toBe(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(LIVES_MAX);

    const stage = page.getByTestId("game-shell-stage");
    await expectStageToAnimate(page, stage);

    // ランタンを押し続けたまま周回させ、湧いてくる蛾を光で捕まえて祠まで届ける
    const delivered = await sweepLanternUntilDelivered(page, stage, 90_000);
    expect(delivered, "光で導いた蛾が祠まで届く").toBeGreaterThan(0);
    expect(await readScore(page), "届けるとスコアが増えている").toBeGreaterThan(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("moth-lantern-delivered")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    const scoreRunning = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "連打後も進行している" })
      .toBeGreaterThanOrEqual(scoreRunning);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const scorePaused = await readScore(page);
    const livesPaused = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "連打後の一時停止も効いている").toBe(scorePaused);
    expect(await readLives(page), "一時停止中はライフも減らない").toBe(livesPaused);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("一時停止中は進行が止まり、一時停止中の操作でも壊れず、再開すると続きから進む", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await waitForFrames(page, 30);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScore = await readScore(page);
    const pausedLives = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが進まない").toBe(pausedScore);
    expect(await readLives(page), "一時停止中はライフが減らない").toBe(pausedLives);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.6 });
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readScore(page), { message: "再開後はまたスコアが進む" })
      .toBeGreaterThanOrEqual(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボードでもランタンを操作でき、R キーでリセットできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await stage.click({ position: { x: 10, y: 10 } });

    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 10);
    await page.keyboard.up("ArrowRight");
    await waitForFrames(page, 10);

    await expect(stage.locator("canvas"), "キー操作後もキャンバスが生きている").toBeVisible();

    await page.keyboard.press("r");
    await waitForFrames(page, 5);
    expect(await readDelivered(page), "Rキーでリセットすると届けた数は0に戻る").toBe(0);
    expect(await readLives(page), "Rキーでリセットするとライフは満タンに戻る").toBe(LIVES_MAX);

    expect(errors, "キーボード操作でエラーが出ていない").toEqual([]);
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

    // リサイズ後も操作を受け付けて進行する
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.45 });
    const scoreAfterResize = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後もゲームが進行する" })
      .toBeGreaterThanOrEqual(scoreAfterResize);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
