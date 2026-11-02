import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/gravity-snap";

// engine/world.ts の的・ハザードは常に盤面の「壁際」にしか出現しない(壁際にしか出現しない
// ことは world.test.ts の「的は常に壁際(いずれかの辺)に出現する」で検証済み)。
// そのため、下→左→上→右→下→左の順に重力方向を切り替えて壁を一巡すると、
// 「左辺を上から下まで一度=下→左のあと左辺全体を上まで(up)」「上辺全体(right)」
// 「右辺全体(down)」「下辺全体を右から左まで(left)」を順番に完全になぞることになり、
// どこに出現していても必ずその辺を通過する。出現位置を画面から読み取れないE2Eでも、
// この操作列だけで的を取れることを幾何学的に保証できる。
const SWEEP_DIRECTIONS = ["down", "left", "up", "right", "down", "left"] as const;

const DIRECTION_TAP_RATIO: Record<
  (typeof SWEEP_DIRECTIONS)[number],
  { xRatio: number; yRatio: number }
> = {
  down: { xRatio: 0.5, yRatio: 0.96 },
  left: { xRatio: 0.04, yRatio: 0.5 },
  up: { xRatio: 0.5, yRatio: 0.04 },
  right: { xRatio: 0.96, yRatio: 0.5 },
};

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("gravity-snap-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function tapDirection(
  page: Page,
  stage: Locator,
  point: { xRatio: number; yRatio: number },
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * point.xRatio, box.y + box.height * point.yRatio);
}

/** 盤面を1周分なぞる(下→左→上→右→下→左)。各方向を `phaseMs` ミリ秒ずつ保持する。 */
async function sweepPerimeterOnce(page: Page, stage: Locator, phaseMs: number): Promise<void> {
  for (const direction of SWEEP_DIRECTIONS) {
    await tapDirection(page, stage, DIRECTION_TAP_RATIO[direction]);
    await page.waitForTimeout(phaseMs);
  }
}

test.describe("Gravity Snap のストーリー", () => {
  test("起動時のHUDが表示され、上下左右のタップで重力方向インジケーターが切り替わる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時のライフは3").toBe(3);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("↓");

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await tapDirection(page, stage, DIRECTION_TAP_RATIO.left);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("←");

    await tapDirection(page, stage, DIRECTION_TAP_RATIO.right);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("→");

    await tapDirection(page, stage, DIRECTION_TAP_RATIO.up);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("↑");

    await tapDirection(page, stage, DIRECTION_TAP_RATIO.down);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("↓");

    // 一時停止するとオーバーレイが出て、スコア表示は変化しなくなる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(pausedScore);

    // 一時停止中にタップしても壊れない
    await tapDirection(page, stage, DIRECTION_TAP_RATIO.left);
    expect(await readScore(page), "一時停止中の操作でスコアが変わらない").toBe(pausedScore);

    // 再開すると操作を再度受け付ける
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await tapDirection(page, stage, DIRECTION_TAP_RATIO.down);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("↓");

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("壁際を一巡する操作で的を取って得点できる", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);

    // 的は壁際にしか出現しないため、この一巡操作だけで出現位置に関係なく必ず捕まえられる。
    await sweepPerimeterOnce(page, stage, 5_000);

    expect(await readScore(page), "壁を一巡すると的を取って得点している").toBeGreaterThanOrEqual(1);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("ハザードに繰り返し当たるとライフが尽きてゲームオーバーになり、やり直せる", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const errors = collectPageErrors(page);

    // 盤面を小さくして壁際までの距離を短くし、1周の所要時間を抑える。
    await page.setViewportSize({ width: 420, height: 320 });
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 的を3つ取るとハザードが1つ出現し、ハザードも壁際に出現するため、
    // 壁を一巡する操作を繰り返せば「的を3つ取る→ハザードに当たり続ける」が
    // 出現位置に関係なく必ず進む。無敵時間(0.8秒)より1周(約15秒)が十分長いため、
    // ハザード出現後は毎周ごとに必ず1回以上ライフが減る。
    const MAX_LAPS = 9;
    let livesAfter = await readLives(page);
    for (let lap = 0; lap < MAX_LAPS && livesAfter > 0; lap++) {
      await sweepPerimeterOnce(page, stage, 2_500);
      livesAfter = await readLives(page);
    }

    expect(livesAfter, `${MAX_LAPS}周以内にライフが尽きる`).toBe(0);
    await expect(page.getByTestId("gravity-snap-gameover")).toBeVisible();

    // やり直すと最初の状態に戻る
    await page.getByTestId("gravity-snap-restart").click();
    await expect(page.getByTestId("gravity-snap-gameover")).toBeHidden();
    expect(await readLives(page), "やり直すとライフが3に戻る").toBe(3);
    expect(await readScore(page), "やり直すとスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバーまでの操作中にエラーが出ていない").toEqual([]);
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
    await tapDirection(page, stage, DIRECTION_TAP_RATIO.right);
    await expect(page.getByTestId("gravity-snap-direction")).toHaveText("→");

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
