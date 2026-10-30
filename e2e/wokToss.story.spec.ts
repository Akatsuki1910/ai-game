import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/wok-toss";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("wok-toss-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("wok-toss-combo").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `コンボ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Wok Toss のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも具材が自動で弾んでスコアが伸びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("wok-toss-lives")).toBeVisible();
    await expect(page.getByTestId("wok-toss-combo")).toBeVisible();
    await expect(page.getByTestId("wok-toss-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時のライフは3").toBe(3);

    // 何も操作しなくても具材は重力で落下してウォックの底で弾み、自動的に得点する
    await expect
      .poll(() => readScore(page), {
        message: "無操作でも具材が落下してバウンドし、得点が増える",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("ドラッグでウォックを傾けてもコンボ・スコアが伸び続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    // 中央から少しだけ傾けた位置へドラッグし、そのまま保持する(実際のドラッグ操作を通す)
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.6, { steps: 5 });
    await waitForFrames(page, 10);

    await expect
      .poll(() => readCombo(page), { message: "傾けている間にコンボが伸びる" })
      .toBeGreaterThan(0);
    expect(await readScore(page), "コンボに応じて得点が入る").toBeGreaterThan(0);

    await page.mouse.up();
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();
    expect(errors, "ドラッグ操作中にエラーが出ていない").toEqual([]);
  });

  test("矢印キー/ADキーで傾けられ、一時停止/連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await stage.click({ position: { x: 10, y: 10 } });
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 30);
    await page.keyboard.up("ArrowRight");

    await page.keyboard.down("a");
    await waitForFrames(page, 30);
    await page.keyboard.up("a");
    await expect(stage.locator("canvas"), "キー操作後もキャンバスが生きている").toBeVisible();

    // 一時停止するとオーバーレイが出て、スコア・ライフが止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中はライフも変わらない").toBe(livesWhilePaused);

    // 一時停止中にドラッグしても壊れない
    const box = await stage.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readScore(page), "一時停止中の操作でスコアが変わらない").toBe(scoreWhilePaused);

    // 再開 → 一時停止ボタンの連打でも最終状態と表示が一致する
    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "キー操作/一時停止中にエラーが出ていない").toEqual([]);
  });

  test("傾け続けて具材をこぼし切るとゲームオーバーになり、ボタン/Rキーでやり直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    // ウォックを片側へ最大まで傾け続け、具材を縁からこぼし切ってゲームオーバーに追い込む
    await page.mouse.move(box.x + box.width * 0.97, box.y + box.height * 0.5);
    await page.mouse.down();

    await expect
      .poll(() => page.getByTestId("wok-toss-gameover").isVisible(), {
        message: "傾け続けると具材をこぼしてライフが尽きる",
        timeout: 25_000,
      })
      .toBe(true);
    await page.mouse.up();

    expect(await readLives(page), "ゲームオーバー時のライフは0").toBe(0);

    // ゲームオーバー中は操作してもスコアが進まない
    const scoreAtGameOver = await readScore(page);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await waitForFrames(page, 20);
    await page.mouse.up();
    expect(await readScore(page), "ゲームオーバー中は操作してもスコアが変わらない").toBe(
      scoreAtGameOver,
    );

    // ボタンでリスタート
    await page.getByTestId("wok-toss-restart").click();
    await expect(page.getByTestId("wok-toss-gameover")).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが3に戻る").toBe(3);

    // Rキーでもいつでもやり直せる
    await stage.click({ position: { x: 10, y: 10 } });
    await expect
      .poll(() => readScore(page), { message: "再開後は得点が入り得る" })
      .toBeGreaterThanOrEqual(0);
    await page.keyboard.press("r");
    await expect(page.getByTestId("wok-toss-gameover")).toBeHidden();
    expect(await readScore(page), "Rキーのリスタートでもスコアが0に戻る").toBe(0);
    expect(await readLives(page), "Rキーのリスタートでもライフが3に戻る").toBe(3);

    expect(errors, "ゲームオーバー/リスタート中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("wok-toss-lives")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付け、得点が進み続ける
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
      await page.mouse.down();
    }
    await expect
      .poll(() => readScore(page), {
        message: "リサイズ後も得点が伸びる",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    if (box) await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
