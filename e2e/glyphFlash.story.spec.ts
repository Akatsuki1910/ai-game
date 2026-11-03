import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/glyph-flash";
const START_LIVES = 3;

interface Point {
  x: number;
  y: number;
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * data-testid="glyph-flash-debug" は画面には見えない要素で、現在のフェーズ・ラウンド・ライフと、
 * ランダム生成されるお題の軌跡(お題を覚える前から座標として公開)をdata属性として持つ。
 * 「正しくなぞれば合格する」を人間の記憶なしに検証するための唯一の手段であり、
 * 実際のなぞり操作そのものは必ず本物のcanvas上のマウス操作で行う（内部関数を直接呼ばない）。
 */
function debugNode(page: Page) {
  return page.getByTestId("glyph-flash-debug");
}

async function readPhase(page: Page): Promise<string> {
  return (await debugNode(page).getAttribute("data-phase")) ?? "";
}

async function readRound(page: Page): Promise<number> {
  return Number((await debugNode(page).getAttribute("data-round")) ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  return Number((await debugNode(page).getAttribute("data-lives")) ?? Number.NaN);
}

async function readTargetPath(page: Page): Promise<Point[]> {
  const raw = await debugNode(page).getAttribute("data-target-path");
  if (!raw) return [];
  return JSON.parse(raw) as Point[];
}

async function waitForPhase(page: Page, phase: string, message: string): Promise<void> {
  await expect.poll(() => readPhase(page), { message, timeout: 8000 }).toBe(phase);
}

/** お題の軌跡を本物のマウス操作でそっくりそのままなぞり、合格させる。 */
async function traceTargetExactly(page: Page): Promise<void> {
  await waitForPhase(page, "trace", "traceフェーズに入る");
  const target = await readTargetPath(page);
  expect(target.length, "お題の軌跡が読み取れる").toBeGreaterThanOrEqual(2);

  const box = await page.getByTestId("game-shell-stage").boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;

  const toScreen = (p: Point) => ({ x: box.x + p.x, y: box.y + p.y });

  const first = toScreen(target[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < target.length; i++) {
    const p = toScreen(target[i]);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await page.mouse.up();
}

/** お題とは無関係な短い線を引いて、確実に不合格にする。 */
async function traceWrongShape(page: Page): Promise<void> {
  await waitForPhase(page, "trace", "traceフェーズに入る");
  const stage = page.getByTestId("game-shell-stage");
  await dragOnStage(page, stage, { xRatio: 0.05, yRatio: 0.08 }, { xRatio: 0.07, yRatio: 0.08 });
}

test.describe("Glyph Flash のストーリー", () => {
  test("起動直後はラウンド1・ライフ満タン・スコア0で始まり、まもなくtraceフェーズに入る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(START_LIVES);

    await waitForPhase(page, "trace", "しばらく待つとpreviewが終わりtraceフェーズに入る");

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("お題と同じ軌跡を実際になぞると合格し、スコアが入ってラウンドが進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await traceTargetExactly(page);

    await expect.poll(() => readRound(page), { message: "合格するとラウンドが進む" }).toBe(2);
    expect(await readScore(page), "得点が入っている").toBeGreaterThan(0);
    expect(await readLives(page), "合格すれば残機は減らない").toBe(START_LIVES);

    expect(errors, "なぞる操作中にエラーが出ていない").toEqual([]);
  });

  test("的外れになぞると不合格になり残機が減るが、そのまま続けられる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readLives(page)).toBe(START_LIVES);
    await traceWrongShape(page);

    await expect
      .poll(() => readLives(page), { message: "的外れな線は不合格になり残機が減る" })
      .toBe(START_LIVES - 1);
    await expect(
      page.getByTestId("glyph-flash-gameover"),
      "1回の不合格ではゲームオーバーにならない",
    ).toBeHidden();

    // 結果表示フェーズを抜けると、同じラウンド番号のまま新しいお題でやり直せる
    await waitForPhase(page, "preview", "不合格後に次のお題のpreviewへ戻る");
    expect(await readRound(page), "不合格ならラウンドは進まない").toBe(1);

    await traceTargetExactly(page);
    await expect.poll(() => readRound(page), { message: "不合格後も合格を続けられる" }).toBe(2);

    expect(errors, "不合格の操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はなぞっても進捗が変わらず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // previewフェーズ(お題を覚える時間)のうちに一時停止する
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const phaseWhilePaused = await readPhase(page);
    const livesWhilePaused = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readPhase(page), "一時停止中はフェーズが進まない").toBe(phaseWhilePaused);
    expect(await readLives(page), "一時停止中はライフが変わらない").toBe(livesWhilePaused);

    // 一時停止中にドラッグしても壊れない・進捗が変わらない
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.35 });
    expect(await readPhase(page), "一時停止中の操作でフェーズが進まない").toBe(phaseWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await waitForPhase(page, "trace", "再開すればまたtraceフェーズに進む");

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

  test("残機が尽きるとゲームオーバーになり、リスタートで最初からやり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const gameOver = page.getByTestId("glyph-flash-gameover");

    for (let i = 0; i < START_LIVES; i++) {
      await traceWrongShape(page);
      await expect
        .poll(() => readLives(page), { message: `${i + 1}回目の不合格でライフが減る` })
        .toBe(START_LIVES - 1 - i);
      if (i < START_LIVES - 1) {
        await waitForPhase(page, "preview", "まだライフが残っていれば次のお題に戻る");
      }
    }

    await expect(gameOver, "ライフが尽きてゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("glyph-flash-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(START_LIVES);
    expect(await readRound(page), "リスタートでラウンドが1に戻る").toBe(1);

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

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も実際になぞって合格できる
    await traceTargetExactly(page);
    await expect.poll(() => readRound(page), { message: "リサイズ後も合格できる" }).toBe(2);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
