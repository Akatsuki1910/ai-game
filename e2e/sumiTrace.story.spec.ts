import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/sumi-trace";

// 1画目のガイド(STROKE_TEMPLATES[0])を折れ線の比率で表したもの。
// ランダム生成ではなく固定パターンなので、実画面でもこの比率どおりに辿れば必ずなぞり切れる。
const FIRST_GUIDE_RATIOS = [
  { x: 0.2, y: 0.42 },
  { x: 0.5, y: 0.38 },
  { x: 0.8, y: 0.44 },
];

async function toPixel(stage: Locator, ratio: { x: number; y: number }) {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) throw new Error("stage bounding box is null");
  return { x: box.x + box.width * ratio.x, y: box.y + box.height * ratio.y };
}

/** 1画目のガイドを起点から終点まで連続ドラッグでなぞる（筆は途中で上げない）。 */
async function traceFirstGuideToCompletion(page: Page, stage: Locator): Promise<void> {
  const first = await toPixel(stage, FIRST_GUIDE_RATIOS[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < FIRST_GUIDE_RATIOS.length; i++) {
    const p = await toPixel(stage, FIRST_GUIDE_RATIOS[i]);
    await page.mouse.move(p.x, p.y, { steps: 3 });
  }
  await page.mouse.up();
}

/**
 * 起点を掴んだあと、ガイドから大きく外れた場所に筆を置いたままにする（ミスを起こす）。
 * 起点と同じx比率のまま真下へ動かすことで、横画のガイド(y比率0.38〜0.44付近)の上を
 * 通過せずに一直線でガイド外へ出す（斜めに動かすとガイドの近くを通って誤って進行してしまう）。
 */
async function grabAndDriftOffGuide(page: Page, stage: Locator): Promise<void> {
  const first = await toPixel(stage, FIRST_GUIDE_RATIOS[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  const farBelow = await toPixel(stage, { x: FIRST_GUIDE_RATIOS[0].x, y: 0.95 });
  await page.mouse.move(farBelow.x, farBelow.y);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("sumi-trace-lives-count").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `残機の表示から数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Sumi Trace のストーリー", () => {
  test("ガイドをなぞり切って1画完成させ、得点できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時の残機は3").toBe(3);

    const stage = page.getByTestId("sumi-trace-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await traceFirstGuideToCompletion(page, stage);

    await expect
      .poll(() => readScore(page), { message: "なぞり切ると得点が入る" })
      .toBeGreaterThan(0);
    // なぞり終えた直後は筆が上がり、残機は減っていないはず。
    expect(await readLives(page), "ガイドをなぞり切っただけでは残機は減らない").toBe(3);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はなぞっても進まず、再開すると続きから操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("sumi-trace-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    await traceFirstGuideToCompletion(page, stage);
    await waitForFrames(page, 30);
    expect(await readScore(page), "一時停止中はなぞっても得点が入らない").toBe(0);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await traceFirstGuideToCompletion(page, stage);
    await expect
      .poll(() => readScore(page), { message: "再開後はなぞれば得点が入る" })
      .toBeGreaterThan(0);

    expect(errors, "一時停止・再開でエラーが出ていない").toEqual([]);
  });

  test("ガイドから外れて粘るとミスになり、3回ミスするとゲームオーバー→やり直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("sumi-trace-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 3; i++) {
      const livesBefore = await readLives(page);
      await grabAndDriftOffGuide(page, stage);
      await expect
        .poll(() => readLives(page), {
          message: `${i + 1}回目: ガイド外に粘ると残機が減る`,
          timeout: 10_000,
        })
        .toBeLessThan(livesBefore);
      await page.mouse.up();
    }

    await expect(page.getByTestId("sumi-trace-gameover")).toBeVisible();
    expect(await readLives(page), "ゲームオーバー時点で残機は0").toBe(0);

    await page.getByTestId("sumi-trace-restart").click();
    await expect(page.getByTestId("sumi-trace-gameover")).toBeHidden();
    expect(await readLives(page), "やり直すと残機が3に戻る").toBe(3);
    expect(await readScore(page), "やり直すとスコアが0に戻る").toBe(0);

    // やり直した後も操作できることを確認する。
    await traceFirstGuideToCompletion(page, stage);
    await expect
      .poll(() => readScore(page), { message: "やり直した後もなぞれば得点が入る" })
      .toBeGreaterThan(0);

    expect(errors, "ゲームオーバー・やり直し中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("sumi-trace-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も、同じ比率でなぞれば操作を受け付ける
    await traceFirstGuideToCompletion(page, stage);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後もなぞれば得点が入る" })
      .toBeGreaterThan(0);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
