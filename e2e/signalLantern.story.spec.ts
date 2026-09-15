import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/signal-lantern";
// engine/world.ts の START_LIVES / DOT_HOLD_THRESHOLD_MS と一致させる想定の値。
const EXPECTED_START_LIVES = 3;
// しきい値(DOT_HOLD_THRESHOLD_MS=420ms)との間に、ブラウザ操作の伝達遅延で
// 誤判定されない程度の余裕を持たせた値にしている(実測で±150〜200ms程度の
// 遅延が乗ることがあるため、しきい値から十分離す)。
const DOT_HOLD_MS = 0;
const DASH_HOLD_MS = 700;
// 信号の点滅(最長0.55秒)+ 応答フェーズの制限時間(レベル1は2.6秒)を確実に超える待機時間。
// これより長く待てば、何も操作しなくても必ずタイムアウトミスに1回到達する。
const TIMEOUT_WAIT_MS = 4000;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("signal-lantern-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLevel(page: Page): Promise<number> {
  const text = await page.getByTestId("signal-lantern-level").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `レベルの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 現在の信号が「点」か「線」かをヒント表示から読み取る。 */
async function readCurrentSymbol(page: Page): Promise<"dot" | "dash"> {
  const text = await page.getByTestId("signal-lantern-symbol-hint").innerText();
  return text.includes("・短く") ? "dot" : "dash";
}

/** 点滅(showing)が終わって応答受付(input)フェーズに入るまで待つ。 */
async function waitForInputPhase(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const text = await page.getByTestId("signal-lantern-symbol-hint").innerText();
      return text.startsWith("応答受付中");
    })
    .toBe(true);
}

/**
 * ステージを holdMs だけ長押ししてから離す。
 * 長押し時間そのものがゲームの判定材料(点/線の分類)なので、この待機は
 * 「状態が変わるまでの同期待ち」ではなく操作そのものの一部として使っている。
 */
async function pressAndHold(
  page: Page,
  stage: ReturnType<Page["getByTestId"]>,
  holdMs: number,
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await waitForFrames(page, 4);
}

/** 応答受付フェーズを待ってから、現在表示されている信号に合わせて正しい長さで応答する。 */
async function respondCorrectly(page: Page, stage: ReturnType<Page["getByTestId"]>): Promise<void> {
  await waitForInputPhase(page);
  const symbol = await readCurrentSymbol(page);
  await pressAndHold(page, stage, symbol === "dot" ? DOT_HOLD_MS : DASH_HOLD_MS);
}

/** 応答受付フェーズを待ってから、現在表示されている信号とは逆の長さでわざと応答する(ミスを起こす)。 */
async function respondIncorrectly(
  page: Page,
  stage: ReturnType<Page["getByTestId"]>,
): Promise<void> {
  await waitForInputPhase(page);
  const symbol = await readCurrentSymbol(page);
  await pressAndHold(page, stage, symbol === "dot" ? DASH_HOLD_MS : DOT_HOLD_MS);
}

test.describe("Signal Lantern のストーリー", () => {
  test("起動直後はレベル1・満タンのライフでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("signal-lantern-level")).toBeVisible();
    await expect(page.getByTestId("signal-lantern-lives")).toBeVisible();
    await expect(page.getByTestId("signal-lantern-symbol-hint")).toBeVisible();
    await expect(page.getByTestId("signal-lantern-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLevel(page), "開始時はレベル1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("正しい長さで応答し続けると得点が積み上がり、いずれレベルが上がる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const levelBefore = await readLevel(page);

    // レベル1のクリアに必要な回数(最大8回)を十分にまかなえる回数だけ正しく応答する。
    for (let i = 0; i < 8; i++) {
      await respondCorrectly(page, stage);
    }

    expect(await readScore(page), "正解を積み重ねると得点が増える").toBeGreaterThan(scoreBefore);
    expect(await readLevel(page), "8回正解すれば少なくともレベルが上がっている").toBeGreaterThan(
      levelBefore,
    );
    expect(await readLives(page), "正解し続けている間はライフが減らない").toBe(
      EXPECTED_START_LIVES,
    );

    expect(errors, "連続応答中にエラーが出ていない").toEqual([]);
  });

  test("わざと違う長さで応答するとミスになりライフが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const livesBefore = await readLives(page);
    await respondIncorrectly(page, stage);

    expect(await readLives(page), "わざと外すとライフが減る").toBe(livesBefore - 1);

    expect(errors, "ミス操作でエラーが出ていない").toEqual([]);
  });

  test("応答時間内に離さないとタイムアウトでミスになる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const livesBefore = await readLives(page);
    // レバーに触れずに待つだけで、応答フェーズのタイムリミットを超えさせる。
    await page.waitForTimeout(TIMEOUT_WAIT_MS);
    await waitForFrames(page, 4);

    expect(await readLives(page), "何も操作しないとタイムアウトでライフが減る").toBe(
      livesBefore - 1,
    );

    expect(errors, "タイムアウト待機中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は応答してもライフや得点が変化せず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);

    await pressAndHold(page, stage, DOT_HOLD_MS);
    await pressAndHold(page, stage, DASH_HOLD_MS);

    expect(await readScore(page), "一時停止中は応答しても得点が変わらない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中は応答してもライフが変わらない").toBe(
      livesWhilePaused,
    );

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const scoreAfterResume = await readScore(page);
    const livesAfterResume = await readLives(page);
    await respondCorrectly(page, stage);
    const scoreAfterRespond = await readScore(page);
    const livesAfterRespond = await readLives(page);
    expect(
      scoreAfterRespond > scoreAfterResume || livesAfterRespond < livesAfterResume,
      "再開後は応答で得点かライフに変化が起きる",
    ).toBe(true);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、もう一度あそぶで最初から遊べる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("signal-lantern-gameover");

    for (let i = 0; i < EXPECTED_START_LIVES && !(await gameOver.isVisible()); i++) {
      await respondIncorrectly(page, stage);
    }

    await expect(gameOver, "ライフ分だけわざと外すとゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("signal-lantern-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);
    expect(await readLevel(page), "リスタートでレベルが1に戻る").toBe(1);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても状態が壊れない", async ({ page }) => {
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

    // 連打(≒ほぼ0msの長押し)は「点」応答として扱われ続けるだけで、例外にはならない。
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
    await expect(page.getByTestId("signal-lantern-level")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const scoreBefore = await readScore(page);
    const livesBefore = await readLives(page);
    await respondCorrectly(page, stage);
    const scoreAfter = await readScore(page);
    const livesAfter = await readLives(page);
    expect(
      scoreAfter > scoreBefore || livesAfter < livesBefore,
      "リサイズ後も応答の効果が出る",
    ).toBe(true);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
