import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/cairn-balance";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Cairn Balance のストーリー", () => {
  test("石を中央に落とすと積め、重心が外れると崩れて終わる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時は0段").toBe(0);
    await expect(page.getByTestId("cairn-balance-status")).toBeVisible();

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 中央に向けてドラッグして離す（支持帯が広い1段目は、中央に置けば安定するはず）
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.5 });
    await waitForFrames(page, 10);
    await expect.poll(() => readScore(page), { message: "1段目が積まれる" }).toBeGreaterThan(0);

    const heightAfterFirstStone = await readScore(page);
    await expect(page.getByTestId("cairn-balance-gameover")).toBeHidden();

    // 端まで大きくずらして落とすと、支持帯から重心が外れて崩れるはず
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.98, yRatio: 0.5 });
    await expect(page.getByTestId("cairn-balance-gameover"), "重心が外れて崩壊する").toBeVisible({
      timeout: 10_000,
    });

    // 崩れた後も最後に積めた段数のまま変わらない
    expect(await readScore(page)).toBe(heightAfterFirstStone);

    // リスタートすると最初からやり直せる
    await page.getByTestId("cairn-balance-restart").click();
    await expect(page.getByTestId("cairn-balance-gameover")).toBeHidden();
    expect(await readScore(page), "リスタートで0段に戻る").toBe(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("回転ボタンを押している間は重心表示が変わり、離すと止まる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const rotateRight = page.getByTestId("cairn-balance-rotate-right");
    const box = await rotateRight.boundingBox();
    expect(box, "回転ボタンの位置が取得できる").not.toBeNull();
    if (!box) return;

    // ボタンを押しっぱなしにして一定時間回転させる（長押し）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await waitForFrames(page, 40);
    await page.mouse.up();

    // 離した後はそれ以上回転しない（連打しても壊れない）
    for (let i = 0; i < 5; i++) await rotateRight.click();

    await expect(page.getByTestId("cairn-balance-status")).toBeVisible();
    expect(errors, "回転操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は操作しても状態が変わらず、連打しても崩れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");
    const stage = page.getByTestId("game-shell-stage");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.7, yRatio: 0.5 });
    await waitForFrames(page, 30);
    expect(await readScore(page), "一時停止中にドラッグしても段数は変わらない").toBe(
      scoreWhilePaused,
    );

    // 一時停止ボタンを連打しても最終的に整合した状態に戻る（最初の1回と合わせて偶数回で再開状態になる）
    for (let i = 0; i < 3; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "一時停止中にエラーが出ていない").toEqual([]);
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

    // リサイズ後も操作を受け付ける
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.5 });
    await waitForFrames(page, 20);
    await expect(page.getByTestId("cairn-balance-status")).toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
