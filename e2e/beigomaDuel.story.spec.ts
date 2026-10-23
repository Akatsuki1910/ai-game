import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/beigoma-duel";

async function readSpinPercent(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `スピン表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readPlayerSpin(page: Page): Promise<number> {
  return readSpinPercent(page, "beigoma-duel-player-spin");
}

async function readLivesCount(page: Page): Promise<number> {
  const text = await page.getByTestId("beigoma-duel-lives").innerText();
  return [...text].filter((char) => char === "❤").length;
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("beigoma-duel-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Beigoma Duel のストーリー", () => {
  test("遊び始めてから一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: 両者満タンのスピンでラウンド1、ライフ3から始まる
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readPlayerSpin(page), "開始時は自分のスピンが満タン").toBe(100);
    expect(await readSpinPercent(page, "beigoma-duel-opponent-spin"), "相手のスピンも満タン").toBe(
      100,
    );
    expect(await readRound(page), "ラウンド1から始まる").toBe(1);
    expect(await readLivesCount(page), "ライフは3つ").toBe(3);

    // 何もしなくても時間経過でスピンが減っていく(待つだけの戦略を抑止する仕様)
    await expect
      .poll(() => readPlayerSpin(page), { message: "放置していてもスピンが減っていく" })
      .toBeLessThan(100);

    // ドラッグして引っ張り、離すと逆方向へ発射する(このゲームの中心操作)
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.4 });
    await waitForFrames(page, 20);

    // 一時停止するとオーバーレイが出て、スピンの減少が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedPlayerSpin = await readPlayerSpin(page);
    const pausedOpponentSpin = await readSpinPercent(page, "beigoma-duel-opponent-spin");
    await waitForFrames(page, 60);
    expect(await readPlayerSpin(page), "一時停止中は自分のスピンが減らない").toBe(pausedPlayerSpin);
    expect(
      await readSpinPercent(page, "beigoma-duel-opponent-spin"),
      "一時停止中は相手のスピンも減らない",
    ).toBe(pausedOpponentSpin);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.6 });
    expect(await readPlayerSpin(page), "一時停止中の操作でスピンが動かない").toBe(pausedPlayerSpin);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readPlayerSpin(page), { message: "再開後はまたスピンが減る" })
      .toBeLessThanOrEqual(pausedPlayerSpin);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンやステージへの連打操作でも壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    // 再開してからステージをタップで連打(ドラッグせず発射を繰り返す)。
    // クールダウン中の発射は無視されるだけで、エラーも状態のずれも起きないはず。
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const stage = page.getByTestId("game-shell-stage");
    for (let i = 0; i < 8; i++) {
      await stage.click({ position: { x: 20, y: 20 } });
    }
    await waitForFrames(page, 20);

    await expect
      .poll(() => readPlayerSpin(page), { message: "連打後も進行している(スピンが減っている)" })
      .toBeLessThan(100);

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
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.25, yRatio: 0.3 });
    await expect
      .poll(() => readPlayerSpin(page), { message: "リサイズ後もスピンが減っていく" })
      .toBeLessThan(100);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
