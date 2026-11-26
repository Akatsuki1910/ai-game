import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/bottle-flip";

// 事前に物理計算で求めた「ちょうどn回転で着地する」パワー(0〜1)。
const PERFECT_POWER_ONE_FLIP = 0.2075;
// どの回転数にも合わず確実に失敗するごく小さいパワー。
const FAIL_POWER = 0.02;

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getCanvasBox(page: Page): Promise<CanvasBox> {
  const canvasHost = page.getByTestId("bottle-flip-canvas");
  await expect(canvasHost.locator("canvas")).toBeVisible();
  const box = await canvasHost.boundingBox();
  expect(box, "キャンバス領域が取得できる").not.toBeNull();
  if (!box) throw new Error("canvas box not found");
  return box;
}

function maxDragDistanceFor(box: CanvasBox): number {
  return Math.max(80, Math.min(260, Math.min(box.width, box.height) * 0.4));
}

/** チャージ→離すまでを一息で行い、ボトルを投げ上げる。powerRatio(0〜1)が投げの強さ。 */
async function flip(page: Page, powerRatio: number): Promise<void> {
  const box = await getCanvasBox(page);
  const dragPixels = powerRatio * maxDragDistanceFor(box);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - dragPixels, { steps: 8 });
  await page.mouse.up();
}

/** チャージを始めて途中で止め、離す前のチャージ量を確認できる状態にする。呼び出し側で up() すること。 */
async function startCharging(page: Page, powerRatio: number): Promise<void> {
  const box = await getCanvasBox(page);
  const dragPixels = powerRatio * maxDragDistanceFor(box);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - dragPixels, { steps: 8 });
}

async function readChargeWidthRatio(page: Page): Promise<number> {
  const track = page.getByTestId("bottle-flip-charge");
  const box = await track.boundingBox();
  const fillBox = await track.locator("div").boundingBox();
  expect(box && fillBox, "チャージゲージのサイズが取得できる").not.toBeNull();
  if (!box || !fillBox) return 0;
  return fillBox.width / box.width;
}

async function readLivesCount(page: Page): Promise<number> {
  const text = await page.getByTestId("bottle-flip-lives").innerText();
  return (text.match(/♥/g) ?? []).length;
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  const matched = text.match(/([\d,]+)/);
  expect(matched, `スコア表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number((matched?.[1] ?? "0").replace(/,/g, ""));
}

test.describe("Bottle Flip のストーリー", () => {
  test("チャージして投げると結果が表示され、一時停止・再開もできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("bottle-flip-lives")).toHaveText("♥♥♥");
    await expect(page.getByTestId("bottle-flip-combo")).toHaveText("COMBO 0");

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 押し続けている間はチャージゲージが増えていく
    await startCharging(page, 0.6);
    await waitForFrames(page, 10);
    await expect
      .poll(() => readChargeWidthRatio(page), { message: "長押し中にチャージが増える" })
      .toBeGreaterThan(0.3);
    await page.mouse.up();

    await expect
      .poll(() => readChargeWidthRatio(page), { message: "離すとチャージゲージが戻る" })
      .toBeLessThan(0.05);

    // 結果バナーが出る(PERFECT/OK/FAILのいずれか)
    await expect(page.getByTestId("bottle-flip-result")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("bottle-flip-result")).toHaveText(/PERFECT!|OK|FAIL/);

    // 一時停止すると状態が固定される
    const livesBeforePause = await readLivesCount(page);
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    await flip(page, 0.9); // 一時停止中に投げても状態は変わらない
    await waitForFrames(page, 30);
    expect(await readLivesCount(page), "一時停止中はライフが変化しない").toBe(livesBeforePause);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("ちょうど1回転のタイミングで投げるとPERFECTになり、スコアとコンボが伸びる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const scoreBefore = await readScore(page);

    await flip(page, PERFECT_POWER_ONE_FLIP);

    await expect(page.getByTestId("bottle-flip-result")).toHaveText(/PERFECT!/, { timeout: 5000 });
    await expect(page.getByTestId("bottle-flip-combo")).toHaveText("COMBO 1");
    await expect(page.getByTestId("bottle-flip-lives")).toHaveText("♥♥♥");

    await expect
      .poll(() => readScore(page), { message: "PERFECTでスコアが増える" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "PERFECT判定の操作でエラーが出ていない").toEqual([]);
  });

  test("外した投げを繰り返すとライフが減り、尽きるとリスタートで遊び直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    for (let i = 0; i < 10; i++) {
      const isOver = await page.getByTestId("bottle-flip-gameover").isVisible();
      if (isOver) break;
      await flip(page, FAIL_POWER);
      await waitForFrames(page, 90); // 飛行アニメ+結果表示の分の実フレームを待つ
    }

    await expect(
      page.getByTestId("bottle-flip-gameover"),
      "ライフが尽きるとゲームオーバーになる",
    ).toBeVisible();
    await expect(page.getByTestId("bottle-flip-lives")).toHaveText("-");

    await page.getByTestId("bottle-flip-restart").click();
    await expect(page.getByTestId("bottle-flip-gameover")).toBeHidden();
    await expect(page.getByTestId("bottle-flip-lives")).toHaveText("♥♥♥");
    await expect(page.getByTestId("bottle-flip-combo")).toHaveText("COMBO 0");

    expect(errors, "連続失敗・リスタート操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても一時停止ボタンの表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける
    await flip(page, 0.5);
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "リサイズ後も操作できる").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
