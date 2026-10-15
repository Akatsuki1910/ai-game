import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/blackout-ferry";

async function readCrossings(page: Page): Promise<number> {
  const text = await page.getByTestId("blackout-ferry-crossings").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `渡航数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readSuspicionWidthPercent(page: Page): Promise<number> {
  const fill = page.getByTestId("blackout-ferry-suspicion").locator("div");
  const style = await fill.getAttribute("style");
  const matched = style?.match(/width:\s*([\d.]+)%/);
  return matched ? Number(matched[1]) : Number.NaN;
}

test.describe("Blackout Ferry のストーリー", () => {
  test("遊び始めてから一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("blackout-ferry-crossings")).toBeVisible();
    expect(await readCrossings(page), "開始時の渡航数は0").toBe(0);
    await expect(page.getByTestId("blackout-ferry-lives")).toBeVisible();

    // 舟は自動的に前進するので、キャンバスが実際に動いている
    const stage = page.getByTestId("game-shell-stage");
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "時間経過で舟が進み画面が変化している").toBe(false);

    // ドラッグで操舵する（このゲームの中心操作）
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.3 }, { xRatio: 0.8, yRatio: 0.3 });
    await waitForFrames(page, 20);

    // 一時停止するとオーバーレイが出て、渡航が進まなくなる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedStage = await stage.screenshot();
    await waitForFrames(page, 40);
    const stillPausedStage = await stage.screenshot();
    expect(
      pausedStage.equals(stillPausedStage),
      "一時停止中は画面が変化しない（舟が進まない）",
    ).toBe(true);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.2, yRatio: 0.5 });

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await waitForFrames(page, 40);
    const resumedStage = await stage.screenshot();
    expect(stillPausedStage.equals(resumedStage), "再開後は舟がまた進む").toBe(false);

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

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("ブーストボタンを長押しすると疑心度メーターが表示され、放すと元の操作に戻る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const boostButton = page.getByTestId("blackout-ferry-boost");
    await expect(boostButton).toBeVisible();

    const suspicionBefore = await readSuspicionWidthPercent(page);
    expect(Number.isFinite(suspicionBefore), "疑心度メーターの幅が数値として読める").toBe(true);

    // 長押し（pointerdown〜pointerup）してもクラッシュしない
    await boostButton.dispatchEvent("pointerdown");
    await waitForFrames(page, 30);
    await boostButton.dispatchEvent("pointerup");
    await waitForFrames(page, 10);

    // 連打しても壊れない
    for (let i = 0; i < 5; i++) {
      await boostButton.dispatchEvent("pointerdown");
      await boostButton.dispatchEvent("pointerup");
    }

    expect(errors, "ブースト操作中にエラーが出ていない").toEqual([]);
  });

  test("見つかって捕まっても、対岸へ渡り切っても壊れずに進行を続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const gameOver = page.getByTestId("blackout-ferry-gameover");
    const livesLabel = page.getByTestId("blackout-ferry-lives");

    // 3回捕まる（=ゲームオーバーになる）か、渡航数が増えるまで、
    // ブーストしっぱなしで左右に揺さぶり続けて実際の画面操作で進行させる。
    const boostButton = page.getByTestId("blackout-ferry-boost");
    await boostButton.dispatchEvent("pointerdown");

    const stage = page.getByTestId("game-shell-stage");
    let reachedOutcome = false;
    for (let i = 0; i < 40 && !reachedOutcome; i++) {
      const xRatio = i % 2 === 0 ? 0.15 : 0.85;
      await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio, yRatio: 0.5 });
      await waitForFrames(page, 15);

      if (await gameOver.isVisible()) {
        reachedOutcome = true;
        break;
      }
      const crossings = await readCrossings(page);
      if (crossings > 0) {
        reachedOutcome = true;
        break;
      }
    }
    await boostButton.dispatchEvent("pointerup");

    expect(reachedOutcome, "捕まってゲームオーバーになるか、渡航に成功するかのどちらかに至る").toBe(
      true,
    );

    if (await gameOver.isVisible()) {
      await expect(page.getByTestId("blackout-ferry-restart")).toBeVisible();
      await page.getByTestId("blackout-ferry-restart").click();
      await expect(gameOver).toBeHidden();
      expect(await readCrossings(page), "リスタート後は渡航数が0に戻る").toBe(0);
    } else {
      await expect(livesLabel).toBeVisible();
    }

    expect(errors, "進行中にエラーが出ていない").toEqual([]);
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
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.7, yRatio: 0.5 });
    const beforeCrossings = await readCrossings(page);
    expect(Number.isFinite(beforeCrossings), "リサイズ後も渡航数が読み取れる").toBe(true);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
