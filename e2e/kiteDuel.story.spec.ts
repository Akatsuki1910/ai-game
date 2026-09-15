import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/kite-duel";
// engine/world.ts の ROUND_SECONDS と一致させる想定の1ラウンドの秒数。
const ROUND_SECONDS = 75;

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("kite-duel-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("kite-duel-combo").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `コンボ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Kite Duel のストーリー", () => {
  test("遊び始めてから一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);

    // ラウンドが実際に進む
    await expect
      .poll(() => readTimerSeconds(page), { message: "残り時間が減っていく" })
      .toBeLessThan(startedAt);

    // 凧を旋回させる(このゲームの中心操作)。壊れないことを確認する。
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.9 }, { xRatio: 0.75, yRatio: 0.3 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    // 一時停止するとオーバーレイが出て、時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.6, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.4 });
    expect(await readTimerSeconds(page), "一時停止中の操作で時間が動かない").toBe(pausedAt);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("矢印キー / AD キーでも操作でき、連打しても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // クリックしてキャンバスにフォーカスを合わせてから、矢印キーを押し続ける
    await stage.click({ position: { x: 10, y: 10 } });
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 30);
    await page.keyboard.up("ArrowRight");

    await page.keyboard.down("ArrowLeft");
    await waitForFrames(page, 30);
    await page.keyboard.up("ArrowLeft");

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("d");
      await page.keyboard.press("a");
    }

    await expect(stage.locator("canvas"), "キー操作後もキャンバスが生きている").toBeVisible();
    await expect
      .poll(() => readTimerSeconds(page), { message: "キー操作中もラウンドが進む" })
      .toBeLessThan(ROUND_SECONDS);

    expect(errors, "キー操作中にエラーが出ていない").toEqual([]);
  });

  test("Rキーでいつでもラウンドを最初からやり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const startedAt = await readTimerSeconds(page);
    await expect
      .poll(() => readTimerSeconds(page), { message: "少し時間が経過する" })
      .toBeLessThan(startedAt);

    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.9 }, { xRatio: 0.8, yRatio: 0.3 });
    const beforeReset = await readTimerSeconds(page);
    await stage.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("r");

    // GPU/CPU負荷でフレームが詰まっていても反映されるまで「条件+タイムアウト」で待つ。
    await expect
      .poll(() => readTimerSeconds(page), { message: "リセットで残り時間がリセット前より増える" })
      .toBeGreaterThan(beforeReset);

    expect(
      await readTimerSeconds(page),
      "リセットで残り時間がほぼ満タンに戻る",
    ).toBeGreaterThanOrEqual(ROUND_SECONDS - 2);
    expect(await readScore(page), "リセットでスコアが0に戻る").toBe(0);
    expect(await readCombo(page), "リセットでコンボが0に戻る").toBe(0);

    expect(errors, "リセット操作中にエラーが出ていない").toEqual([]);
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
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.9 }, { xRatio: 0.7, yRatio: 0.4 });
    await expect
      .poll(() => readTimerSeconds(page), { message: "リサイズ後もラウンドが進む" })
      .toBeLessThan(ROUND_SECONDS);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
