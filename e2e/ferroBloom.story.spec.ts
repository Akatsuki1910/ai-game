import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/ferro-bloom";

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("ferro-bloom-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("ferro-bloom-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** ターゲット中心を示すマーカー要素から、画面上での中心座標を取得する。 */
async function readTargetCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("ferro-bloom-target-marker").boundingBox();
  expect(box, "ターゲットの目印の座標が取得できる").not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 2枚のスクリーンショットが同じかどうかを返す（一時停止で本当に止まっているかの確認に使う）。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

test.describe("Ferro Bloom のストーリー", () => {
  test("磁石でターゲットへ粒子を導き続けると満たしてコンボと得点が進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    await expect(page.getByTestId("ferro-bloom-mode")).toHaveText("⊕ 引力");

    // ターゲットの目印はゲームループが最初のフレームを処理してから正しい位置になるため、
    // canvas表示後に数フレーム待ってから座標を読む。
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    // ターゲットの中心へ長押しでドラッグし続け、砂鉄を引き寄せて満たす
    const center = await readTargetCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();

    await expect
      .poll(() => readCombo(page), {
        message: "磁石で引き寄せ続けるとターゲットを満たしてコンボが進む",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await page.mouse.up();

    expect(await readScore(page), "得点も増えている").toBeGreaterThan(0);
    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("タップ、またはボタンで引力⇔斥力を切り替えられる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const modeButton = page.getByTestId("ferro-bloom-mode");
    await expect(modeButton).toHaveText("⊕ 引力");
    await expect(modeButton).toHaveAttribute("aria-pressed", "false");

    // ボタンでの切り替え
    await modeButton.click();
    await expect(modeButton).toHaveText("⊖ 斥力");
    await expect(modeButton).toHaveAttribute("aria-pressed", "true");

    await modeButton.click();
    await expect(modeButton).toHaveText("⊕ 引力");

    // ステージ上のタップ（ドラッグなし）でも切り替わる。UIオーバーレイと重ならない中央で行う。
    const stage = page.getByTestId("game-shell-stage");
    const stageBox = await stage.boundingBox();
    expect(stageBox, "ステージの領域が取得できる").not.toBeNull();
    if (stageBox) {
      await page.mouse.click(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
    }
    await expect(modeButton).toHaveText("⊖ 斥力");

    // ドラッグ（タップではない操作）ではモードが変わらないことも確認する
    await dragOnStage(page, stage, { xRatio: 0.2, yRatio: 0.2 }, { xRatio: 0.7, yRatio: 0.6 });
    await expect(modeButton, "ドラッグ操作ではモードは切り替わらない").toHaveText("⊖ 斥力");

    expect(errors, "モード切替でエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、再開すると動き出す。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const runningAt = await readTimerSeconds(page);
    await expect
      .poll(() => readTimerSeconds(page), { message: "無操作でも時間は進む" })
      .toBeLessThan(runningAt);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中は粒子も完全に止まる").toBe(true);

    const pausedAt = await readTimerSeconds(page);

    // 一時停止中にドラッグ操作をしても、描画も時間も止まったまま
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.4 });
    expect(await isFrozen(page, stage, 20), "一時停止中の操作でも画面は止まったまま").toBe(true);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

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

    // リサイズ後もターゲットの目印が画面内にあり、ドラッグ操作を受け付ける
    const markerBox = await page.getByTestId("ferro-bloom-target-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(markerBox, "リサイズ後もターゲットの目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (markerBox && stageBox) {
      expect(markerBox.x, "ターゲットがステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(markerBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.55, yRatio: 0.45 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
