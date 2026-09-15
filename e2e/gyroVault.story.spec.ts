import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/gyro-vault";

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("gyro-vault-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Gyro Vault のストーリー", () => {
  test("遊び始めてから傾けて転がし、一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: スコア・タイマー・クリア数が出ている
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    await expect(page.getByTestId("gyro-vault-goal-count")).toHaveText("🏆 0");
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);

    // ラウンドが実際に進む
    await expect
      .poll(() => readTimerSeconds(page), { message: "残り時間が減っていく" })
      .toBeLessThan(startedAt);

    // 盤面をドラッグで傾けてボールを転がす（このゲームの中心操作）
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.75, yRatio: 0.6 });
    await waitForFrames(page, 20);

    // 一時停止するとオーバーレイが出て、時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.4 }, { xRatio: 0.6, yRatio: 0.6 });
    expect(await readTimerSeconds(page), "一時停止中の操作で時間が動かない").toBe(pausedAt);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("矢印キー/WASDでも盤面を傾けられ、Rキーでリセットできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await stage.click({ position: { x: 10, y: 10 } });

    // 矢印キーを押し続けて盤面を傾ける
    const timeBeforeMove = await readTimerSeconds(page);
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 40);
    await page.keyboard.up("ArrowRight");
    expect(await readTimerSeconds(page), "キー操作中もラウンドが進む").toBeLessThan(timeBeforeMove);

    // Rキーでリセットすると最初からになる
    await page.keyboard.down("KeyD");
    await waitForFrames(page, 10);
    await page.keyboard.up("KeyD");
    await page.keyboard.press("r");
    await expect(page.getByTestId("gyro-vault-goal-count")).toHaveText("🏆 0");
    expect(await readScore(page), "リセットでスコアが0に戻る").toBe(0);
    expect(await readTimerSeconds(page), "リセットで残り時間が戻る").toBeGreaterThan(85);

    expect(errors, "キー操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    const runningAt = await readTimerSeconds(page);
    await expect
      .poll(() => readTimerSeconds(page), { message: "連打後も進行している" })
      .toBeLessThan(runningAt);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "連打後の一時停止も効いている").toBe(pausedAt);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
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

    // リサイズ後も操作を受け付ける
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.4 });
    await expect
      .poll(() => readTimerSeconds(page), { message: "リサイズ後もラウンドが進む" })
      .toBeLessThan(90);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
