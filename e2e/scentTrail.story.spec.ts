import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/scent-trail";

async function readDeliveries(page: Page): Promise<number> {
  const text = await page.getByTestId("scent-trail-deliveries").innerText();
  const matched = text.match(/DELIVERIES (\d+)/);
  expect(matched, `届けた数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readMarkerCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} の座標が取得できる`).not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function readHealthFillWidth(page: Page): Promise<number> {
  const bar = page.getByTestId("scent-trail-health");
  const barBox = await bar.boundingBox();
  const fillBox = await bar.locator("div").boundingBox();
  expect(barBox, "体力バーの領域が取得できる").not.toBeNull();
  expect(fillBox, "体力充填部の領域が取得できる").not.toBeNull();
  if (!barBox || !fillBox) return 0;
  return fillBox.width / barBox.width;
}

/** 巣のマーカーの上へポインタを移動してから押し下げ、以後トレイルを描き続ける状態にする。 */
async function beginPainting(page: Page): Promise<void> {
  const nest = await readMarkerCenter(page, "scent-trail-nest-marker");
  await page.mouse.move(nest.x, nest.y);
  await page.mouse.down();
}

/** 巣と現在の餌の間を、押しっぱなしのポインタで一往復させてトレイルを描く。 */
async function sweepTrailTowardFoodOnce(page: Page): Promise<void> {
  const nest = await readMarkerCenter(page, "scent-trail-nest-marker");
  const food = await readMarkerCenter(page, "scent-trail-food-marker");
  await page.mouse.move(food.x, food.y, { steps: 10 });
  await waitForFrames(page, 2);
  await page.mouse.move(nest.x, nest.y, { steps: 10 });
  await waitForFrames(page, 2);
}

/** 2枚のスクリーンショットが同じかどうかを返す(一時停止で本当に止まっているかの確認に使う)。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

test.describe("Scent Trail のストーリー", () => {
  test("トレイルを描いて蟻を導くと、餌が巣に届いて得点が入る", async ({ page }) => {
    // コロニーは捕食者にいずれ全滅させられる運命だが、再出現までの短い間に
    // 届けきれることが多いため、途中で全滅しても諦めずリスタートして続ける。
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readDeliveries(page), "開始時の届けた数は0").toBe(0);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await beginPainting(page);
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("scent-trail-gameover").isVisible()) {
            await page.getByTestId("scent-trail-restart").click();
            await beginPainting(page);
          }
          await sweepTrailTowardFoodOnce(page);
          return readScore(page);
        },
        {
          message: "トレイルを描いて蟻を導くと餌が届いて得点が入る",
          timeout: 100_000,
          intervals: [50],
        },
      )
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(await readDeliveries(page), "得点が入っていれば届けた数も1以上").toBeGreaterThan(0);
    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("捕食者に蟻を狙われ続けるとコロニーの体力が尽きて全滅し、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    expect(await readHealthFillWidth(page), "開始時の体力は満タン").toBeGreaterThan(0.95);

    // トレイルを描かずに放置すると、蟻は遅いまま捕食者に狙われ続けていずれ全滅する。
    await expect
      .poll(async () => page.getByTestId("scent-trail-gameover").isVisible(), {
        message: "放置するとコロニーの体力が尽きて全滅する",
        timeout: 70_000,
        intervals: [500],
      })
      .toBe(true);

    await expect(page.getByTestId("scent-trail-gameover")).toContainText("SCORE");
    await page.getByTestId("scent-trail-restart").click();
    await expect(page.getByTestId("scent-trail-gameover")).toBeHidden();
    expect(await readHealthFillWidth(page), "リスタートで体力が満タンに戻る").toBeGreaterThan(0.95);
    expect(await readDeliveries(page), "リスタートで届けた数が0に戻る").toBe(0);

    expect(errors, "全滅の前後でエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await expect
      .poll(async () => isFrozen(page, stage, 40), {
        message: "無操作でも蟻や捕食者が動くため画面は変化する",
      })
      .toBe(false);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中は蟻も捕食者も完全に止まる").toBe(true);

    // 一時停止中にドラッグ操作をしても、描画も進行も止まったまま
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.4 });
    expect(await isFrozen(page, stage, 20), "一時停止中の操作でも画面は止まったまま").toBe(true);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    expect(await isFrozen(page, stage, 45), "再開すると画面がまた動き出す").toBe(false);

    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
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

    const markerBox = await page.getByTestId("scent-trail-nest-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(markerBox, "リサイズ後も巣の目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (markerBox && stageBox) {
      expect(markerBox.x, "巣がステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(markerBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.55, yRatio: 0.45 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
