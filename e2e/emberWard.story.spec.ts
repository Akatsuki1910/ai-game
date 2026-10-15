import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/ember-ward";

async function readHp(page: Page): Promise<number> {
  const text = await page.getByTestId("ember-ward-hp").innerText();
  const matched = text.match(/(\d+)\s*\/\s*(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("ember-ward-combo").innerText();
  const matched = text.match(/x(\d+)/i);
  expect(matched, `コンボ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** ステージの横幅いっぱいに水平な結界を1本描く。降ってくる火の粉を確実に拾うため何度か描き直す。 */
async function sweepWardAcrossStage(page: Page, ratio: { xStart: number; xEnd: number; y: number }) {
  const stage = page.getByTestId("ember-ward-stage");
  await dragOnStage(
    page,
    stage,
    { xRatio: ratio.xStart, yRatio: ratio.y },
    { xRatio: ratio.xEnd, yRatio: ratio.y },
  );
}

test.describe("Ember Ward のストーリー", () => {
  test("遊び始めてから結界で火の粉を弾き、一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: 社のライフが満タン、スコア0、コンボ0で始まる
    await expect(page.getByTestId("ember-ward-hp")).toBeVisible();
    expect(await readHp(page), "開始時は社のライフが満タン").toBeGreaterThan(0);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);

    // 結界の中心操作: ドラッグで線を描き続けて火の粉を弾く
    const stage = page.getByTestId("ember-ward-stage");
    let scored = false;
    for (let i = 0; i < 20 && !scored; i++) {
      await sweepWardAcrossStage(page, { xStart: 0.15, xEnd: 0.85, y: 0.55 });
      await waitForFrames(page, 30);
      if ((await readScore(page)) > 0) scored = true;
    }
    expect(scored, "結界で火の粉を弾いてスコアが入る").toBe(true);

    // 一時停止するとオーバーレイが出て、ライフが減らなくなる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedHp = await readHp(page);
    await waitForFrames(page, 60);
    expect(await readHp(page), "一時停止中はライフが減らない").toBe(pausedHp);

    // 再開すると引き続き遊べる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "再開後もキャンバスが生きている").toBeVisible();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("結界を描かずに放置すると社のライフが減り続け、やがてゲームオーバーになる", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const startHp = await readHp(page);

    await expect
      .poll(() => readHp(page), {
        message: "何も操作しなければ火の粉が社に届いてライフが減る",
        timeout: 30_000,
      })
      .toBeLessThan(startHp);

    await expect
      .poll(() => page.getByTestId("ember-ward-gameover").isVisible(), {
        message: "ライフが尽きるとゲームオーバー画面が出る",
        timeout: 45_000,
      })
      .toBe(true);

    expect(await readHp(page), "ゲームオーバー時はライフ0").toBe(0);

    // ゲームオーバー中に連打しても壊れない
    const restartButton = page.getByTestId("ember-ward-restart");
    await restartButton.click();
    await expect(page.getByTestId("ember-ward-gameover")).toBeHidden();
    expect(await readHp(page), "リスタートでライフが回復する").toBeGreaterThan(0);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバー〜リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも結界を設置でき、一時停止ボタンの連打にも耐える", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("ember-ward-stage");
    await stage.click({ position: { x: 10, y: 10 } });

    // 矢印キーでカーソルを動かし、Enterで結界を設置する
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await waitForFrames(page, 10);
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await waitForFrames(page, 30);
    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();

    // 一時停止ボタンの連打
    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedHp = await readHp(page);
    await waitForFrames(page, 60);
    expect(await readHp(page), "連打後の一時停止も効いている").toBe(pausedHp);

    expect(errors, "キーボード操作・連打中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("ember-ward-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も結界を描く操作を受け付ける
    await sweepWardAcrossStage(page, { xStart: 0.2, xEnd: 0.8, y: 0.5 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "リサイズ後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
