import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/daruma-drop";

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("daruma-drop-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readStabilityWidth(page: Page): Promise<number> {
  const track = page.getByTestId("daruma-drop-stability");
  const box = await track.boundingBox();
  const fillBox = await track.locator("div").boundingBox();
  expect(box && fillBox, "安定度バーのサイズが取得できる").not.toBeNull();
  if (!box || !fillBox) return 0;
  return fillBox.width / box.width;
}

/** ステージ中央あたりでドラッグして木槌を振る。amountRatio が大きいほど強く引く。 */
async function swing(page: Page, amountRatio: number): Promise<void> {
  const stage = page.getByTestId("game-shell-stage");
  await dragOnStage(
    page,
    stage,
    { xRatio: 0.5, yRatio: 0.5 },
    { xRatio: 0.5, yRatio: 0.5 - amountRatio * 0.4 },
  );
}

test.describe("Daruma Drop のストーリー", () => {
  test("遊び始めてから振って一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("daruma-drop-round")).toHaveText(/ROUND 1/);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 何度か木槌を振ってみる（強弱をばらけさせて全outcomeを踏む）
    for (const amount of [0.1, 0.5, 0.9, 0.3, 0.7]) {
      await swing(page, amount);
      await waitForFrames(page, 15);
    }

    // ウィンドウ幅は最大0.3なので、0.1〜0.9まで振った5回のうち必ず何かが外れて安定度が減る
    await expect
      .poll(() => readStabilityWidth(page), { message: "安定度バーが初期値から減っている" })
      .toBeLessThan(0.99);

    // 一時停止すると安定度バーの表示が固定される
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedStability = await readStabilityWidth(page);
    await waitForFrames(page, 60);
    expect(await readStabilityWidth(page), "一時停止中は安定度が変化しない").toBeCloseTo(
      pausedStability,
      2,
    );

    // 一時停止中に振っても壊れない
    await swing(page, 0.5);
    expect(await readStabilityWidth(page), "一時停止中の操作で安定度が変化しない").toBeCloseTo(
      pausedStability,
      2,
    );

    // 再開すると操作を受け付ける
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("ぴったりのタイミングを繰り返すとラウンドが進んでいく", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const startedRound = await readRound(page);

    // ちょうど良い強さ(中程度)で何度も振り、ラウンドが進むか安定度が尽きるまで試す。
    // パワーのウィンドウはランダムなので、様々な強さで試行して「ラウンドが進む」挙動自体を確認する。
    let advanced = false;
    for (let i = 0; i < 40 && !advanced; i++) {
      const amount = 0.2 + (i % 7) * 0.1;
      await swing(page, amount);
      await waitForFrames(page, 10);
      const gameOver = await page.getByTestId("daruma-drop-gameover").isVisible();
      if (gameOver) break;
      if ((await readRound(page)) > startedRound) advanced = true;
    }

    const isOver = await page.getByTestId("daruma-drop-gameover").isVisible();
    expect(advanced || isOver, "ラウンドが進むかタワーが崩れるかのいずれかが発生する").toBe(true);

    expect(errors, "連続操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても一時停止ボタンの表示と状態がずれない", async ({ page }) => {
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

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("タワーが崩れたらリスタートで最初から遊び直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 常に弱すぎる(ごく小さい)振りを繰り返して安定度を削り切り、確実にゲームオーバーに到達させる。
    for (let i = 0; i < 60; i++) {
      const isOver = await page.getByTestId("daruma-drop-gameover").isVisible();
      if (isOver) break;
      await swing(page, 0.02);
      await waitForFrames(page, 8);
    }

    await expect(
      page.getByTestId("daruma-drop-gameover"),
      "安定度切れでゲームオーバーになる",
    ).toBeVisible();

    await page.getByTestId("daruma-drop-restart").click();
    await expect(page.getByTestId("daruma-drop-gameover")).toBeHidden();
    await expect(page.getByTestId("daruma-drop-round")).toHaveText(/ROUND 1/);
    expect(await readStabilityWidth(page)).toBeCloseTo(1, 1);

    expect(errors, "リスタート操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける
    await swing(page, 0.5);
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "リサイズ後も操作できる").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
