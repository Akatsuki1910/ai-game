import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/noise-null";

async function readCalm(page: Page): Promise<number> {
  const text = await page.getByTestId("noise-null-calm").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `CALM表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Noise Null のストーリー", () => {
  test("放置するとCALMが減り、ドラッグで操作し一時停止・再開までを通しで操作できる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: スコア0・CALM満タンで始まる
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    const startedCalm = await readCalm(page);
    expect(startedCalm, "CALMはほぼ満タンで始まる").toBeGreaterThanOrEqual(90);

    // 何も操作しない(振幅0=打ち消せていない)と、CALMが実際に減っていく
    await expect
      .poll(() => readCalm(page), { message: "放置するとCALMが減る" })
      .toBeLessThan(startedCalm);

    // ドラッグでダイヤルを操作する（このゲームの中心操作）
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.8, yRatio: 0.3 });
    await waitForFrames(page, 20);

    // 一時停止するとオーバーレイが出て、CALMが変化しなくなる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedCalm = await readCalm(page);
    await waitForFrames(page, 60);
    expect(await readCalm(page), "一時停止中はCALMが変化しない").toBe(pausedCalm);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.8, yRatio: 0.3 }, { xRatio: 0.3, yRatio: 0.7 });
    expect(await readCalm(page), "一時停止中の操作でCALMが動かない").toBe(pausedCalm);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await waitForFrames(page, 20);
    await expect(page.getByTestId("noise-null-residual")).toBeVisible();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
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

    const runningCalm = await readCalm(page);
    await expect
      .poll(() => readCalm(page), { message: "連打後も進行している(CALMが減っていく)" })
      .toBeLessThan(runningCalm);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedCalm = await readCalm(page);
    await waitForFrames(page, 60);
    expect(await readCalm(page), "連打後の一時停止も効いている").toBe(pausedCalm);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("ゲームオーバーになったらリスタートで最初からやり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 一切操作せず放置するとCALMが尽きてゲームオーバーになる
    await expect(page.getByTestId("noise-null-gameover")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("noise-null-restart").click();
    await expect(page.getByTestId("noise-null-gameover")).toBeHidden();
    expect(await readCalm(page), "リスタートでCALMがほぼ満タンに戻る").toBeGreaterThanOrEqual(90);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバー・リスタート中にエラーが出ていない").toEqual([]);
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
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.65, yRatio: 0.4 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "リサイズ後の操作でも壊れない").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
