import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/hane-rally";
const START_LIVES = 3;
// 風の揺らぎを考慮しても、パドルを落下位置に置き続ければ十分な余裕で初回ヒットに届く
// (エンジン単体シミュレーションで約1秒後に初回ヒットすることを確認済み)。
const HIT_POLL_TIMEOUT_MS = 15_000;
// パドルを羽根から遠ざけたままにすると、ライフ3個分のミスは十数秒以内に確実に起きる
// (エンジン単体シミュレーションで3ミスとも20秒以内に発生することを確認済み)。
const GAMEOVER_POLL_TIMEOUT_MS = 30_000;

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("hane-rally-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

async function readRally(page: Page): Promise<number> {
  const text = await page.getByTestId("hane-rally-rally").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラリー表示から数値を読み取れる: "${text}"`).not.toBeNull();
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

/** 羽根の落下位置(中央)にパドルを置き続ける。羽根は常に中央付近で湧くため、追わずに置いておくだけで打ち返せる。 */
async function parkPaddleUnderShuttle(page: Page, stage: Locator): Promise<void> {
  await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.6 });
}

/** パドルを隅に寄せて、羽根の落下経路から確実に外す。 */
async function movePaddleAwayFromShuttle(page: Page, stage: Locator): Promise<void> {
  await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.3 }, { xRatio: 0.92, yRatio: 0.3 });
}

test.describe("Hane Rally のストーリー", () => {
  test("起動直後はラリー0・ライフ満タンでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("hane-rally-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRally(page), "開始時のラリーは0").toBe(0);
    expect(await readLives(page), "開始時はライフが満タン").toBe(START_LIVES);

    await waitForCanvas(page);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("羽根の落下位置にパドルを置き続けると打ち返しが続き、ラリーとスコアが伸びる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await parkPaddleUnderShuttle(page, stage);

    await expect
      .poll(() => readRally(page), {
        message: "打ち返し続けるとラリーが伸びる",
        timeout: HIT_POLL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    const rallyAfterFirstHit = await readRally(page);
    await expect
      .poll(() => readRally(page), {
        message: "さらに打ち返しが続くとラリーがもっと伸びる",
        timeout: HIT_POLL_TIMEOUT_MS,
      })
      .toBeGreaterThan(rallyAfterFirstHit);

    expect(await readScore(page), "打ち返した分だけ累計スコアも伸びている").toBeGreaterThan(0);
    expect(await readLives(page), "打ち返し続けている間はライフが減らない").toBe(START_LIVES);

    expect(errors, "打ち返している間にエラーが出ていない").toEqual([]);
  });

  test("パドルを羽根から離しておくと落下してミスになり、ライフが減ってラリーが0に戻る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await parkPaddleUnderShuttle(page, stage);
    await expect
      .poll(() => readRally(page), { message: "まず1回打ち返す", timeout: HIT_POLL_TIMEOUT_MS })
      .toBeGreaterThan(0);

    await movePaddleAwayFromShuttle(page, stage);

    await expect
      .poll(() => readLives(page), {
        message: "離れたパドルでは羽根を追えずミスしてライフが減る",
        timeout: HIT_POLL_TIMEOUT_MS,
      })
      .toBeLessThan(START_LIVES);
    expect(await readRally(page), "ミスするとラリーは0に戻る").toBe(0);

    expect(errors, "ミスするまでの間にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は羽根が止まり、連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await parkPaddleUnderShuttle(page, stage);
    await expect
      .poll(() => readRally(page), { message: "まず1回打ち返す", timeout: HIT_POLL_TIMEOUT_MS })
      .toBeGreaterThan(0);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const rallyWhilePaused = await readRally(page);
    await waitForFrames(page, 60);
    expect(await readRally(page), "一時停止中はラリーが変わらない").toBe(rallyWhilePaused);

    // 一時停止中にパドルを動かしても進行しない
    await movePaddleAwayFromShuttle(page, stage);
    expect(await readRally(page), "一時停止中の操作でラリーが変わらない").toBe(rallyWhilePaused);

    // ここまでで一時停止ボタンは1回押した(＝一時停止中)状態。
    // 以降の連打テストは「再開中」を起点にしたいので、いったん再開しておく。
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

  test("ミスを重ねてライフが尽きるとゲームオーバーになり、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const gameOver = page.getByTestId("hane-rally-gameover");

    await movePaddleAwayFromShuttle(page, stage);

    await expect(gameOver, "ライフが尽きるとゲームオーバー表示になる").toBeVisible({
      timeout: GAMEOVER_POLL_TIMEOUT_MS,
    });
    expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);

    await page.getByTestId("hane-rally-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readRally(page), "リスタートでラリーが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(START_LIVES);

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

    // リサイズ後も羽根を打ち返せる
    await parkPaddleUnderShuttle(page, stage);
    await expect
      .poll(() => readRally(page), {
        message: "リサイズ後もラリーが伸びる",
        timeout: HIT_POLL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
