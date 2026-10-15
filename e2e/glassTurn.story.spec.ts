import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/glass-turn";
const STARTING_LIVES = 3;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const value = await page.getByTestId("glass-turn-lives").getAttribute("data-lives");
  expect(value, "ライフが属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readRound(page: Page): Promise<number> {
  const value = await page.getByTestId("glass-turn-round").getAttribute("data-round");
  expect(value, "ラウンドが属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readCombo(page: Page): Promise<number> {
  const value = await page.getByTestId("glass-turn-combo").getAttribute("data-combo");
  expect(value, "コンボが属性から読み取れる").not.toBeNull();
  return Number(value);
}

interface Gauge {
  radius: number;
  targetMin: number;
  targetMax: number;
  temperature: number;
  wobble: number;
}

async function readGauge(page: Page): Promise<Gauge> {
  const gauge = page.getByTestId("glass-turn-gauge");
  const [radius, targetMin, targetMax, temperature, wobble] = await Promise.all([
    gauge.getAttribute("data-radius"),
    gauge.getAttribute("data-target-min"),
    gauge.getAttribute("data-target-max"),
    gauge.getAttribute("data-temperature"),
    gauge.getAttribute("data-wobble"),
  ]);
  return {
    radius: Number(radius),
    targetMin: Number(targetMin),
    targetMax: Number(targetMax),
    temperature: Number(temperature),
    wobble: Number(wobble),
  };
}

/** ステージ中央付近の座標(送風開始位置として使う)。 */
async function stageCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("glass-turn-stage").boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.4 };
}

/**
 * 送風しながら目標帯の下限に届くまで、左右に振って転がし続ける(歪みを抑える)。
 * 振る動作自体を条件のポーリングに乗せることで、固定sleepを使わずに
 * 「目標に届くまで転がし続ける」という時間のかかる操作を表現する。
 */
async function blowUntilInBand(page: Page, center: { x: number; y: number }): Promise<void> {
  let goingRight = true;
  await expect(async () => {
    const x = center.x + (goingRight ? 18 : -18);
    goingRight = !goingRight;
    await page.mouse.move(x, center.y);
    const gauge = await readGauge(page);
    expect(gauge.wobble, "転がしているので歪みは限界まで達していない").toBeLessThan(100);
    expect(gauge.radius).toBeGreaterThanOrEqual(gauge.targetMin);
  }).toPass({ timeout: 20000, intervals: [150] });
}

test.describe("Glass Turn のストーリー", () => {
  test("送風して転がし、目標帯の中で仕上げるとスコアが増えてラウンドが進む", async ({ page }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(STARTING_LIVES);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);

    const center = await stageCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await blowUntilInBand(page, center);
    await page.mouse.up();

    await page.getByTestId("glass-turn-finish").click();

    await expect
      .poll(() => readScore(page), { message: "目標帯で仕上げるとスコアが増える" })
      .toBeGreaterThan(0);
    expect(await readRound(page), "仕上げると次のラウンドに進む").toBe(2);
    expect(await readLives(page), "成功してもライフは減らない").toBe(STARTING_LIVES);
    expect(await readCombo(page), "目標帯で仕上げるとコンボが伸びる").toBeGreaterThan(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("転がさずに送風し続けると歪みで崩れてライフが減り、一時停止中は進行が止まる", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("glass-turn-stage").locator("canvas")).toBeVisible();

    // キーボードのEnter長押しで送風する(マウスは一時停止ボタンのクリックに使うため分ける)。
    await page.keyboard.down("Enter");

    // 一時停止すると送風していても状態が変化しないことを先に確認する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedGauge = await readGauge(page);
    await waitForFrames(page, 60);
    const stillPausedGauge = await readGauge(page);
    expect(stillPausedGauge.radius, "一時停止中は大きさが変化しない").toBe(pausedGauge.radius);
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // 再開後、転がさずに送風し続けると歪みが限界に達して崩れ、ライフが減る。
    await expect
      .poll(() => readLives(page), {
        message: "転がさずに送風し続けると歪みで崩れてライフが減る",
        timeout: 10000,
      })
      .toBe(STARTING_LIVES - 1);
    await page.keyboard.up("Enter");

    expect(await readRound(page), "失敗しても次のラウンドに進む").toBeGreaterThan(1);
    const gaugeAfterFail = await readGauge(page);
    expect(gaugeAfterFail.radius, "失敗後の新しい玉は大きさ0から始まる").toBe(0);

    expect(errors, "一時停止・崩壊中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも送風・転がし・仕上げができ、連打や画面リサイズをしても壊れない", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("glass-turn-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // キーボード: Enterを押し続けて送風し、矢印キーで転がしながら目標帯まで育てる。
    await page.keyboard.down("Enter");
    await expect(async () => {
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowRight");
      const gauge = await readGauge(page);
      expect(gauge.wobble).toBeLessThan(100);
      expect(gauge.radius).toBeGreaterThanOrEqual(gauge.targetMin);
    }).toPass({ timeout: 20000, intervals: [150] });
    await page.keyboard.up("Enter");
    await page.keyboard.press("f");

    await expect
      .poll(() => readRound(page), { message: "キーボードでも仕上げてラウンドが進む" })
      .toBeGreaterThan(1);

    // 仕上げボタンを連打しても(大きさ0=規格外の仕上げが続くだけで)壊れない。
    const roundBeforeMashing = await readRound(page);
    for (let i = 0; i < 8; i++) {
      await page.getByTestId("glass-turn-finish").click();
      await waitForFrames(page, 3);
    }
    expect(await readRound(page), "連打してもラウンドが進み続ける").toBeGreaterThan(
      roundBeforeMashing,
    );
    expect(await readLives(page), "規格外の仕上げ連打ではライフは減らない").toBe(STARTING_LIVES);

    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も仕上げ操作を受け付ける。
    const roundBeforeResize = await readRound(page);
    await page.getByTestId("glass-turn-finish").click();
    await expect
      .poll(() => readRound(page), { message: "リサイズ後も仕上げられる" })
      .toBeGreaterThan(roundBeforeResize);

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
