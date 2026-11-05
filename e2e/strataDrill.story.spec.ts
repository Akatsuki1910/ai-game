import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/strata-drill";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readDepth(page: Page): Promise<number> {
  const text = await page.getByTestId("strata-drill-depth").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `深度の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readHeatPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("strata-drill-heat").innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `熱の表示から%を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** ステージ中央をポインタで押し続ける（離すのは呼び出し側の責務）。 */
async function pressStageCenter(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.down();
}

test.describe("Strata Drill のストーリー", () => {
  test("ポインタを押し続けると深度とスコアが進み、離すと止まる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("strata-drill-depth")).toBeVisible();
    await expect(page.getByTestId("strata-drill-heat")).toBeVisible();

    // 何もしなければ深度もスコアも進まない
    await waitForFrames(page, 20);
    expect(await readDepth(page), "操作しない間は深度が進まない").toBe(0);
    expect(await readScore(page), "操作しない間はスコアが進まない").toBe(0);

    const stage = page.getByTestId("strata-drill-stage");
    await pressStageCenter(page, stage);

    await expect
      .poll(() => readDepth(page), { message: "押し続けると深度が進む" })
      .toBeGreaterThan(0);
    await expect
      .poll(() => readHeatPercent(page), { message: "ドリル中は熱が上がる" })
      .toBeGreaterThan(0);

    await page.mouse.up();
    const depthAfterRelease = await readDepth(page);
    await waitForFrames(page, 30);
    expect(await readDepth(page), "離すと深度が止まる").toBe(depthAfterRelease);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("熱が溜まりすぎるとドリルが自壊してゲームオーバーになり、やり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const stage = page.getByTestId("strata-drill-stage");
    await pressStageCenter(page, stage);

    // 離さずに押し続けると熱が上限に達し、過熱でゲームオーバーになる
    await expect(page.getByTestId("strata-drill-gameover")).toBeVisible({ timeout: 15_000 });
    await page.mouse.up();

    const finalScore = await readScore(page);
    expect(finalScore, "ゲームオーバーまでにスコアが入っている").toBeGreaterThan(0);

    // ゲームオーバー中は進行が止まっている
    await waitForFrames(page, 30);
    expect(await readScore(page), "ゲームオーバー後はスコアが変化しない").toBe(finalScore);

    // やり直すと最初から遊べる
    await page.getByTestId("strata-drill-restart").click();
    await expect(page.getByTestId("strata-drill-gameover")).toBeHidden();
    expect(await readDepth(page), "やり直すと深度が0に戻る").toBe(0);
    expect(await readHeatPercent(page), "やり直すと熱が0に戻る").toBe(0);

    await pressStageCenter(page, stage);
    await expect
      .poll(() => readDepth(page), { message: "やり直した後も押し続けると深度が進む" })
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(errors, "過熱・やり直し中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は進行が止まり、連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const stage = page.getByTestId("strata-drill-stage");
    await pressStageCenter(page, stage);
    await expect
      .poll(() => readDepth(page), { message: "押し続けると深度が進む" })
      .toBeGreaterThan(0);
    await page.mouse.up();

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedDepth = await readDepth(page);
    const pausedHeat = await readHeatPercent(page);

    // 一時停止中に押し続けても進行しない
    await pressStageCenter(page, stage);
    await waitForFrames(page, 40);
    expect(await readDepth(page), "一時停止中は深度が進まない").toBe(pausedDepth);
    expect(await readHeatPercent(page), "一時停止中は熱も変化しない").toBe(pausedHeat);
    await page.mouse.up();

    // 連打 → 偶数回なので最終的にも一時停止中のはず
    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    // 再開して押し続けるとまた進む
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await pressStageCenter(page, stage);
    await expect
      .poll(() => readDepth(page), { message: "再開後に押し続けると深度がさらに進む" })
      .toBeGreaterThan(pausedDepth);
    await page.mouse.up();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても描画と操作が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("strata-drill-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操舵ドラッグを受け付ける
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.3 }, { xRatio: 0.7, yRatio: 0.3 });
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
