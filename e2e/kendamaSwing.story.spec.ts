import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/kendama-swing";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("kendama-swing-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Kendama Swing のストーリー", () => {
  test("操作しなくても最初の一投は手元に戻ってきてキャッチが成立し、コンボと得点が増える", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    await expect(page.getByTestId("kendama-swing-lives")).toHaveText("♥♥♥");

    // 最初の一投はまっすぐ打ち上がって手元へ戻ってくるため、何も操作せずに待つだけでキャッチが成立する
    await expect
      .poll(() => readCombo(page), {
        message: "何もしなくても最初の玉は受け口へ戻ってきてキャッチする",
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    expect(await readScore(page), "得点も増えている").toBeGreaterThan(0);
    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("ドラッグでカップを動かせて、一時停止中は完全に止まり連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.7 }, { xRatio: 0.3, yRatio: 0.6 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "ドラッグ後もキャンバスが生きている").toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScreenshot = await stage.screenshot();
    await waitForFrames(page, 45);
    const stillPausedScreenshot = await stage.screenshot();
    expect(
      pausedScreenshot.equals(stillPausedScreenshot),
      "一時停止中は玉もカップも完全に止まる",
    ).toBe(true);

    // 一時停止中にドラッグしても画面は動かない
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.6 }, { xRatio: 0.6, yRatio: 0.5 });
    const afterDragWhilePaused = await stage.screenshot();
    expect(
      stillPausedScreenshot.equals(afterDragWhilePaused),
      "一時停止中の操作でも画面は止まったまま",
    ).toBe(true);

    // 再開してから連打しても最終的な状態がずれない
    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "操作・一時停止中にエラーが出ていない").toEqual([]);
  });

  test("受け損ない続けるとライフが尽きてゲームオーバーになり、リスタートすると最初から遊べる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
    await page.mouse.down();

    // カップを対角線上の両端(高い位置⇔床際)へ振り回し続け、受け口を大きく外させ続ける。
    // 床際まで振ると紐がたるんだ玉が床に届いてしまうため、確実にミスを重ねられる。
    let sweepToLowCorner = true;
    await expect
      .poll(
        async () => {
          const currentBox = await stage.boundingBox();
          if (currentBox) {
            const xRatio = sweepToLowCorner ? 0.85 : 0.15;
            const yRatio = sweepToLowCorner ? 0.92 : 0.38;
            sweepToLowCorner = !sweepToLowCorner;
            await page.mouse.move(
              currentBox.x + currentBox.width * xRatio,
              currentBox.y + currentBox.height * yRatio,
              { steps: 2 },
            );
          }
          return page.getByTestId("kendama-swing-gameover").isVisible();
        },
        {
          message: "受け口を大きく外し続けるとライフが尽きてゲームオーバーになる",
          timeout: 20_000,
          intervals: [150],
        },
      )
      .toBe(true);

    await page.mouse.up();
    await expect(page.getByTestId("kendama-swing-lives")).toHaveText("♡♡♡");

    // リスタートすると最初から遊べる
    await page.getByTestId("kendama-swing-restart").click();
    await expect(page.getByTestId("kendama-swing-gameover")).toBeHidden();
    expect(await readScore(page), "リスタートで得点が0に戻る").toBe(0);
    await expect(page.getByTestId("kendama-swing-lives")).toHaveText("♥♥♥");

    await expect
      .poll(() => readCombo(page), {
        message: "リスタート後も遊び続けられる(最初の一投がキャッチされる)",
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    expect(errors, "ゲームオーバー・リスタート中にエラーが出ていない").toEqual([]);
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
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.6 }, { xRatio: 0.6, yRatio: 0.5 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
