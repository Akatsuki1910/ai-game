import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/slope-sketch";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readChalkPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("slope-sketch-chalk").innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `チョークの表示から%を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** ボールのやや先（安全地帯の範囲内）に、地面を塗るストロークを一定時間続ける。 */
async function paintAheadForAWhile(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;

  const x = box.x + box.width * 0.45;
  const yTop = box.y + box.height * 0.5;
  const yBottom = box.y + box.height * 0.65;

  await page.mouse.move(x, yTop);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(x, i % 2 === 0 ? yTop : yBottom, { steps: 2 });
    await waitForFrames(page, 4);
  }
  await page.mouse.up();
}

test.describe("Slope Sketch のストーリー", () => {
  test("遊び始めるとスコアが進み、地面を描くとチョークが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("slope-sketch-chalk")).toBeVisible();
    expect(await readChalkPercent(page), "開始時はチョークが満タン").toBe(100);

    // 何もしなくても前進によってスコアが伸びる
    const startScore = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "前進によってスコアが伸びる" })
      .toBeGreaterThan(startScore);

    // ボールの先に地面を描く（このゲームの中心操作）とチョークが減る
    const stage = page.getByTestId("slope-sketch-stage");
    await paintAheadForAWhile(page, stage);
    await waitForFrames(page, 10);

    expect(await readChalkPercent(page), "描くとチョークが減る").toBeLessThan(100);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はスコアが止まり、連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScore = await readScore(page);
    const pausedChalk = await readChalkPercent(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが進まない").toBe(pausedScore);
    expect(await readChalkPercent(page), "一時停止中はチョークも変化しない").toBe(pausedChalk);

    // 一時停止中に操作しても壊れない
    const stage = page.getByTestId("slope-sketch-stage");
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.6 });
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 連打 → 現在は一時停止中。偶数回なので最終的にも一時停止中のはず
    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    // 再開すると進む
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readScore(page), { message: "再開後はスコアがまた進む" })
      .toBeGreaterThan(pausedScore);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("地面を描かずに放置すると滑落してゲームオーバーになり、やり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    // 何も描かずに待つ: 安全地帯を越えた先に地面が無いので必ず滑落する
    await expect(page.getByTestId("slope-sketch-gameover")).toBeVisible({ timeout: 20_000 });

    const finalScore = await readScore(page);
    expect(finalScore, "滑落までにスコアが入っている").toBeGreaterThan(0);

    // ゲームオーバー中は進行が止まっている
    await waitForFrames(page, 30);
    expect(await readScore(page), "ゲームオーバー後はスコアが変化しない").toBe(finalScore);

    // やり直すと最初から遊べる
    await page.getByTestId("slope-sketch-restart").click();
    await expect(page.getByTestId("slope-sketch-gameover")).toBeHidden();
    expect(await readChalkPercent(page), "やり直すとチョークが満タンに戻る").toBe(100);

    await expect
      .poll(() => readScore(page), { message: "やり直した後も前進してスコアが伸びる" })
      .toBeGreaterThan(0);

    expect(errors, "滑落・やり直し中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても描画と操作が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("slope-sketch-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も描画操作を受け付ける
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.55 });
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
