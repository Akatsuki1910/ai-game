import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/coin-tide";

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("coin-tide-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readStock(page: Page): Promise<number> {
  const text = await page.getByTestId("coin-tide-stock").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ストック表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function tapStage(page: Page, xRatio: number, yRatio: number): Promise<void> {
  const box = await page.getByTestId("coin-tide-stage").boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

test.describe("Coin Tide のストーリー", () => {
  test("投入してストックが減り、時間経過で回復しつつラウンドが進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);
    const stockBefore = await readStock(page);
    expect(stockBefore, "開始時のストックがある").toBeGreaterThan(0);

    // コインを投入する（このゲームの中心操作）→ ストックが減る
    await tapStage(page, 0.5, 0.1);
    await expect
      .poll(() => readStock(page), { message: "投入するとストックが減る" })
      .toBeLessThan(stockBefore);

    // ストックは時間経過でまた満タンまで回復する
    await expect
      .poll(() => readStock(page), { timeout: 15_000, message: "時間経過でストックが回復する" })
      .toBe(stockBefore);

    // ラウンドが実際に進む
    expect(await readTimerSeconds(page), "残り時間が減っている").toBeLessThan(startedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("連打で投入してもストックより多く減らず、いずれ押し出されて得点が入る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    // 同じ位置へ連打投入（異常系: ストックの上限/下限が破れないか）
    for (let i = 0; i < 15; i++) {
      await tapStage(page, 0.5, 0.05);
    }
    const stock = await readStock(page);
    expect(stock, "ストックは負にならない").toBeGreaterThanOrEqual(0);

    // プッシャーと流れに乗って前縁まで届き、得点が入るのを待つ
    await expect
      .poll(() => readScore(page), { timeout: 30_000, message: "連打した分がいずれ得点になる" })
      .toBeGreaterThan(0);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("一時停止中は進行が止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedTimer = await readTimerSeconds(page);
    const pausedStock = await readStock(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedTimer);
    expect(await readStock(page), "一時停止中はストックも変わらない").toBe(pausedStock);

    // 一時停止ボタンを連打しても最終状態がずれない
    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedTimer);

    expect(errors, "一時停止の操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("coin-tide-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける
    const stockBefore = await readStock(page);
    await tapStage(page, 0.5, 0.1);
    await expect
      .poll(() => readStock(page), { message: "リサイズ後も投入できる" })
      .toBeLessThan(stockBefore);

    // ドラッグ操作（PCドラッグ/スマホスワイプ相当）でも壊れない
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.1 }, { xRatio: 0.7, yRatio: 0.2 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "ドラッグ後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
