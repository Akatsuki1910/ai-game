import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/wheel-throw";

// このゲームに「権限」「キャッシュ」の概念はなく(単一セッションの純粋なローカル状態)、
// 該当する異常系は対象外。空/ゼロ件(登場物が1つもない)状態も存在しない。
// 代わりに 崩壊(エラー的な失敗) / 一時停止中の操作(中断) / 連打(再入) / リサイズ を扱う。

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("wheel-throw-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readMoisturePercent(page: Page): Promise<number> {
  const text = await page.getByTestId("wheel-throw-moisture").innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `水分表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Wheel Throw のストーリー", () => {
  test("起動直後はラウンド1・水分満タン・スコア0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("wheel-throw-round")).toBeVisible();
    await expect(page.getByTestId("wheel-throw-moisture")).toBeVisible();
    await expect(page.getByTestId("wheel-throw-finish-button")).toBeVisible();
    await expect(page.getByTestId("wheel-throw-result")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    // 読み取るまでの間にも水分は減り続けるため、ぴったり100ではなくほぼ満タンであることを見る
    expect(await readMoisturePercent(page), "開始時は水分がほぼ満タン").toBeGreaterThanOrEqual(90);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("何もしなくても水分は時間経過で減っていく", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const before = await readMoisturePercent(page);
    await expect
      .poll(() => readMoisturePercent(page), { message: "無操作でも水分が減る", timeout: 5000 })
      .toBeLessThan(before);

    expect(errors, "無操作中にエラーが出ていない").toEqual([]);
  });

  test("ドラッグで壁を整えて「仕上げる」を押すと得点が加わり、次のラウンドへ自動的に進む", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      // ふち寄り(上の方)から胴(中央寄り)へ、適度な太さでなぞって形を変える
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 8 });
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 8 });
      await page.mouse.up();
    }
    await waitForFrames(page, 10);

    const scoreBefore = await readScore(page);
    await page.getByTestId("wheel-throw-finish-button").click();

    await expect(page.getByTestId("wheel-throw-result"), "結果表示が出る").toBeVisible();
    await expect(
      page.getByTestId("wheel-throw-finish-button"),
      "結果表示中は仕上げボタンが隠れる",
    ).toBeHidden();

    await expect
      .poll(() => readScore(page), { message: "仕上げた分だけスコアが増える" })
      .toBeGreaterThan(scoreBefore);

    await expect
      .poll(() => readRound(page), { message: "少し間を置いて次のラウンドへ進む", timeout: 4000 })
      .toBe(2);
    await expect(page.getByTestId("wheel-throw-result")).toBeHidden();
    await expect(page.getByTestId("wheel-throw-finish-button")).toBeVisible();
    expect(
      await readMoisturePercent(page),
      "次のラウンドは水分がほぼ満タンに戻る",
    ).toBeGreaterThanOrEqual(90);

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });

  test("中心近くまで壁を薄くし続けると崩壊し、スコアは増えずに次のラウンドへ進む", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const scoreBefore = await readScore(page);

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      // 中心(半径ほぼ0)を狙って押し込み続け、確実に崩壊させる
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await expect
        .poll(() => page.getByTestId("wheel-throw-result").isVisible(), {
          message: "壁を薄くし続けると崩壊して結果が表示される",
          timeout: 3000,
        })
        .toBe(true);
      await page.mouse.up();
    }

    await expect(page.getByTestId("wheel-throw-result")).toContainText("崩れ");
    expect(await readScore(page), "崩壊してもスコアは増えない").toBe(scoreBefore);

    await expect
      .poll(() => readRound(page), { message: "崩壊後も次のラウンドへ自動的に進む", timeout: 4000 })
      .toBe(2);
    await expect(page.getByTestId("wheel-throw-finish-button")).toBeVisible();

    expect(errors, "崩壊の操作でエラーが出ていない").toEqual([]);
  });

  test("キーボードでも壁を整えられ、連打・端への操作でも壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "s", "a", "d"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 4);
      await page.keyboard.up(key);
    }

    // 端(最上段)まで振り切っても壊れないことを確認する
    await page.keyboard.down("ArrowUp");
    await waitForFrames(page, 60);
    await page.keyboard.up("ArrowUp");

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Enter");
    }

    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();
    expect(errors, "キーボード操作・連打でエラーが出ていない").toEqual([]);
  });

  test("一時停止中は水分もスコアも変化せず、再開すると再び進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const moistureWhilePaused = await readMoisturePercent(page);
    const scoreWhilePaused = await readScore(page);

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 20);
      await page.mouse.up();
    }

    expect(await readMoisturePercent(page), "一時停止中は水分が変化しない").toBe(
      moistureWhilePaused,
    );
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(scoreWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await expect
      .poll(() => readMoisturePercent(page), { message: "再開すると水分が再び減り始める" })
      .toBeLessThan(moistureWhilePaused);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("Rキーでセッション全体(ラウンド・スコア・水分)がリセットされる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("wheel-throw-finish-button").click();
    await expect
      .poll(() => readRound(page), { message: "1ラウンド終えて2ラウンド目に入る", timeout: 4000 })
      .toBe(2);
    expect(await readScore(page), "スコアが加算されている").toBeGreaterThan(0);

    await page.keyboard.press("r");

    await expect.poll(() => readRound(page), { message: "Rキーでラウンド1に戻る" }).toBe(1);
    expect(await readScore(page), "Rキーでスコアが0に戻る").toBe(0);
    expect(await readMoisturePercent(page), "Rキーで水分がほぼ満タンに戻る").toBeGreaterThanOrEqual(
      90,
    );
    await expect(page.getByTestId("wheel-throw-result")).toBeHidden();

    expect(errors, "リセット操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("wheel-throw-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const scoreBefore = await readScore(page);
    await page.getByTestId("wheel-throw-finish-button").click();
    await expect
      .poll(() => readScore(page), { message: "リサイズ後も仕上げるとスコアが増える" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
