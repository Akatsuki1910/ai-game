import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/constellation-echo";
// engine/world.ts の START_LIVES / STAR_COUNT / INITIAL_SEQUENCE_LENGTH と一致させる想定の初期値。
const START_LIVES = 3;
const STAR_COUNT = 8;
const INITIAL_SEQUENCE_LENGTH = 3;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("constellation-echo-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("constellation-echo-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/**
 * data-testid="constellation-echo-sequence" は画面には見えない要素で、現在のフェーズと
 * 手順(星idの並び)をdata属性として公開している。ランダム生成される手順を人間の記憶なしに
 * 検証するための唯一の手段であり、実際のクリック/タップ操作そのものは必ず本物のcanvas上の
 * 座標に対して行う（内部関数を直接呼ぶわけではない）。
 */
function debugNode(page: Page) {
  return page.getByTestId("constellation-echo-sequence");
}

async function readPhase(page: Page): Promise<string> {
  return (await debugNode(page).getAttribute("data-phase")) ?? "";
}

async function readSequence(page: Page): Promise<number[]> {
  const raw = await debugNode(page).getAttribute("data-sequence");
  if (!raw) return [];
  return raw
    .split(",")
    .filter((v) => v.length > 0)
    .map(Number);
}

async function waitForPhase(page: Page, phase: string, message: string): Promise<void> {
  await expect.poll(() => readPhase(page), { message }).toBe(phase);
}

/** 星のアンカー要素(見た目には出ないが座標だけを持つ)の中心を、本物のマウスクリックで狙う。 */
async function clickStar(page: Page, starId: number): Promise<void> {
  const anchor = page.getByTestId(`constellation-echo-star-${starId}`);
  const box = await anchor.boundingBox();
  expect(box, `星${starId}の座標が取得できる`).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** recallフェーズに入るのを待ち、現在の手順を正しい順にすべてクリックする。 */
async function solveCurrentSequence(page: Page): Promise<void> {
  await waitForPhase(page, "recall", "recallフェーズに入る");
  const sequence = await readSequence(page);
  expect(sequence.length, "手順が読み取れる").toBeGreaterThan(0);
  for (const starId of sequence) {
    await clickStar(page, starId);
    await waitForFrames(page, 4);
  }
}

test.describe("Constellation Echo のストーリー", () => {
  test("起動直後はラウンド1・ライフ満タン・スコア0で始まり、まもなくrecallフェーズに入る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(START_LIVES);

    await waitForPhase(page, "recall", "しばらく待つとpreviewが終わりrecallフェーズに入る");
    const sequence = await readSequence(page);
    expect(sequence.length, "初期手順の長さ").toBe(INITIAL_SEQUENCE_LENGTH);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("手順どおりにタップし続けるとスコアが伸び、ラウンドが進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await solveCurrentSequence(page);
    await expect.poll(() => readRound(page), { message: "1回クリアするとラウンドが進む" }).toBe(2);
    const scoreAfterFirst = await readScore(page);
    expect(scoreAfterFirst, "得点が入っている").toBeGreaterThan(0);

    await solveCurrentSequence(page);
    await expect.poll(() => readRound(page), { message: "2回目もクリアできる" }).toBe(3);
    expect(await readScore(page), "スコアがさらに伸びる").toBeGreaterThan(scoreAfterFirst);

    expect(errors, "クリアを繰り返す間にエラーが出ていない").toEqual([]);
  });

  test("違う星をタップするとミスになりライフが減るが、そのまま続けられる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await waitForPhase(page, "recall", "recallフェーズに入る");
    const sequence = await readSequence(page);
    const wrongId = (sequence[0] + 1) % STAR_COUNT;

    expect(await readLives(page)).toBe(START_LIVES);
    await clickStar(page, wrongId);

    await expect
      .poll(() => readLives(page), { message: "違う星をタップするとライフが減る" })
      .toBe(START_LIVES - 1);
    await expect(
      page.getByTestId("constellation-echo-gameover"),
      "1回のミスではゲームオーバーにならない",
    ).toBeHidden();

    // ミスの余韻フェーズを抜けると、同じラウンド番号のまま新しい星配置でやり直せる
    await waitForPhase(page, "preview", "ミス後にpreviewへ戻る");
    await solveCurrentSequence(page);
    await expect.poll(() => readRound(page), { message: "ミス後もクリアを続けられる" }).toBe(2);

    expect(errors, "ミス操作の間にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はタップしても進捗が変わらず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await waitForPhase(page, "recall", "recallフェーズに入る");
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const sequence = await readSequence(page);
    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);
    const progressWhilePaused = await debugNode(page).getAttribute("data-recall-progress");

    // 一時停止中は正解の星をタップしても進まない（オーバーレイが操作を吸収する）
    await clickStar(page, sequence[0]);
    await waitForFrames(page, 10);

    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中はライフが変わらない").toBe(livesWhilePaused);
    expect(
      await debugNode(page).getAttribute("data-recall-progress"),
      "一時停止中は手順の進捗も変わらない",
    ).toBe(progressWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await solveCurrentSequence(page);
    await expect.poll(() => readRound(page), { message: "再開すればまた進行できる" }).toBe(2);

    expect(errors, "一時停止の操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
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

    const phaseWhilePaused = await readPhase(page);
    await waitForFrames(page, 60);
    expect(await readPhase(page), "連打後の一時停止でもフェーズが進まない").toBe(phaseWhilePaused);

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、リスタートで最初からやり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const gameOver = page.getByTestId("constellation-echo-gameover");

    for (let i = 0; i < START_LIVES; i++) {
      await waitForPhase(page, "recall", `${i + 1}回目のrecallフェーズ`);
      const sequence = await readSequence(page);
      const wrongId = (sequence[0] + 1) % STAR_COUNT;
      await clickStar(page, wrongId);
      await waitForFrames(page, 4);
    }

    await expect(gameOver, "ライフが尽きてゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("constellation-echo-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(START_LIVES);
    expect(await readRound(page), "リスタートでラウンドが1に戻る").toBe(1);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("constellation-echo-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後は星のアンカー座標も追従しているはずで、実際にタップしてクリアできる
    await solveCurrentSequence(page);
    await expect.poll(() => readRound(page), { message: "リサイズ後もクリアできる" }).toBe(2);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
