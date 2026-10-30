import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/taut-line";
const EXPECTED_START_LIVES = 3;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("taut-line-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンドの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("taut-line-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

async function readProgressPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("taut-line-progress").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * ステージを holdMs だけ長押ししてから離す。1匹目(ラウンド1)は魚が走らないため、
 * 長押しし続けるだけで確実に巻き寄せ量(進捗)が増えていく。
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

test.describe("Taut Line のストーリー", () => {
  test("起動直後は1ラウンド目・満タンのライフ・巻き具合0%でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("taut-line-round")).toBeVisible();
    await expect(page.getByTestId("taut-line-lives")).toBeVisible();
    await expect(page.getByTestId("taut-line-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);
    expect(await readProgressPercent(page), "開始時の巻き具合は0%").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("長押しでリールを巻き続けると巻き具合が増え、1匹釣れて得点とラウンドが進む", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 短く押すだけでも巻き具合(進捗)が増えることを確認する
    const progressBefore = await readProgressPercent(page);
    await pressAndHold(page, stage, 400);
    expect(await readProgressPercent(page), "長押しで巻き具合が増える").toBeGreaterThan(
      progressBefore,
    );

    // 1匹目(ラウンド1)は魚が走らないので、押し続ければ必ず釣れてラウンドが進む。
    // expect.poll の既定のリトライ間隔(指数バックオフで最大1秒)を使うと、
    // 毎回のチェックの間に「離している隙間」が生まれてしまい、その間も
    // アイドルドリフトで魚が遠ざかるため進捗が頭打ちになる。
    // そのため隙間を作らない手動ループで、押しては即チェックを繰り返す。
    const deadline = Date.now() + 30_000;
    let round = await readRound(page);
    while (round === 1 && Date.now() < deadline) {
      await pressAndHold(page, stage, 500);
      round = await readRound(page);
    }
    expect(round, "巻き続ければ1匹目が釣れてラウンドが進む").toBeGreaterThan(1);

    expect(await readScore(page), "釣れると得点が増える").toBeGreaterThan(0);
    expect(await readLives(page), "1匹目はラインを切らずに釣れる").toBe(EXPECTED_START_LIVES);
    expect(errors, "巻いている間にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は巻いても状態が変わらず、連打しても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScreenshot = await stage.screenshot();
    await waitForFrames(page, 45);
    const stillPausedScreenshot = await stage.screenshot();
    expect(pausedScreenshot.equals(stillPausedScreenshot), "一時停止中は完全に止まる").toBe(true);

    const progressWhilePaused = await readProgressPercent(page);
    await pressAndHold(page, stage, 400);
    expect(await readProgressPercent(page), "一時停止中に巻いても進捗が変わらない").toBe(
      progressWhilePaused,
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

  test("何もせず放置すると魚に逃げられ続け、ライフが尽きるとゲームオーバーになる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("taut-line-gameover");

    // 一切リールを巻かなければ、1匹目から必ず逃げられてライフが尽きる
    await expect
      .poll(() => gameOver.isVisible(), {
        message: "放置し続けるとライフが尽きてゲームオーバーになる",
        timeout: 60_000,
        intervals: [500],
      })
      .toBe(true);

    expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("taut-line-restart").click();
    await expect(gameOver).toBeHidden();
    await expect.poll(() => readScore(page), { message: "リスタートでスコアが0に戻る" }).toBe(0);
    await expect.poll(() => readRound(page), { message: "リスタートでラウンドが1に戻る" }).toBe(1);
    await expect
      .poll(() => readLives(page), { message: "リスタートでライフが満タンに戻る" })
      .toBe(EXPECTED_START_LIVES);

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
    await expect(page.getByTestId("taut-line-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も長押し操作を受け付ける
    await pressAndHold(page, stage, 400);
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    // ドラッグ(スワイプ相当)でも壊れない
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.45 });
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "ドラッグ後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
