import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/mochi-pound";
// engine/world.ts の START_LIVES と一致させる想定の初期ライフ数。
const EXPECTED_START_LIVES = 3;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("mochi-pound-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("mochi-pound-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `臼の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 現在の杵の振れ位置へタップを1回行い、少し待って表示の更新を反映させる。 */
async function tapStageOnce(page: Page, stage: ReturnType<Page["getByTestId"]>): Promise<void> {
  await stage.click();
  await waitForFrames(page, 4);
}

test.describe("Mochi Pound のストーリー", () => {
  test("起動直後は臼1・満タンのライフでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("mochi-pound-round")).toBeVisible();
    await expect(page.getByTestId("mochi-pound-lives")).toBeVisible();
    await expect(page.getByTestId("mochi-pound-stretch")).toBeVisible();
    await expect(page.getByTestId("mochi-pound-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時は臼1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    const stretchText = await page.getByTestId("mochi-pound-stretch").innerText();
    expect(stretchText, "もちもち度0%から始まる").toContain("0%");

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("タップすると得点(PERFECT/GOOD)かライフ減少(MISS/手)のどちらかが必ず起こり、連打しても状態が壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("mochi-pound-gameover");

    let previousScore = await readScore(page);
    let previousLives = await readLives(page);

    for (let i = 0; i < 15; i++) {
      const wasOver = await gameOver.isVisible();
      await tapStageOnce(page, stage);

      const score = await readScore(page);
      const lives = await readLives(page);

      if (wasOver) {
        expect(score, `${i}回目: ゲームオーバー後はスコアが変わらない`).toBe(previousScore);
        expect(lives, `${i}回目: ゲームオーバー後はライフが変わらない`).toBe(previousLives);
      } else {
        const isHit = score > previousScore;
        const isMiss = lives < previousLives;
        expect(isHit || isMiss, `${i}回目: 得点増加かライフ減少のどちらかが起きる`).toBe(true);
        expect(isHit && isMiss, `${i}回目: 得点増加とライフ減少が同時には起きない`).toBe(false);
        expect(lives, `${i}回目: ライフは0未満にならない`).toBeGreaterThanOrEqual(0);
      }

      previousScore = score;
      previousLives = lives;
    }

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はタップしても得点もライフ減少も発生せず、再開すると効果が戻る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);

    for (let i = 0; i < 5; i++) await tapStageOnce(page, stage);

    expect(await readScore(page), "一時停止中はタップしても得点が変わらない").toBe(
      scoreWhilePaused,
    );
    expect(await readLives(page), "一時停止中はタップしてもライフが変わらない").toBe(
      livesWhilePaused,
    );

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const scoreAfterResume = await readScore(page);
    const livesAfterResume = await readLives(page);
    await tapStageOnce(page, stage);
    const scoreAfterTap = await readScore(page);
    const livesAfterTap = await readLives(page);
    expect(
      scoreAfterTap > scoreAfterResume || livesAfterTap < livesAfterResume,
      "再開後はタップで得点かライフに変化が起きる",
    ).toBe(true);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、もう一度あそぶで最初から遊べる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("mochi-pound-gameover");

    // タイミング窓は振れ幅の一部でしかなく、タップを繰り返せば十分な回数内で
    // 必ず既定のライフ(3)を使い切ってゲームオーバーに到達する。
    const MAX_ATTEMPTS = 100;
    for (let i = 0; i < MAX_ATTEMPTS && !(await gameOver.isVisible()); i++) {
      await tapStageOnce(page, stage);
    }

    await expect(gameOver, `${MAX_ATTEMPTS}回のタップ以内にゲームオーバーへ到達する`).toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("mochi-pound-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);
    expect(await readRound(page), "リスタートで臼が1に戻る").toBe(1);

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
    await expect(page.getByTestId("mochi-pound-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const scoreBefore = await readScore(page);
    const livesBefore = await readLives(page);
    await tapStageOnce(page, stage);
    const scoreAfter = await readScore(page);
    const livesAfter = await readLives(page);
    expect(
      scoreAfter > scoreBefore || livesAfter < livesBefore,
      "リサイズ後もタップの効果が出る",
    ).toBe(true);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
