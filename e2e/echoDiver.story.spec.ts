import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/echo-diver";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readSonarCharges(page: Page): Promise<number> {
  const text = await page.getByTestId("echo-diver-sonar").innerText();
  return (text.match(/●/g) ?? []).length;
}

test.describe("Echo Diver のストーリー", () => {
  test("遊び始めてから一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: スコアとソナー充電が出ている
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    const startScore = await readScore(page);
    expect(await readSonarCharges(page), "開始時はソナーが満タン").toBe(3);

    // 生存しているだけでスコアが進む
    await expect
      .poll(() => readScore(page), { message: "時間経過でスコアが増える" })
      .toBeGreaterThan(startScore);

    // ドラッグ(長押し)は移動であり、ソナーは消費しない
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.7, yRatio: 0.3 });
    await waitForFrames(page, 10);
    expect(await readSonarCharges(page), "ドラッグ移動ではソナーは減らない").toBe(3);

    // 短いタップ(クリック)はソナー発信であり、充電を1つ消費する
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await waitForFrames(page, 5);
    expect(await readSonarCharges(page), "タップでソナーを1つ消費する").toBe(2);

    // 一時停止するとオーバーレイが出て、スコアが止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScore = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが増えない").toBe(pausedScore);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.7 });
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readScore(page), { message: "再開後はまたスコアが増える" })
      .toBeGreaterThan(pausedScore);

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

    const runningScore = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "連打後も進行している" })
      .toBeGreaterThan(runningScore);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedScore = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "連打後の一時停止も効いている").toBe(pausedScore);

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
    const scoreAfterResize = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後もスコアが進む" })
      .toBeGreaterThan(scoreAfterResize);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
