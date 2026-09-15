import { expect, type Page, test } from "@playwright/test";
import {
  DEPTH_MAX,
  DEPTH_MIN,
  LIGHT_X_RATIO,
  LIGHT_Y_RATIO,
  SCALE_MAX,
  SCALE_MIN,
  WALL_Y_RATIO,
} from "../src/app/games/shadow-cast/engine/world";
import { collectPageErrors, expectStageToAnimate, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/shadow-cast";

interface Ratio {
  x: number;
  y: number;
}

/**
 * 現在のお題にぴったり重なる人形位置(比率座標)を読む。
 * ステージ比率(0〜1)で保持されているデータ属性を読み、実際のマウス座標に変換して使う。
 */
async function readTargetRatio(page: Page): Promise<Ratio> {
  return page.evaluate(() => {
    const markerEl = document.querySelector<HTMLElement>('[data-testid="shadow-cast-target"]');
    return {
      x: Number(markerEl?.dataset.xRatio ?? Number.NaN),
      y: Number(markerEl?.dataset.yRatio ?? Number.NaN),
    };
  });
}

async function readTargetScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const markerEl = document.querySelector<HTMLElement>('[data-testid="shadow-cast-target"]');
    return Number(markerEl?.dataset.scale ?? Number.NaN);
  });
}

/**
 * お題の拡大率(scale)から、必ず一致判定を外すポインタ位置(比率座標)を逆算する。
 * 一致条件は shadowXRatio と scale の両方が許容誤差内である必要があるため、
 * scale だけを許容誤差の何倍も離しておけば x 側の位置によらず必ず外れる。
 */
function pointerRatioFarFromScale(targetScale: number): Ratio {
  const midScale = (SCALE_MIN + SCALE_MAX) / 2;
  const farDepthRatio = targetScale < midScale ? DEPTH_MAX : DEPTH_MIN;
  return {
    x: LIGHT_X_RATIO,
    y: LIGHT_Y_RATIO + farDepthRatio * (WALL_Y_RATIO - LIGHT_Y_RATIO),
  };
}

async function readHoldPercent(page: Page): Promise<number> {
  const fill = page.getByTestId("shadow-cast-hold").locator("div");
  const style = await fill.getAttribute("style");
  const matched = style?.match(/width:\s*(\d+)%/);
  expect(matched, `保持ゲージの幅から数値を読み取れる: "${style}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("shadow-cast-combo").innerText();
  const matched = text.match(/重ねた影 (\d+)回/);
  expect(matched, `コンボ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 実際の画面操作(ドラッグ)で、常に更新されるお題の位置を一定時間追いかけ続ける。
 * 内部関数を直接呼ばず、本物のポインタ操作だけで人形を重ねさせる。
 */
async function holdOnTargetByMouse(page: Page, box: StageBox, frames: number): Promise<void> {
  const ratio = await readTargetRatio(page);
  await page.mouse.move(box.x + box.width * ratio.x, box.y + box.height * ratio.y);
  await page.mouse.down();
  for (let i = 0; i < frames; i++) {
    const current = await readTargetRatio(page);
    await page.mouse.move(box.x + box.width * current.x, box.y + box.height * current.y);
    await waitForFrames(page, 2);
  }
}

test.describe("Shadow Cast のストーリー", () => {
  test("起動直後はHUDが揃い、操作しなくても画面は生きている", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("shadow-cast-combo")).toHaveText("重ねた影 0回");
    // 人形の初期位置がたまたまお題に近いこともあるため、保持ゲージは範囲のみ確認する。
    const initialHoldPercent = await readHoldPercent(page);
    expect(initialHoldPercent).toBeGreaterThanOrEqual(0);
    expect(initialHoldPercent).toBeLessThanOrEqual(100);
    await expect(page.getByTestId("shadow-cast-gameover")).toBeHidden();

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    // 無操作でもランタンの炎が揺らめいており、静止画のままにならない
    await expectStageToAnimate(page, stage);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("お題に人形を重ね続けると保持ゲージが進み、やがてコンボと得点が入る", async ({ page }) => {
    // お題を追いかけるドラッグは何十フレームも追従を繰り返すため、実時間で動く
    // WebGL描画と組み合わさると既定の60秒では余裕が足りないことがある。
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    await holdOnTargetByMouse(page, box, 90);
    await page.mouse.up();

    await expect
      .poll(() => readCombo(page), { message: "お題に重ね続けるとコンボが進む", timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await readScore(page), "コンボが進むと得点が入る").toBeGreaterThan(0);

    expect(errors, "重ねている間にエラーが出ていない").toEqual([]);
  });

  test("お題から大きく外れた位置では保持ゲージが進まない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // お題の拡大率から、一致判定が絶対に成立しない奥行きへ大きくずらして保持する
      const targetScale = await readTargetScale(page);
      const farRatio = pointerRatioFarFromScale(targetScale);
      await page.mouse.move(box.x + box.width * farRatio.x, box.y + box.height * farRatio.y);
      await page.mouse.down();
      await waitForFrames(page, 40);
      await page.mouse.up();
    }

    expect(await readHoldPercent(page), "外れた位置では保持ゲージが増えない").toBe(0);
    await expect(page.getByTestId("shadow-cast-combo")).toHaveText("重ねた影 0回");

    expect(errors, "外れた位置で操作している間にエラーが出ていない").toEqual([]);
  });

  test("矢印キー/WASDでも人形を操作でき、連打しても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await stage.click({ position: { x: 10, y: 10 }, force: true });
    for (let i = 0; i < 10; i++) {
      await page.keyboard.down("ArrowLeft");
      await waitForFrames(page, 2);
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.down("ArrowUp");
      await waitForFrames(page, 2);
      await page.keyboard.up("ArrowUp");
    }
    for (let i = 0; i < 10; i++) {
      await page.keyboard.down("KeyD");
      await waitForFrames(page, 2);
      await page.keyboard.up("KeyD");
      await page.keyboard.down("KeyS");
      await waitForFrames(page, 2);
      await page.keyboard.up("KeyS");
    }

    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();
    expect(await readHoldPercent(page)).toBeGreaterThanOrEqual(0);
    expect(await readHoldPercent(page)).toBeLessThanOrEqual(100);

    expect(errors, "キーボード操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const timerWhilePaused = await page.getByTestId("shadow-cast-timer").innerText();
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(
      await page.getByTestId("shadow-cast-timer").innerText(),
      "一時停止中は残り時間が変化しない",
    ).toBe(timerWhilePaused);

    // 一時停止中にドラッグしても状態は動かない。
    // 人形の初期位置がたまたまお題に近いこともあるため、保持ゲージが0という
    // 決め打ちはせず、一時停止直後の値を基準にそこから変化しないことを確認する。
    const holdBeforeDrag = await readHoldPercent(page);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const ratio = await readTargetRatio(page);
      await page.mouse.move(box.x + box.width * ratio.x, box.y + box.height * ratio.y);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readHoldPercent(page), "一時停止中の操作でも保持ゲージは変化しない").toBe(
      holdBeforeDrag,
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

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
  });

  test("Rキーでいつでもリセットでき、画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await holdOnTargetByMouse(page, box, 40);
      await page.mouse.up();
    }

    await stage.click({ position: { x: 10, y: 10 }, force: true });
    await page.keyboard.press("r");
    await expect(page.getByTestId("shadow-cast-combo")).toHaveText("重ねた影 0回");
    // リセット後の人形位置が新しいお題とたまたま近いこともあるため、範囲のみ確認する。
    const holdAfterReset = await readHoldPercent(page);
    expect(holdAfterReset).toBeGreaterThanOrEqual(0);
    expect(holdAfterReset).toBeLessThanOrEqual(100);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const resizedBox = await stage.boundingBox();
    expect(resizedBox).not.toBeNull();
    if (resizedBox) {
      const ratio = await readTargetRatio(page);
      await page.mouse.move(
        resizedBox.x + resizedBox.width * ratio.x,
        resizedBox.y + resizedBox.height * ratio.y,
      );
      await page.mouse.down();
      await waitForFrames(page, 20);
      await page.mouse.up();
    }
    const holdAfterResize = await readHoldPercent(page);
    expect(holdAfterResize).toBeGreaterThanOrEqual(0);
    expect(holdAfterResize).toBeLessThanOrEqual(100);

    expect(errors, "リセット・リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("持ち時間が尽きるとゲームオーバーになり、もう一度あそぶで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 何もせず放置しても持ち時間が0になればゲームオーバーになる
    await expect
      .poll(() => page.getByTestId("shadow-cast-timer").innerText(), {
        message: "何もしなければ持ち時間が尽きる",
        timeout: 100_000,
      })
      .toBe("残り 0秒");
    await expect(
      page.getByTestId("shadow-cast-gameover"),
      "持ち時間切れで終了画面が出る",
    ).toBeVisible();

    const scoreAtOver = await readScore(page);
    await waitForFrames(page, 30);
    expect(await readScore(page), "終了後はスコアが変化しない").toBe(scoreAtOver);

    await page.getByTestId("shadow-cast-restart").click();
    await expect(page.getByTestId("shadow-cast-gameover")).toBeHidden();
    await expect(page.getByTestId("shadow-cast-combo")).toHaveText("重ねた影 0回");
    expect(await readScore(page), "やり直すとスコアが0に戻る").toBe(0);

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });
});
