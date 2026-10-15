import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/rapids-slalom";
const STARTING_LIVES = 3;

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("rapids-slalom-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLivesCount(page: Page): Promise<number> {
  const text = await page.getByTestId("rapids-slalom-lives").innerText();
  return [...text].filter((ch) => ch === "🛶").length;
}

async function readMarkerCenterX(page: Page, testId: string): Promise<number | null> {
  const marker = page.getByTestId(testId);
  if (!(await marker.isVisible())) return null;
  const box = await marker.boundingBox();
  return box ? box.x + box.width / 2 : null;
}

/** カヤックのマーカーの中心x座標(画面基準)を返す。 */
async function readKayakX(page: Page): Promise<number> {
  const box = await page.getByTestId("rapids-slalom-kayak-marker").boundingBox();
  expect(box, "カヤックの座標が取得できる").not.toBeNull();
  return box ? box.x + box.width / 2 : 0;
}

/**
 * 次のゲートの隙間中央めがけて短くドラッグし、少しずつ寄せる(1回分のパルス)。
 * 一気に大きく動かそうとすると操舵の慣性で行き過ぎてしまうため、複数回に分けて
 * 呼び出す前提の関数にしてある。
 */
async function steerTowardOnce(page: Page, stage: Locator, targetX: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const kayakX = await readKayakX(page);
  const y = box.y + box.height * 0.7;
  await page.mouse.move(kayakX, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 4 });
  await waitForFrames(page, 6);
  await page.mouse.up();
}

async function steerTowardNextGateOnce(page: Page, stage: Locator): Promise<void> {
  const gateX = await readMarkerCenterX(page, "rapids-slalom-next-gate-marker");
  if (gateX === null) return;
  await steerTowardOnce(page, stage, gateX);
}

/** 2枚のスクリーンショットが同じかどうかを返す(一時停止で本当に止まっているかの確認に使う)。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

test.describe("Rapids Slalom のストーリー", () => {
  test("ゲートの隙間へ操舵し続けると得点とコンボが進む", async ({ page }) => {
    // 途中でゲートを外したり岩に当たってラウンドが終わっても諦めずリスタートして進み続けるため、
    // 余裕を持ったタイムアウトを取る。
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await expect
      .poll(
        async () => {
          if (await page.getByTestId("rapids-slalom-gameover").isVisible()) {
            await page.getByTestId("rapids-slalom-restart").click();
          }
          await steerTowardNextGateOnce(page, stage);
          return readCombo(page);
        },
        {
          message: "ゲートの隙間へ操舵し続けるとコンボが進む",
          timeout: 75_000,
          intervals: [50],
        },
      )
      .toBeGreaterThan(0);

    expect(await readScore(page), "得点も増えている").toBeGreaterThan(0);
    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("ゲートの隙間を外し続けるとライフが減りコンボがリセットされ、尽きるとリスタートできる", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    expect(await readLivesCount(page), "開始時のライフは3").toBe(STARTING_LIVES);

    const stageBox = await stage.boundingBox();
    expect(stageBox, "ステージの領域が取得できる").not.toBeNull();
    if (!stageBox) return;
    const farLeftX = stageBox.x + 4;

    // ゲートの隙間を無視して常に画面端へ操舵し続け、確実に外し続ける。
    await expect
      .poll(
        async () => {
          await steerTowardOnce(page, stage, farLeftX);
          return page.getByTestId("rapids-slalom-gameover").isVisible();
        },
        {
          message: "隙間を外し続けるとライフを使い切りラウンドが終わる",
          timeout: 100_000,
          intervals: [50],
        },
      )
      .toBe(true);
    expect(await readLivesCount(page), "ライフが0になっている").toBe(0);
    expect(await readCombo(page), "コンボは0のまま").toBe(0);

    await page.getByTestId("rapids-slalom-restart").click();
    await expect(page.getByTestId("rapids-slalom-gameover")).toBeHidden();
    expect(await readLivesCount(page), "リスタートでライフが回復する").toBe(STARTING_LIVES);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "隙間を外してもエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await expect
      .poll(async () => isFrozen(page, stage, 20), {
        message: "無操作でも流れで画面は動く",
      })
      .toBe(false);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中はゲートも岩も完全に止まる").toBe(true);

    // 一時停止中にドラッグ操作をしても、描画も進行も止まったまま
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.7 }, { xRatio: 0.3, yRatio: 0.7 });
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

    const kayakBox = await page.getByTestId("rapids-slalom-kayak-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(kayakBox, "リサイズ後もカヤックの目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (kayakBox && stageBox) {
      expect(kayakBox.x, "カヤックがステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(kayakBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.7 }, { xRatio: 0.6, yRatio: 0.7 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作(矢印キー/Enter/Space/R)でも遊べる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await stage.click({ position: { x: 5, y: 5 } });

    await page.keyboard.down("ArrowLeft");
    await waitForFrames(page, 15);
    await page.keyboard.up("ArrowLeft");
    const afterLeft = await readKayakX(page);

    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 30);
    await page.keyboard.up("ArrowRight");
    const afterRight = await readKayakX(page);
    expect(afterRight, "→キーでカヤックが右へ動く").toBeGreaterThan(afterLeft);

    await page.keyboard.press("Enter");
    await waitForFrames(page, 5);

    await page.keyboard.press(" ");
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await page.keyboard.press(" ");
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await page.keyboard.press("r");
    expect(await readScore(page), "Rキーでスコアがリセットされる").toBe(0);
    expect(await readLivesCount(page), "Rキーでライフが回復する").toBe(STARTING_LIVES);

    expect(errors, "キーボード操作でエラーが出ていない").toEqual([]);
  });
});
