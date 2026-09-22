import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/talon-dive";
const PREY_MARKER_TEST_IDS = [
  "talon-dive-prey-marker-0",
  "talon-dive-prey-marker-1",
  "talon-dive-prey-marker-2",
];

async function readStreak(page: Page): Promise<number> {
  const text = await page.getByTestId("talon-dive-streak").innerText();
  const matched = text.match(/STREAK (\d+)/);
  expect(matched, `ストリークの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readMarkerCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} の座標が取得できる`).not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 隼のマーカーの真上へポインタを移動してから押し下げ、以後ドラッグ中の状態を保つ。 */
async function beginSteering(page: Page): Promise<void> {
  const falcon = await readMarkerCenter(page, "talon-dive-falcon-marker");
  await page.mouse.move(falcon.x, falcon.y);
  await page.mouse.down();
}

/** 一番近い獲物マーカーへ向けて、押しっぱなしのポインタを毎回読み直しながら少しずつ動かす。 */
async function steerTowardNearestPreyOnce(page: Page): Promise<void> {
  const falcon = await readMarkerCenter(page, "talon-dive-falcon-marker");
  const candidates = await Promise.all(
    PREY_MARKER_TEST_IDS.map((testId) => readMarkerCenter(page, testId)),
  );
  const nearest = candidates.reduce((closest, candidate) => {
    const distClosest = Math.hypot(closest.x - falcon.x, closest.y - falcon.y);
    const distCandidate = Math.hypot(candidate.x - falcon.x, candidate.y - falcon.y);
    return distCandidate < distClosest ? candidate : closest;
  });
  await page.mouse.move(nearest.x, nearest.y);
  await waitForFrames(page, 3);
}

/** 巣から遠い画面の隅へ向けて、押しっぱなしのポインタを動かし続ける。 */
async function steerAwayFromPerchOnce(page: Page): Promise<void> {
  const stageBox = await page.getByTestId("talon-dive-stage").boundingBox();
  expect(stageBox, "ステージの領域が取得できる").not.toBeNull();
  if (!stageBox) return;
  await page.mouse.move(stageBox.x + stageBox.width * 0.05, stageBox.y + stageBox.height * 0.05);
  await waitForFrames(page, 3);
}

async function readStaminaFillWidth(page: Page): Promise<number> {
  const bar = page.getByTestId("talon-dive-stamina");
  const barBox = await bar.boundingBox();
  const fillBox = await bar.locator("div").boundingBox();
  expect(barBox, "スタミナバーの領域が取得できる").not.toBeNull();
  expect(fillBox, "スタミナ充填部の領域が取得できる").not.toBeNull();
  if (!barBox || !fillBox) return 0;
  return fillBox.width / barBox.width;
}

/** 2枚のスクリーンショットが同じかどうかを返す(一時停止で本当に止まっているかの確認に使う)。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

test.describe("Talon Dive のストーリー", () => {
  test("獲物へ向けて滑空し続けると捕獲でき、得点とストリークが伸びる", async ({ page }) => {
    // ライバルに横取りされて何度かストリークが0に戻っても諦めず狩り続けるため、
    // 余裕を持ったタイムアウトを取る。
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readStreak(page), "開始時のストリークは0").toBe(0);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await beginSteering(page);
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("talon-dive-gameover").isVisible()) {
            await page.getByTestId("talon-dive-restart").click();
            await beginSteering(page);
          }
          await steerTowardNearestPreyOnce(page);
          return readScore(page);
        },
        {
          message: "獲物を追い続けると得点が入る",
          timeout: 75_000,
          intervals: [50],
        },
      )
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("巣の外に留まり続けるとスタミナが尽きて力尽き、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    expect(await readStaminaFillWidth(page), "開始時のスタミナは満タン").toBeGreaterThan(0.95);

    await beginSteering(page);
    await expect
      .poll(
        async () => {
          await steerAwayFromPerchOnce(page);
          return page.getByTestId("talon-dive-gameover").isVisible();
        },
        {
          message: "巣の外に留まり続けるとスタミナが尽きて力尽きる",
          timeout: 45_000,
          intervals: [50],
        },
      )
      .toBe(true);
    await page.mouse.up();

    await expect(page.getByTestId("talon-dive-gameover")).toContainText("SCORE");
    await page.getByTestId("talon-dive-restart").click();
    await expect(page.getByTestId("talon-dive-gameover")).toBeHidden();
    expect(await readStaminaFillWidth(page), "リスタートでスタミナが満タンに戻る").toBeGreaterThan(
      0.95,
    );
    expect(await readStreak(page), "リスタートでストリークが0に戻る").toBe(0);

    expect(errors, "スタミナ切れの前後でエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await expect
      .poll(async () => isFrozen(page, stage, 20), {
        message: "無操作でも獲物が動くため画面は変化する",
      })
      .toBe(false);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中は隼も獲物も完全に止まる").toBe(true);

    // 一時停止中にドラッグ操作をしても、描画も進行も止まったまま
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.4 });
    expect(await isFrozen(page, stage, 20), "一時停止中の操作でも画面は止まったまま").toBe(true);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    expect(await isFrozen(page, stage, 45), "再開すると画面がまた動き出す").toBe(false);

    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
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

    const markerBox = await page.getByTestId("talon-dive-perch-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(markerBox, "リサイズ後も巣の目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (markerBox && stageBox) {
      expect(markerBox.x, "巣がステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(markerBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.55, yRatio: 0.45 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
