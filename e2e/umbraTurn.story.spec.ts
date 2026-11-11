import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/umbra-turn";

async function readPercent(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)\s*%/);
  expect(matched, `"${testId}" の表示から%が読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("umbra-turn-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Umbra Turn のストーリー", () => {
  test("遊び始めてドラッグで水晶を回し、一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("umbra-turn-round")).toHaveText("ROUND 1");
    const startedAt = await readSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);

    // ラウンドが実際に進行する(無操作なら残り時間が減っていく)
    await expect
      .poll(() => readSeconds(page), { message: "残り時間が減っていく" })
      .toBeLessThan(startedAt);

    // ドラッグで水晶を回転させる(このゲームの中心操作)。何度もドラッグして一致度を動かす。
    const stage = page.getByTestId("game-shell-stage");
    for (let i = 0; i < 6; i++) {
      await dragOnStage(
        page,
        stage,
        { xRatio: 0.3 + (i % 2) * 0.1, yRatio: 0.4 },
        { xRatio: 0.7 - (i % 2) * 0.1, yRatio: 0.6 },
      );
      await waitForFrames(page, 10);
    }

    const matchAfterDrag = await readPercent(page, "umbra-turn-match");
    expect(Number.isFinite(matchAfterDrag), "一致度が数値として読み取れる").toBe(true);
    expect(matchAfterDrag).toBeGreaterThanOrEqual(0);
    expect(matchAfterDrag).toBeLessThanOrEqual(100);

    // 一時停止するとオーバーレイが出て、時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readSeconds(page);
    await waitForFrames(page, 60);
    expect(await readSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中にドラッグしても壊れない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.4, yRatio: 0.3 });
    expect(await readSeconds(page), "一時停止中の操作で時間が動かない").toBe(pausedAt);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボードでも回転・一時停止・リセットができる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await stage.click({ position: { x: 10, y: 10 } });

    // 矢印キーで回転 → 一致度(または集中ゲージ)が変化し得ることを確認(壊れないことが主目的)
    for (let i = 0; i < 20; i++) {
      await page.keyboard.down("ArrowRight");
      await page.keyboard.down("ArrowDown");
      await waitForFrames(page, 3);
    }
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowDown");

    const matchValue = await readPercent(page, "umbra-turn-match");
    expect(matchValue).toBeGreaterThanOrEqual(0);

    // Spaceで一時停止
    await page.keyboard.press(" ");
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await page.keyboard.press(" ");
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // Rでリセット(ラウンド1・ライフ満タンに戻る)
    await page.keyboard.press("r");
    await expect(page.getByTestId("umbra-turn-round")).toHaveText("ROUND 1");
    await expect(page.getByTestId("umbra-turn-lives")).toHaveText("◆◆◆");

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("何も操作せず放置するとタイムアウトが繰り返されてゲームオーバーになり、やり直せる", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("umbra-turn-lives")).toHaveText("◆◆◆");

    // 無操作でライフが尽きるまで待つ(ラウンド1=14秒、進むほど制限時間が短くなるため
    // 3ライフ分でも1分程度に収まるが、環境差を考慮して余裕を持たせる)。
    await expect
      .poll(async () => page.getByTestId("umbra-turn-gameover").isVisible(), {
        message: "無操作が続くとゲームオーバーになる",
        timeout: 70_000,
      })
      .toBe(true);

    await expect(page.getByTestId("umbra-turn-restart")).toBeVisible();

    // ゲームオーバー中にドラッグしても壊れない
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.3 }, { xRatio: 0.6, yRatio: 0.6 });
    await expect(page.getByTestId("umbra-turn-gameover")).toBeVisible();

    // やり直すと最初から再開する
    await page.getByTestId("umbra-turn-restart").click();
    await expect(page.getByTestId("umbra-turn-gameover")).toBeHidden();
    await expect(page.getByTestId("umbra-turn-round")).toHaveText("ROUND 1");
    await expect(page.getByTestId("umbra-turn-lives")).toHaveText("◆◆◆");
    await expect(page.getByTestId("game-shell-score")).toContainText("0");

    expect(errors, "ゲームオーバー中の操作でエラーが出ていない").toEqual([]);
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
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.55, yRatio: 0.45 });
    await expect
      .poll(() => readSeconds(page), { message: "リサイズ後もラウンドが進む" })
      .toBeLessThan(90);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
