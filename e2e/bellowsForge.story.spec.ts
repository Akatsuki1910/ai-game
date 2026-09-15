import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/bellows-forge";
const EXPECTED_START_QUALITY = 3;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("bellows-forge-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `作目の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readQuality(page: Page): Promise<number> {
  const text = await page.getByTestId("bellows-forge-quality").innerText();
  return [...text].filter((char) => char === "♥").length;
}

interface TemperatureState {
  temperature: number;
  targetMin: number;
  targetMax: number;
}

/**
 * HUDの温度計表示(「温度 62° (目標 58〜92°)」)を読み取る。
 * 目標帯の位置・幅は毎回ランダムに決まるが、画面上の温度計にそのまま数値で
 * 表示されているので、ユーザーと同じ情報からテストも狙いを定められる。
 */
async function readTemperatureState(page: Page): Promise<TemperatureState> {
  const text = await page.getByTestId("bellows-forge-temperature").innerText();
  const numbers = [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  expect(numbers.length, `温度計の表示から3つの数値を読み取れる: "${text}"`).toBeGreaterThanOrEqual(
    3,
  );
  return { temperature: numbers[0], targetMin: numbers[1], targetMax: numbers[2] };
}

/** ステージ左半分を holdMs だけ長押しして送風する。 */
async function pumpBellows(page: Page, stage: Locator, holdMs: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.78);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await waitForFrames(page, 4);
}

/** ステージ左半分の送風開始位置にポインタを置き、送風を開始する(離すのは呼び出し側)。 */
async function startPumpingBellows(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.78);
  await page.mouse.down();
}

/** ステージ右半分をタップして打つ。 */
async function strikeAnvil(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * 0.76, box.y + box.height * 0.78);
  await waitForFrames(page, 4);
}

/** 温度計を見ながら送風を続け、温度が targetTemperature 以上になったら送風をやめる。 */
async function pumpUntilTemperatureAtLeast(
  page: Page,
  stage: Locator,
  targetTemperature: number,
): Promise<void> {
  await startPumpingBellows(page, stage);
  await expect
    .poll(async () => (await readTemperatureState(page)).temperature, {
      message: "送風を続ければ温度が目標値まで上がる",
      timeout: 20_000,
      intervals: [20],
    })
    .toBeGreaterThanOrEqual(targetTemperature);
  await page.mouse.up();
  await waitForFrames(page, 4);
}

/** 温度計を見ながら待ち、自然冷却で温度が targetTemperature 以下になるのを確認する。 */
async function waitUntilTemperatureAtMost(page: Page, targetTemperature: number): Promise<void> {
  await expect
    .poll(async () => (await readTemperatureState(page)).temperature, {
      message: "送風をやめれば自然冷却で温度が目標値まで下がる",
      timeout: 20_000,
      intervals: [30],
    })
    .toBeLessThanOrEqual(targetTemperature);
}

// TEMPERATURE_MAX(100) に到達するには常温からでも 100/(46-10) ≈ 2.8秒あれば足りるので、
// この長さ送風し続ければ焦げつき(scorch)が確実に1回は起きる。
const OVERHEAT_PUMP_HOLD_MS = 3_000;
// 温度計に表示される目標帯ぎりぎりを狙わず、確実に帯の内側に収めるための余白。
const BAND_MARGIN = 2;

test.describe("Bellows Forge のストーリー", () => {
  test("起動直後は1作目・満タンの品質でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("bellows-forge-round")).toBeVisible();
    await expect(page.getByTestId("bellows-forge-progress")).toBeVisible();
    await expect(page.getByTestId("bellows-forge-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時は1作目").toBe(1);
    expect(await readQuality(page), "開始時は品質が満タン").toBe(EXPECTED_START_QUALITY);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("温度計を見ながら目標帯を狙って打つと成功し、繰り返すと作品が完成して次の作目へ進む", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const roundBefore = await readRound(page);

    // 温度計(HUD)が示す現在温度と目標帯を読み取り、帯より低ければ送風して、
    // 帯より高ければ自然冷却を待ってから打つ。乱数で決まる目標帯の位置によらず
    // 毎回帯の内側で打てるので、必要打数ぶん繰り返せば必ず1作目が完成する。
    for (let attempt = 0; attempt < 12 && (await readRound(page)) === roundBefore; attempt++) {
      const { temperature, targetMin, targetMax } = await readTemperatureState(page);
      if (temperature < targetMin) {
        await pumpUntilTemperatureAtLeast(page, stage, targetMin + BAND_MARGIN);
      } else if (temperature > targetMax) {
        await waitUntilTemperatureAtMost(page, targetMax - BAND_MARGIN);
      }
      await strikeAnvil(page, stage);
    }

    expect(
      await readRound(page),
      "目標帯を狙って打ち続ければ1作目が完成して次の作目へ進む",
    ).toBeGreaterThan(roundBefore);
    expect(await readScore(page), "成功打と完成ボーナスで得点が増える").toBeGreaterThan(0);
    expect(errors, "送風・打撃中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は送風・打撃しても状態が変わらず、連打しても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScreenshot = await stage.screenshot();
    await waitForFrames(page, 45);
    const stillPausedScreenshot = await stage.screenshot();
    expect(
      pausedScreenshot.equals(stillPausedScreenshot),
      "一時停止中は温度ゲージも含めて完全に止まる",
    ).toBe(true);

    const scoreWhilePaused = await readScore(page);
    const qualityWhilePaused = await readQuality(page);
    await pumpBellows(page, stage, 300);
    await strikeAnvil(page, stage);
    expect(await readScore(page), "一時停止中に操作しても得点が変わらない").toBe(scoreWhilePaused);
    expect(await readQuality(page), "一時停止中に操作しても品質が変わらない").toBe(
      qualityWhilePaused,
    );

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

    expect(errors, "一時停止・連打中にエラーが出ていない").toEqual([]);
  });

  test("送風しすぎて焦げつかせ続けると品質が尽きてゲームオーバーになり、やり直せる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("bellows-forge-gameover");

    // 長く送風し続ければ温度上限に達して必ず焦げつく(scorch)。
    // 焦げつきは品質を1減らすので、繰り返せば必ず品質が尽きる。
    for (let i = 0; i < EXPECTED_START_QUALITY && !(await gameOver.isVisible()); i++) {
      await pumpBellows(page, stage, OVERHEAT_PUMP_HOLD_MS);
    }

    await expect(gameOver, "品質が尽きるとゲームオーバー画面が出る").toBeVisible();
    expect(await readQuality(page), "ゲームオーバー時は品質が0").toBe(0);

    await page.getByTestId("bellows-forge-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readRound(page), "リスタートで1作目に戻る").toBe(1);
    expect(await readQuality(page), "リスタートで品質が満タンに戻る").toBe(EXPECTED_START_QUALITY);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("素早く連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const leftX = box.x + box.width * 0.25;
    const rightX = box.x + box.width * 0.76;
    const y = box.y + box.height * 0.78;

    for (let i = 0; i < 15; i++) {
      await page.mouse.click(i % 2 === 0 ? leftX : rightX, y);
    }
    await waitForFrames(page, 10);

    expect(await readQuality(page), "連打しても品質は0未満にならない").toBeGreaterThanOrEqual(0);
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("bellows-forge-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける(ドラッグしてもクラッシュしない)
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.6 }, { xRatio: 0.3, yRatio: 0.5 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
