import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/soroban-rush";

async function readDigits(page: Page, testId: string): Promise<string> {
  // 初回描画直後は値がまだ反映されていないことがあるため、数字が出るまで待つ。
  await expect(page.getByTestId(testId)).toContainText(/\d/);
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `"${testId}" の表示から数字を読み取れる: "${text}"`).not.toBeNull();
  return matched?.[1] ?? "";
}

async function readLivesCount(page: Page): Promise<number> {
  const text = await page.getByTestId("soroban-rush-lives").innerText();
  return Array.from(text).filter((ch) => ch === "♥").length;
}

/** 現在のラウンドの目標と同じ数になるよう、キーボード操作で珠を合わせて決定する。 */
async function solveCurrentRoundWithKeyboard(page: Page): Promise<void> {
  const target = await readDigits(page, "soroban-rush-target");
  const digits = target.split("").map(Number);

  for (let rodIndex = 0; rodIndex < digits.length; rodIndex++) {
    for (let i = 0; i < digits[rodIndex]; i++) {
      await page.keyboard.press("ArrowUp");
    }
    await page.keyboard.press("ArrowRight");
  }
  await page.keyboard.press("Enter");
}

test.describe("Soroban Rush のストーリー", () => {
  test("珠をドラッグで操作して正解を決定すると得点してライフは減らない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("soroban-rush-target")).toBeVisible();
    expect(await readLivesCount(page), "開始時のライフは3").toBe(3);

    const target = await readDigits(page, "soroban-rush-target");
    const digits = target.split("").map(Number);
    const stageBox = await page.getByTestId("soroban-rush-canvas").boundingBox();
    expect(stageBox, "キャンバスの領域が取得できる").not.toBeNull();
    if (!stageBox) return;

    // 2桁の盤面を前提に、各桁をドラッグで目標の値に合わせる（下側ゾーンの高さ比率で1珠の数を決める）。
    // 比率は SorobanRushGame.tsx の computeLayout() と同じ式
    // (frameTop=0.14 / frameBottom=0.88 / 梁=frameTop + (frameBottom-frameTop)*0.22) に合わせている。
    const rodXRatios = [0.3, 0.7];
    const barYRatio = 0.14 + (0.88 - 0.14) * 0.22;
    const earthBottomRatio = 0.88;

    for (let rodIndex = 0; rodIndex < digits.length; rodIndex++) {
      const digit = digits[rodIndex];
      const isHeavenDown = digit >= 5;
      const earthCount = isHeavenDown ? digit - 5 : digit;
      const x = stageBox.x + stageBox.width * rodXRatios[rodIndex];

      if (isHeavenDown) {
        const heavenY = stageBox.y + stageBox.height * (barYRatio * 0.5);
        await page.mouse.click(x, heavenY);
      }

      if (earthCount > 0) {
        const ratio = earthCount / 4;
        const earthY =
          stageBox.y +
          stageBox.height * barYRatio +
          (1 - ratio) * (stageBox.height * (earthBottomRatio - barYRatio));
        await page.mouse.move(x, stageBox.y + stageBox.height * earthBottomRatio);
        await page.mouse.down();
        await page.mouse.move(x, earthY, { steps: 5 });
        await page.mouse.up();
      }
    }

    await waitForFrames(page, 10);
    expect(await readDigits(page, "soroban-rush-current"), "珠の操作どおりの数になっている").toBe(
      target,
    );

    const scoreBefore = Number(
      (await page.getByTestId("game-shell-score").innerText()).replace(/\D/g, ""),
    );
    await page.getByTestId("soroban-rush-submit").click();

    await expect(page.getByTestId("soroban-rush-feedback")).toBeVisible();
    await expect
      .poll(
        async () =>
          Number((await page.getByTestId("game-shell-score").innerText()).replace(/\D/g, "")),
        { message: "正解して得点が増える" },
      )
      .toBeGreaterThan(scoreBefore);
    expect(await readLivesCount(page), "正解してもライフは減らない").toBe(3);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("間違った数で決定するとライフが減り、キーボードで何ラウンドか進めて一時停止・リセットも機能する", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await page.getByTestId("soroban-rush-canvas").click();

    // 間違った数のまま決定を連打 → ライフが減っていく
    await page.keyboard.press("Enter");
    await expect
      .poll(() => readLivesCount(page), { message: "不正解でライフが減る" })
      .toBeLessThan(3);

    const livesAfterFirstMiss = await readLivesCount(page);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    expect(
      await readLivesCount(page),
      "再挑戦してもまた不正解ならライフが減る",
    ).toBeLessThanOrEqual(livesAfterFirstMiss);

    // 正しい数をキーボードで作って決定 → ラウンドが進む
    await solveCurrentRoundWithKeyboard(page);
    await expect(page.getByTestId("soroban-rush-feedback")).toBeVisible();

    // 一時停止すると操作してもタイマーが進まない
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const timerBar = page.getByTestId("soroban-rush-timer").locator("div");
    const pausedWidth = await timerBar.evaluate((el) => el.getBoundingClientRect().width);
    await waitForFrames(page, 60);
    const stillPausedWidth = await timerBar.evaluate((el) => el.getBoundingClientRect().width);
    expect(stillPausedWidth, "一時停止中はタイマーが進まない").toBe(pausedWidth);

    // 一時停止中に操作(決定はせず珠の調整のみ)しても壊れない
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // リセットすると最初の状態に戻る
    await page.keyboard.press("r");
    await waitForFrames(page, 5);
    expect(await readLivesCount(page), "リセットでライフが3に戻る").toBe(3);
    expect(
      Number((await page.getByTestId("game-shell-score").innerText()).replace(/\D/g, "")),
      "リセットでスコアが0に戻る",
    ).toBe(0);

    expect(errors, "一連の操作中にエラーが出ていない").toEqual([]);
  });

  test("連打してもゲームオーバーから正しくリスタートできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await page.getByTestId("soroban-rush-canvas").click();

    // 間違った数のまま決定を連打してライフを尽きさせる
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Enter");
      if (await page.getByTestId("soroban-rush-gameover").isVisible()) break;
    }

    await expect(page.getByTestId("soroban-rush-gameover")).toBeVisible();

    // ゲームオーバー中にさらに連打しても壊れない
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("soroban-rush-gameover")).toBeVisible();

    await page.getByTestId("soroban-rush-restart").click();
    await expect(page.getByTestId("soroban-rush-gameover")).toBeHidden();
    expect(await readLivesCount(page), "リスタートでライフが3に戻る").toBe(3);
    expect(
      Number((await page.getByTestId("game-shell-score").innerText()).replace(/\D/g, "")),
      "リスタートでスコアが0に戻る",
    ).toBe(0);

    expect(errors, "ゲームオーバー〜リスタート中にエラーが出ていない").toEqual([]);
  });
});
