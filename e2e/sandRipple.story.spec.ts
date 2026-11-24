import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/sand-ripple";

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("sand-ripple-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCoveragePercent(page: Page): Promise<number> {
  const text = await page.getByTestId("sand-ripple-coverage").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `掃き面積の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Sand Ripple のストーリー", () => {
  test("砂をかいて掃き面積と得点が増え、一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: スコア・タイマー・掃き面積が出ている
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCoveragePercent(page), "開始時の掃き面積は0%").toBe(0);
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);

    // ラウンドが実際に進む
    await expect
      .poll(() => readTimerSeconds(page), { message: "残り時間が減っていく" })
      .toBeLessThan(startedAt);

    // 砂をかく（このゲームの中心操作）。石にぶつからない左上あたりを掃く。
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.08, yRatio: 0.08 }, { xRatio: 0.3, yRatio: 0.12 });
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.12 }, { xRatio: 0.1, yRatio: 0.2 });

    await expect
      .poll(() => readCoveragePercent(page), { message: "掃いた分だけ掃き面積が増える" })
      .toBeGreaterThan(0);
    await expect
      .poll(() => readScore(page), { message: "掃いた分だけ得点が増える" })
      .toBeGreaterThan(0);

    // 一時停止するとオーバーレイが出て、時間も進行も止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    const coverageWhilePaused = await readCoveragePercent(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);
    expect(await readCoveragePercent(page), "一時停止中は掃き面積も変わらない").toBe(
      coverageWhilePaused,
    );

    // 一時停止中にドラッグしても壊れない・進行しない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.55 });
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

  test("連続して砂をかき続けても、画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 同じ場所を連打気味に何度も掃く（連続操作で壊れないか）
    for (let i = 0; i < 5; i++) {
      await dragOnStage(page, stage, { xRatio: 0.1, yRatio: 0.1 }, { xRatio: 0.2, yRatio: 0.15 });
    }
    await expect
      .poll(() => readCoveragePercent(page), { message: "連打気味に掃いても面積が増える" })
      .toBeGreaterThan(0);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける
    await dragOnStage(page, stage, { xRatio: 0.1, yRatio: 0.1 }, { xRatio: 0.25, yRatio: 0.2 });
    await expect
      .poll(() => readTimerSeconds(page), { message: "リサイズ後もラウンドが進む" })
      .toBeLessThan(76);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
