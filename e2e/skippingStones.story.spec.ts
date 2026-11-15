import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/skipping-stones";
const EXPECTED_START_STONES = 8;
// 1投げの飛行(複数回の着水)は実時間で1秒前後だが、低スペック環境での
// フレーム供給遅延を見込んで余裕を持ったタイムアウトにする(AGENTS.mdの既知のハマりどころ参照)。
const THROW_POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readStonesRemaining(page: Page): Promise<number> {
  const text = await page.getByTestId("skipping-stones-stones").innerText();
  const match = text.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : Number.NaN;
}

async function readStatus(page: Page): Promise<string> {
  return page.getByTestId("skipping-stones-status").innerText();
}

async function waitForCanvas(page: Page): Promise<Locator> {
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();
  return stage;
}

/**
 * `expect.poll()` はこのゲームの requestAnimationFrame ループと組み合わせると、
 * 繰り返しの CDP 呼び出しが原因と見られる形でフレーム進行が止まってしまうことが
 * 他のゲーム(homing-arc)で確認されている。そのため、条件が満たされるまでの
 * 待ち合わせは `page.waitForTimeout` を挟む手動ポーリングで行う。固定時間の
 * sleep ではなく「観測する条件＋有限のタイムアウト」で待つ点は変わらない。
 */
async function waitUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  page: Page,
  message: string,
  timeoutMs = THROW_POLL_TIMEOUT_MS,
): Promise<T> {
  const start = Date.now();
  let value = await read();
  while (!predicate(value) && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    value = await read();
  }
  expect(predicate(value), message).toBe(true);
  return value;
}

/** ドラッグせずクリックだけで投げる(既定の狙いのまま投げる)。InputManager は移動なしの
 * クリックを「pointerdown→pointerup」として扱うため、aimPower/aimLateral は既定値のまま
 * releaseThrow() が呼ばれる。既定値でも十分に跳ねる設計(engine/world.test.ts 参照)。 */
async function throwStone(page: Page, stage: Locator): Promise<void> {
  await stage.click();
  await waitUntil(
    () => readStatus(page),
    (s) => s === "飛行中",
    page,
    "投げると飛行中になる",
  );
}

async function throwAndWaitForLanding(page: Page, stage: Locator): Promise<void> {
  await throwStone(page, stage);
  await waitUntil(
    () => readStatus(page),
    (s) => s === "ねらう",
    page,
    "投げるとやがて着水して狙う状態に戻る",
  );
}

test.describe("Skipping Stones のストーリー", () => {
  test("起動直後はねらう状態・満タンの石・スコア0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("skipping-stones-stones")).toBeVisible();
    await expect(page.getByTestId("skipping-stones-status")).toBeVisible();
    await expect(page.getByTestId("skipping-stones-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readStatus(page), "開始時はねらう状態").toBe("ねらう");
    expect(await readStonesRemaining(page), "開始時は石が満タン").toBe(EXPECTED_START_STONES);

    await waitForCanvas(page);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("投げると水面で跳ねてスコアが増え、やがて自然に着水して石が1つ減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await throwAndWaitForLanding(page, stage);

    await waitUntil(
      () => readScore(page),
      (s) => s > 0,
      page,
      "跳ねると得点する",
    );
    expect(await readStonesRemaining(page), "投げると石が1つ減る").toBe(EXPECTED_START_STONES - 1);

    expect(errors, "投げて着水するまでの操作中にエラーが出ていない").toEqual([]);
  });

  test("飛行中にドラッグすると左右に操作できる。連打してもエラーにならない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await throwStone(page, stage);

    // 飛行中にドラッグ(左右操作)してもゲームが壊れない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.85, yRatio: 0.5 });
    await waitForFrames(page, 10);
    await dragOnStage(page, stage, { xRatio: 0.85, yRatio: 0.5 }, { xRatio: 0.15, yRatio: 0.5 });

    // 着水直前を狙わない連打(フリック)をしてもエラーにならず、やがて着水してねらう状態に戻る
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      for (let i = 0; i < 5; i++) {
        await page.mouse.click(x, y);
      }
    }

    await waitUntil(
      () => readStatus(page),
      (s) => s === "ねらう",
      page,
      "やがて着水してねらう状態に戻る",
    );
    await waitUntil(
      () => readScore(page),
      (s) => s > 0,
      page,
      "跳ねた分の得点が入っている",
    );

    expect(errors, "飛行中の操作・連打中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は飛行が止まり、連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await throwStone(page, stage);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const statusWhilePaused = await readStatus(page);
    const scoreWhilePaused = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readStatus(page), "一時停止中は飛行状態が変わらない").toBe(statusWhilePaused);
    expect(await readScore(page), "一時停止中は得点が変わらない").toBe(scoreWhilePaused);

    // 一時停止中にクリックしても進行しない
    await stage.click();
    expect(await readStatus(page), "一時停止中の操作で状態が変わらない").toBe(statusWhilePaused);

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

  test("石を使い切るとゲームオーバーになり、リスタートで最初から遊べる", async ({ page }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const gameOver = page.getByTestId("skipping-stones-gameover");

    for (let i = 0; i < EXPECTED_START_STONES; i++) {
      await throwAndWaitForLanding(page, stage);
    }

    await expect(gameOver, "石が尽きるとゲームオーバー表示になる").toBeVisible();
    expect(await readStonesRemaining(page), "ゲームオーバー時は石が0").toBe(0);

    await page.getByTestId("skipping-stones-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readStonesRemaining(page), "リスタートで石が満タンに戻る").toBe(
      EXPECTED_START_STONES,
    );
    expect(await readStatus(page), "リスタートでねらう状態に戻る").toBe("ねらう");

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

    // リサイズ後も投げて着水できる
    await throwAndWaitForLanding(page, stage);
    await waitUntil(
      () => readScore(page),
      (s) => s > 0,
      page,
      "リサイズ後も得点できる",
    );

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
