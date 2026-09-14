import { expect, type Page, test } from "@playwright/test";
import { PIGMENTS, rgbToCssColor } from "../src/app/games/chroma-well/engine/world";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/chroma-well";

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("chroma-well-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readSwatchColor(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => (el as HTMLElement).style.backgroundColor);
}

test.describe("Chroma Well のストーリー", () => {
  test("インクを盛って混色し、パレット切替と一時停止までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: スコア・タイマー・お題色・パレットが出ている
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);

    await expect
      .poll(() => readSwatchColor(page, "chroma-well-target"), {
        message: "お題の色が表示されている",
      })
      .toMatch(/^rgb\(/);

    // 開始時はまだ何も盛っていないので現在色は付いていない
    const initialCurrentColor = await readSwatchColor(page, "chroma-well-current");
    expect(initialCurrentColor, "開始時は現在色が未設定").not.toBe(rgbToCssColor(PIGMENTS[0]));

    // 初期選択（赤=0番目）のまま盛る → 単色なので現在色はその原色そのものになる
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    }
    await expect
      .poll(() => readSwatchColor(page, "chroma-well-current"), {
        message: "単色を盛ると現在色がその原色ちょうどになる",
      })
      .toBe(rgbToCssColor(PIGMENTS[0]));

    // パレットを切り替えると選択状態が変わる
    const secondPigment = page.getByTestId("chroma-well-pigment-2");
    await expect(page.getByTestId("chroma-well-pigment-0")).toHaveAttribute("aria-pressed", "true");
    await secondPigment.click();
    await expect(secondPigment).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("chroma-well-pigment-0")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // 別の場所に別色を混ぜると、現在色が単色ではなくなる（=本当に混色している）
    await dragOnStage(page, stage, { xRatio: 0.2, yRatio: 0.2 }, { xRatio: 0.25, yRatio: 0.25 });
    await waitForFrames(page, 20);
    await expect
      .poll(() => readSwatchColor(page, "chroma-well-current"), {
        message: "2色目を混ぜると単色から変化する",
      })
      .not.toBe(rgbToCssColor(PIGMENTS[0]));

    // 一時停止するとオーバーレイが出て、時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.6, yRatio: 0.6 }, { xRatio: 0.7, yRatio: 0.5 });
    expect(await readTimerSeconds(page), "一時停止中の操作で時間が動かない").toBe(pausedAt);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    const runningAt = await readTimerSeconds(page);
    await expect
      .poll(() => readTimerSeconds(page), { message: "連打後も進行している" })
      .toBeLessThan(runningAt);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "連打後の一時停止も効いている").toBe(pausedAt);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
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

    // リサイズ後も操作を受け付け、盛ったインクが現在色に反映される
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.5 });
    await expect
      .poll(() => readSwatchColor(page, "chroma-well-current"), {
        message: "リサイズ後も盛ったインクが現在色に反映される",
      })
      .toMatch(/^rgb\(/);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
