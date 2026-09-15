import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/dohyo-duel";
const EXPECTED_START_LIVES = 3;
// engine/world.ts の MAX_CHARGE_SECONDS(0.9秒)を確実に超える長押し時間。
// これだけ長押しすれば必ず最大威力の押し込みになる。
const FULL_CHARGE_HOLD_MS = 950;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("dohyo-duel-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンドの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("dohyo-duel-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

/**
 * ステージを holdMs だけ長押ししてから離す。
 * 長押し時間そのものがため(チャージ)の量を決めるゲームの判定材料なので、
 * この待機は「状態が変わるまでの同期待ち」ではなく操作そのものの一部として使っている。
 */
async function pressAndHold(page: Page, stage: Locator, holdMs: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await waitForFrames(page, 4);
}

test.describe("Dohyo Duel のストーリー", () => {
  test("起動直後はラウンド1・満タンのライフでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("dohyo-duel-round")).toBeVisible();
    await expect(page.getByTestId("dohyo-duel-streak")).toBeVisible();
    await expect(page.getByTestId("dohyo-duel-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("満タンまでためて離し続けると相手を押し切り、得点とラウンドが進む", async ({ page }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const roundBefore = await readRound(page);

    await expect
      .poll(
        async () => {
          await pressAndHold(page, stage, FULL_CHARGE_HOLD_MS);
          return readRound(page);
        },
        {
          message: "最大威力でためて押し続ければ、いずれ相手を押し出してラウンドが進む",
          timeout: 90_000,
        },
      )
      .toBeGreaterThan(roundBefore);

    expect(await readScore(page), "勝つと得点も増える").toBeGreaterThan(0);
    expect(errors, "押し込み中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は押し込んでも状態が変わらず、連打しても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScreenshot = await stage.screenshot();
    await waitForFrames(page, 45);
    const stillPausedScreenshot = await stage.screenshot();
    expect(
      pausedScreenshot.equals(stillPausedScreenshot),
      "一時停止中は相手の気合いゲージも含めて完全に止まる",
    ).toBe(true);

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);
    await pressAndHold(page, stage, FULL_CHARGE_HOLD_MS);
    expect(await readScore(page), "一時停止中に押し込んでも得点が変わらない").toBe(
      scoreWhilePaused,
    );
    expect(await readLives(page), "一時停止中は相手に押されてもライフが変わらない").toBe(
      livesWhilePaused,
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

  test("何もしないでいると相手に押し切られ続け、ライフが尽きるとゲームオーバーになる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("dohyo-duel-gameover");

    // 一切押し返さなければ、相手の突きだけで必ず土俵の外まで押し切られる。
    await expect
      .poll(() => gameOver.isVisible(), {
        message: "無操作を続けるとライフが尽きてゲームオーバーになる",
        timeout: 120_000,
        intervals: [500],
      })
      .toBe(true);

    expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("dohyo-duel-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readRound(page), "リスタートでラウンドが1に戻る").toBe(1);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("素早く連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    for (let i = 0; i < 15; i++) {
      await page.mouse.click(x, y);
    }
    await waitForFrames(page, 10);

    expect(await readLives(page), "連打してもライフは0未満にならない").toBeGreaterThanOrEqual(0);
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("dohyo-duel-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける(ドラッグしてもクラッシュしない)
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.6 }, { xRatio: 0.6, yRatio: 0.5 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
