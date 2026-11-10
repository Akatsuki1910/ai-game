import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/kingyo-scoop";
// 金魚は池の中の固定スロット(定位置)を中心に揺れながら泳ぐだけで、池の中を逃げ回ったりしない
// (engine/world.ts の spawnFish / placeFishAtHome を参照)。このスロットの1つをステージ比率で
// 直接指定して網を置き続ければ、読み込みにかかった時間に関係なく確実に重なる。
const FISH_HOME_RATIO = { xRatio: 0.2, yRatio: 0.5 } as const;
// 定位置に網を置いて押したままにしておけば、CATCH_TIME(0.5秒)後に確実にすくえる
// (エンジン単体シミュレーションで、読み込み遅延があっても常にすくえることを確認済み)。
const CATCH_POLL_TIMEOUT_MS = 10_000;
// 浸けたまま素早く振り続けると、紙の耐久度は十数秒以内に確実に尽きる
// (エンジン単体シミュレーションで100フレーム未満で耐久度0に達することを確認済み)。
const BREAK_POLL_TIMEOUT_MS = 30_000;

async function readDurability(page: Page): Promise<number> {
  const text = await page.getByTestId("kingyo-scoop-durability").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `耐久度表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function waitForCanvas(page: Page): Promise<Locator> {
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();
  return stage;
}

async function pointAt(
  stage: Locator,
  ratio: { xRatio: number; yRatio: number },
): Promise<{ x: number; y: number }> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width * ratio.xRatio, y: box.y + box.height * ratio.yRatio };
}

/** 金魚の定位置の上に網を移動し、押したまま(浸けたまま)にする。呼び出し側で離すこと。 */
async function holdNetOnFish(page: Page, stage: Locator): Promise<void> {
  const point = await pointAt(stage, FISH_HOME_RATIO);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
}

/** 浸けたまま画面の対角(金魚の定位置からは十分離れた位置)を素早く往復する。 */
async function thrashNet(page: Page, stage: Locator): Promise<void> {
  const corner1 = await pointAt(stage, { xRatio: 0.06, yRatio: 0.08 });
  const corner2 = await pointAt(stage, { xRatio: 0.94, yRatio: 0.92 });

  await page.mouse.move(corner1.x, corner1.y);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) {
    const target = i % 2 === 0 ? corner2 : corner1;
    await page.mouse.move(target.x, target.y, { steps: 2 });
  }
}

test.describe("Kingyo Scoop のストーリー", () => {
  test("起動直後は耐久度満タン・スコア0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("kingyo-scoop-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readDurability(page), "開始時は耐久度が満タン").toBe(100);

    await waitForCanvas(page);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("金魚の定位置に網を置いて押さえ続けるとすくえて、スコアが伸びて耐久度が減る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await holdNetOnFish(page, stage);

    await expect
      .poll(() => readScore(page), {
        message: "定位置で押さえ続けると金魚をすくえてスコアが伸びる",
        timeout: CATCH_POLL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    await page.mouse.up();

    expect(await readDurability(page), "すくうと紙が傷み耐久度が減る").toBeLessThan(100);

    expect(errors, "すくっている間にエラーが出ていない").toEqual([]);
  });

  test("浸けたまま素早く動かし続けると、すくえずに耐久度だけが減っていく", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    const durabilityBefore = await readDurability(page);
    await thrashNet(page, stage);

    await expect
      .poll(() => readDurability(page), {
        message: "素早く振り続けると耐久度が減る",
        timeout: BREAK_POLL_TIMEOUT_MS,
      })
      .toBeLessThan(durabilityBefore);

    expect(await readScore(page), "すくわずに振り続けている間はスコアが増えない").toBe(0);

    await page.mouse.up();
    expect(errors, "振り続けている間にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は耐久度が変わらず、連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await holdNetOnFish(page, stage);
    await expect
      .poll(() => readScore(page), {
        message: "まず1匹すくう",
        timeout: CATCH_POLL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);
    await page.mouse.up();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const durabilityWhilePaused = await readDurability(page);
    await waitForFrames(page, 60);
    expect(await readDurability(page), "一時停止中は耐久度が変わらない").toBe(
      durabilityWhilePaused,
    );

    // 一時停止中に網を動かしても状態は進行しない
    await thrashNet(page, stage);
    await page.mouse.up();
    expect(await readDurability(page), "一時停止中の操作で耐久度が変わらない").toBe(
      durabilityWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "一時停止・連打中にエラーが出ていない").toEqual([]);
  });

  test("耐久度が尽きるとポイが破れてゲームオーバーになり、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const gameOver = page.getByTestId("kingyo-scoop-gameover");

    for (let i = 0; i < 6 && !(await gameOver.isVisible()); i++) {
      await thrashNet(page, stage);
    }
    await page.mouse.up();

    await expect(gameOver, "耐久度が尽きるとゲームオーバー表示になる").toBeVisible({
      timeout: BREAK_POLL_TIMEOUT_MS,
    });
    expect(await readDurability(page), "ゲームオーバー時は耐久度が0").toBe(0);

    await page.getByTestId("kingyo-scoop-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readDurability(page), "リスタートで耐久度が満タンに戻る").toBe(100);

    expect(errors, "ゲームオーバーからリスタートまででエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後もすくい続けられる
    await holdNetOnFish(page, stage);
    await expect
      .poll(() => readScore(page), {
        message: "リサイズ後もスコアが伸びる",
        timeout: CATCH_POLL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
