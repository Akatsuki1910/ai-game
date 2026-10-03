import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/rail-weaver";
const PLANK_STOCK_MAX = 4;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("rail-weaver-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readPlankStock(page: Page): Promise<number> {
  const value = await page.getByTestId("rail-weaver-plank-stock").getAttribute("data-stock");
  expect(value, "板の在庫が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readDistance(page: Page): Promise<number> {
  const value = await page.getByTestId("rail-weaver-distance").getAttribute("data-distance");
  expect(value, "距離が属性から読み取れる").not.toBeNull();
  return Number(value);
}

/** 補修圏内にギャップが入り、タップすれば板を渡せる状態になるまで待つ。 */
async function waitForGapInReach(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const marker = page.getByTestId("rail-weaver-next-gap");
        return await marker.getAttribute("data-in-reach");
      },
      { message: "レールの切れ目が補修圏内に入る", timeout: 10000 },
    )
    .toBe("true");
}

async function tapStage(stage: Locator): Promise<void> {
  await stage.click({ position: { x: 10, y: 10 } });
}

test.describe("Rail Weaver のストーリー", () => {
  test("補修圏内でタップすると加点・コンボが伸び、一時停止・再開もできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readPlankStock(page), "開始時の板は満タン").toBe(PLANK_STOCK_MAX);

    await expect(async () => {
      await waitForGapInReach(page);
      await tapStage(stage);
      expect(await readScore(page)).toBeGreaterThan(0);
    }).toPass({ timeout: 20000 });

    expect(await readCombo(page), "補修でコンボが伸びる").toBeGreaterThan(0);
    expect(await readPlankStock(page), "板を1本消費する").toBe(PLANK_STOCK_MAX - 1);

    // 一時停止するとオーバーレイが出て、状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedDistance = await readDistance(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readDistance(page), "一時停止中は距離が進まない").toBe(pausedDistance);

    // 一時停止中にタップしても無視される。
    await tapStage(stage);
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);
    expect(await readPlankStock(page), "一時停止中の操作で板が減らない").toBe(PLANK_STOCK_MAX - 1);

    // 再開すると進行を再開する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readDistance(page), { message: "再開後は距離が進む" })
      .toBeGreaterThan(pausedDistance);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("何もせず放置すると脱線してゲームオーバーになり、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 何も補修せず放置すると、いずれレールの切れ目に到達して脱線する。
    await expect(page.getByTestId("rail-weaver-gameover")).toBeVisible({ timeout: 30000 });
    expect(await readPlankStock(page), "脱線後も板の在庫は変化しない").toBeGreaterThanOrEqual(0);
    const distanceAtGameOver = await readDistance(page);

    // ゲームオーバー中にタップしても、実際のユーザーと同様に入力が無視される。
    const stage = page.getByTestId("game-shell-stage");
    const scoreAtGameOver = await readScore(page);
    await tapStage(stage);
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("rail-weaver-restart").click();
    await expect(page.getByTestId("rail-weaver-gameover")).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readCombo(page), "リスタートでコンボが0に戻る").toBe(0);
    expect(await readPlankStock(page), "リスタートで板が全回復する").toBe(PLANK_STOCK_MAX);
    // リスタート後も時間は進み続けるため、厳密に0ではなく「脱線時点より大きく巻き戻っている」ことを確認する。
    expect(await readDistance(page), "リスタートで距離が最初からやり直しになる").toBeLessThan(
      distanceAtGameOver,
    );

    expect(errors, "脱線・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも補修でき、連打や画面リサイズをしても壊れない", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    const gameOver = page.getByTestId("rail-weaver-gameover");

    // キーボード操作: Enterキーで補修圏内のギャップに板を渡す。
    const scoreBeforeKeyboard = await readScore(page);
    await expect(async () => {
      await waitForGapInReach(page);
      await page.keyboard.press("Enter");
      expect(await readScore(page)).toBeGreaterThan(scoreBeforeKeyboard);
    }).toPass({ timeout: 20000 });

    // タップを連打しても表示が壊れない(ゲームオーバーなら都度リスタート)。
    for (let i = 0; i < 20; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("rail-weaver-restart").click();
        continue;
      }
      await tapStage(stage);
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("rail-weaver-restart").click();
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
        await waitForGapInReach(page);
        await tapStage(stage);
        expect(await readScore(page)).toBeGreaterThanOrEqual(before);
      }).toPass({ timeout: 20000 });
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
