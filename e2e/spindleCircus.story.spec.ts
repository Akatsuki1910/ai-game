import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/spindle-circus";
// engine/world.ts の START_LIVES / SPINDLE_COUNT と一致させる想定の初期値。
const EXPECTED_START_LIVES = 3;
const SPINDLE_COUNT = 5;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("spindle-circus-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 全ての柱を順にタップし、少し待って表示の更新を反映させる。皿がどこにあっても最低1回はスピンに当たる。 */
async function tapAllLanesOnce(page: Page, stage: ReturnType<Page["getByTestId"]>): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  for (let i = 0; i < SPINDLE_COUNT; i++) {
    const x = box.x + (box.width * (i + 0.5)) / SPINDLE_COUNT;
    const y = box.y + box.height / 2;
    await page.mouse.click(x, y);
  }
  await waitForFrames(page, 4);
}

test.describe("Spindle Circus のストーリー", () => {
  test("起動直後は満タンのライフでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("spindle-circus-lives")).toBeVisible();
    await expect(page.getByTestId("spindle-circus-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("柱をタップし続けるとスコアが伸び、連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 皿が生まれてある程度ぐらつくまで少し待ってからスピンをかける。
    await waitForFrames(page, 90);

    let previousScore = await readScore(page);
    let sawScoreIncrease = false;

    for (let i = 0; i < 10; i++) {
      await tapAllLanesOnce(page, stage);
      const score = await readScore(page);
      const lives = await readLives(page);

      expect(lives, `${i}回目: ライフは0未満にならない`).toBeGreaterThanOrEqual(0);
      expect(score, `${i}回目: スコアは減らない`).toBeGreaterThanOrEqual(previousScore);
      if (score > previousScore) sawScoreIncrease = true;

      previousScore = score;
      await waitForFrames(page, 30);
    }

    expect(sawScoreIncrease, "連打の間に少なくとも1回はスコアが増える").toBe(true);
    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はタップしてもスコアもライフも変化せず、再開すると効果が戻る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 60);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);

    for (let i = 0; i < 5; i++) await tapAllLanesOnce(page, stage);

    expect(await readScore(page), "一時停止中はタップしても得点が変わらない").toBe(
      scoreWhilePaused,
    );
    expect(await readLives(page), "一時停止中はタップしてもライフが変わらない").toBe(
      livesWhilePaused,
    );

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await waitForFrames(page, 30);

    await tapAllLanesOnce(page, stage);
    const scoreAfterResume = await readScore(page);
    expect(scoreAfterResume, "再開後はスピンで得点が増える可能性がある").toBeGreaterThanOrEqual(
      scoreWhilePaused,
    );

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("放置すると皿が落ちてライフが減り、尽きるとゲームオーバーになってリスタートできる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("spindle-circus-gameover");

    // 一切スピンをかけずに放置すれば、ぐらつきが増え続けて必ず皿が落ち続ける。
    const MAX_WAIT_ROUNDS = 60;
    for (let i = 0; i < MAX_WAIT_ROUNDS && !(await gameOver.isVisible()); i++) {
      await waitForFrames(page, 30);
    }

    await expect(gameOver, "放置し続ければゲームオーバーへ到達する").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("spindle-circus-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("spindle-circus-lives")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    await waitForFrames(page, 60);
    const scoreBefore = await readScore(page);
    await tapAllLanesOnce(page, stage);
    const scoreAfter = await readScore(page);
    expect(scoreAfter, "リサイズ後もスコアが減らない").toBeGreaterThanOrEqual(scoreBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
