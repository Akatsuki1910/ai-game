import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/taut-line";
const LINES_MAX = 3;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("taut-line-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLines(page: Page): Promise<number> {
  const value = await page.getByTestId("taut-line-lines").getAttribute("data-lines");
  expect(value, "ラインの残数が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readIsRunning(page: Page): Promise<boolean> {
  const value = await page.getByTestId("taut-line-fish").getAttribute("data-running");
  return value === "true";
}

/**
 * ステージ上で「押したまま上へ引く」ポンプ動作を指定回数繰り返す。
 * ステージ高さの22%ぶん引き上げる(=コンポーネント側の閾値16%を十分超える、ほぼ全力)。
 */
async function pumpOnStage(page: Page, stage: Locator, pumps: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;

  const x = box.x + box.width * 0.5;
  const baseY = box.y + box.height * 0.65;
  const pumpDistance = box.height * 0.22;

  await page.mouse.move(x, baseY);
  await page.mouse.down();
  let y = baseY;
  for (let i = 0; i < pumps; i++) {
    const upY = y - pumpDistance;
    await page.mouse.move(x, upY, { steps: 3 });
    y = upY;
    const downY = y + pumpDistance * 0.6;
    await page.mouse.move(x, downY, { steps: 3 });
    y = downY;
  }
  await page.mouse.up();
}

test.describe("Taut Line のストーリー", () => {
  test("ポンピング操作でキャッチでき、スコア・コンボが増える。一時停止中は操作が無視される", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readLines(page), "開始時のラインは満タン").toBe(LINES_MAX);

    const stage = page.getByTestId("taut-line-stage");

    // ポンプ(押して上へ引く)を繰り返して1匹目をキャッチする。
    // toPassは失敗するたびに待ち時間を伸ばして再試行するため、1回の試行で複数回ポンプして
    // 待ち時間中の魚の引き(drift/run)に負けないだけの進行を確保する。
    await expect(async () => {
      await pumpOnStage(page, stage, 3);
      expect(await readScore(page)).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
    expect(await readCombo(page), "キャッチでコンボが伸びる").toBeGreaterThan(0);
    expect(await readLines(page), "キャッチではラインは減らない").toBe(LINES_MAX);

    // 一時停止するとオーバーレイが出て、ポンプ操作をしても状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedLines = await readLines(page);
    await pumpOnStage(page, stage, 5);
    await waitForFrames(page, 10);
    expect(await readScore(page), "一時停止中はポンプしてもスコアが変化しない").toBe(pausedScore);
    expect(await readLines(page), "一時停止中はラインも変化しない").toBe(pausedLines);

    // 再開すると再びポンプで進行できる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(async () => {
      await pumpOnStage(page, stage, 3);
      expect(await readScore(page)).toBeGreaterThan(pausedScore);
    }).toPass({ timeout: 15000 });

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("放置すると魚に逃げられ、run中に巻きすぎるとラインが切れる。尽きるとゲームオーバーになりリスタートできる", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("taut-line-stage");

    // 1回目: 何もせず放置して距離が限界に達し、魚に逃げられる(escaped)。
    await expect
      .poll(() => readLines(page), {
        message: "放置すると魚に逃げられてラインが減る",
        timeout: 10000,
      })
      .toBe(LINES_MAX - 1);

    // 2回目: run中(強く引いている間)に巻き続けてテンションを限界まで上げ、ラインを切る(snapped)。
    await expect
      .poll(() => readIsRunning(page), { message: "魚がrun状態になる", timeout: 10000 })
      .toBe(true);
    await pumpOnStage(page, stage, 6);
    await expect
      .poll(() => readLines(page), { message: "run中の巻きすぎでラインが切れる", timeout: 5000 })
      .toBeLessThanOrEqual(LINES_MAX - 2);

    // 残りは放置して使い切り、ゲームオーバーにする(上限回数を決め、無限ループにしない)。
    for (let guard = 0; guard < 6 && (await readLines(page)) > 0; guard++) {
      await waitForFrames(page, 60);
    }

    await expect(page.getByTestId("taut-line-gameover")).toBeVisible({ timeout: 15000 });
    expect(await readLines(page), "ラインが0になっている").toBe(0);

    // ゲームオーバー中にポンプしても、実際のユーザーと同様に入力が無視される。
    const scoreAtGameOver = await readScore(page);
    await pumpOnStage(page, stage, 3);
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("taut-line-restart").click();
    await expect(page.getByTestId("taut-line-gameover")).toBeHidden();
    expect(await readLines(page), "リスタートでラインが全回復する").toBe(LINES_MAX);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readCombo(page), "リスタートでコンボが0に戻る").toBe(0);

    expect(errors, "ライン減少・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも巻けて、連打や画面リサイズをしても壊れない", async ({ page }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("taut-line-stage");

    // キーボード操作: ↑キーを連打(押して離す)してリールを巻く。
    // toPassの再試行間隔が伸びても魚の引きに負けないよう、1回の試行で複数回押す。
    const scoreBeforeKeyboard = await readScore(page);
    await expect(async () => {
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("ArrowUp");
      }
      expect(await readScore(page)).toBeGreaterThan(scoreBeforeKeyboard);
    }).toPass({ timeout: 20000 });

    // ポンプ連打とキー連打を混ぜても表示が壊れない(ゲームオーバーなら都度リスタート)。
    const gameOver = page.getByTestId("taut-line-gameover");
    for (let i = 0; i < 8; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("taut-line-restart").click();
        continue;
      }
      if (i % 2 === 0) {
        await pumpOnStage(page, stage, 2);
      } else {
        await page.keyboard.press("w");
      }
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("taut-line-restart").click();
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
      await expect(async () => {
        await pumpOnStage(page, stage, 3);
        expect(await readScore(page)).toBeGreaterThanOrEqual(before);
      }).toPass({ timeout: 15000 });
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
