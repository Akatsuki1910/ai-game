import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/shredder-line";
const STARTING_LIVES = 3;
const SCRAP_COLORS = ["copper", "steel", "glass"] as const;

// ShredderLineGame.tsx のシュート配置と同じ比率(コンポーネント側の定数と対応)。
const CHUTE_X_RATIOS = [0.25, 0.5, 0.75] as const;
const CHUTE_Y_RATIO = 0.82;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("shredder-line-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const value = await page.getByTestId("shredder-line-lives").getAttribute("data-lives");
  expect(value, "ライフが属性から読み取れる").not.toBeNull();
  return Number(value);
}

interface UrgentPiece {
  x: number;
  y: number;
  color: string;
}

/** 現在最も危険(シュレッダーに近い)なスクラップの位置と色を読む。無ければnull。 */
async function readUrgentPiece(page: Page): Promise<UrgentPiece | null> {
  const marker = page.getByTestId("shredder-line-piece-marker");
  const isVisible = await marker.isVisible().catch(() => false);
  if (!isVisible) return null;
  const box = await marker.boundingBox();
  const color = await marker.getAttribute("data-color");
  if (!box || !color) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, color };
}

async function waitForUrgentPiece(page: Page): Promise<UrgentPiece> {
  let found: UrgentPiece | null = null;
  await expect
    .poll(
      async () => {
        found = await readUrgentPiece(page);
        return found !== null;
      },
      { message: "スクラップがベルトに現れる", timeout: 8000 },
    )
    .toBe(true);
  expect(found, "現れたスクラップの位置が読み取れる").not.toBeNull();
  // biome-ignore lint/style/noNonNullAssertion: 直前のexpectで非nullを確認済み
  return found!;
}

function chuteIndexForColor(color: string): number {
  const index = SCRAP_COLORS.indexOf(color as (typeof SCRAP_COLORS)[number]);
  if (index === -1) throw new Error(`未知の色: ${color}`);
  return index;
}

async function chuteCenter(stage: Locator, chuteIndex: number): Promise<{ x: number; y: number }> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return {
    x: box.x + box.width * CHUTE_X_RATIOS[chuteIndex],
    y: box.y + box.height * CHUTE_Y_RATIO,
  };
}

async function dragPieceToChute(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test.describe("Shredder Line のストーリー", () => {
  test("正しいシュートに投入するとスコアとコンボが増え、一時停止・再開もできる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(STARTING_LIVES);
    await expect(page.getByTestId("shredder-line-legend")).toBeVisible();

    const stage = page.getByTestId("game-shell-stage");
    const piece = await waitForUrgentPiece(page);
    const chuteIndex = chuteIndexForColor(piece.color);
    const chute = await chuteCenter(stage, chuteIndex);
    await dragPieceToChute(page, piece, chute);

    await expect
      .poll(() => readScore(page), { message: "正しく投入するとスコアが増える" })
      .toBeGreaterThan(0);
    expect(await readCombo(page), "正解でコンボが伸びる").toBeGreaterThan(0);
    expect(await readLives(page), "正解ではライフは減らない").toBe(STARTING_LIVES);

    // 一時停止するとオーバーレイが出て、状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedLives = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readLives(page), "一時停止中はライフが変化しない").toBe(pausedLives);

    // 一時停止中にドラッグしても無視される。
    const anyChute = await chuteCenter(stage, 0);
    await dragPieceToChute(page, { x: anyChute.x, y: anyChute.y - 80 }, anyChute);
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると進行を再開する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    const resumedPiece = await waitForUrgentPiece(page);
    const resumedChute = await chuteCenter(stage, chuteIndexForColor(resumedPiece.color));
    await dragPieceToChute(page, resumedPiece, resumedChute);
    await expect
      .poll(() => readScore(page), { message: "再開後も投入してスコアが増える" })
      .toBeGreaterThan(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("間違ったシュートや放置でライフが減り、尽きるとゲームオーバー。リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // 1回目: 間違った色のシュートへ投入してライフを減らす。
    const firstPiece = await waitForUrgentPiece(page);
    const wrongIndex = (chuteIndexForColor(firstPiece.color) + 1) % SCRAP_COLORS.length;
    const wrongChute = await chuteCenter(stage, wrongIndex);
    await dragPieceToChute(page, firstPiece, wrongChute);
    await expect
      .poll(() => readLives(page), { message: "誤投入でライフが減る" })
      .toBe(STARTING_LIVES - 1);
    expect(await readCombo(page), "誤投入でコンボがリセットされる").toBe(0);

    // 2回目: 何もせず放置してシュレッダーに届かせる。
    await expect
      .poll(() => readLives(page), {
        message: "放置(シュレッダー到達)でライフが減る",
        timeout: 25000,
      })
      .toBeLessThanOrEqual(STARTING_LIVES - 2);

    // ライフが残っていれば、さらに誤投入して0にする(上限回数を決め、無限ループにしない)。
    for (let guard = 0; guard < 10 && (await readLives(page)) > 0; guard++) {
      const piece = await waitForUrgentPiece(page);
      const chuteIndex = (chuteIndexForColor(piece.color) + 1) % SCRAP_COLORS.length;
      const chute = await chuteCenter(stage, chuteIndex);
      await dragPieceToChute(page, piece, chute);
      await waitForFrames(page, 5);
    }

    await expect(page.getByTestId("shredder-line-gameover")).toBeVisible();
    expect(await readLives(page), "ライフが0になっている").toBe(0);

    // ゲームオーバー中にドラッグしても、実際のユーザーと同様に入力が無視される。
    const scoreAtGameOver = await readScore(page);
    const chute0 = await chuteCenter(stage, 0);
    await dragPieceToChute(page, { x: chute0.x, y: chute0.y - 100 }, chute0);
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );
    expect(await readLives(page), "ゲームオーバー後の操作でライフが変化しない").toBe(0);

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("shredder-line-restart").click();
    await expect(page.getByTestId("shredder-line-gameover")).toBeHidden();
    expect(await readLives(page), "リスタートでライフが全回復する").toBe(STARTING_LIVES);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readCombo(page), "リスタートでコンボが0に戻る").toBe(0);

    expect(errors, "ライフ減少・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも投入でき、連打や画面リサイズをしても壊れない", async ({ page }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // キーボード操作: 1〜3キーで最も危険なスクラップを対応するシュートへ即投入する。
    const scoreBeforeKeyboard = await readScore(page);
    await expect(async () => {
      const piece = await waitForUrgentPiece(page);
      const chuteIndex = chuteIndexForColor(piece.color);
      await page.keyboard.press(String(chuteIndex + 1));
      expect(await readScore(page)).toBeGreaterThan(scoreBeforeKeyboard);
    }).toPass({ timeout: 20000 });

    // ランダムなシュートへのドラッグを連打しても表示が壊れない(ゲームオーバーなら都度リスタート)。
    const gameOver = page.getByTestId("shredder-line-gameover");
    for (let i = 0; i < 10; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("shredder-line-restart").click();
        continue;
      }
      const piece = await readUrgentPiece(page);
      if (piece) {
        const chute = await chuteCenter(stage, i % SCRAP_COLORS.length);
        await dragPieceToChute(page, piece, chute);
      }
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("shredder-line-restart").click();
    }
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける。
    if (!(await gameOver.isVisible().catch(() => false))) {
      const before = await readScore(page);
      const piece = await waitForUrgentPiece(page);
      const chute = await chuteCenter(stage, chuteIndexForColor(piece.color));
      await dragPieceToChute(page, piece, chute);
      await expect
        .poll(() => readScore(page), { message: "リサイズ後も投入できる" })
        .toBeGreaterThanOrEqual(before);
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
