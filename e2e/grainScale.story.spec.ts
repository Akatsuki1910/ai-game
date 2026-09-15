import { expect, type Locator, type Page, test } from "@playwright/test";
import { TARGET_TOLERANCE } from "../src/app/games/grain-scale/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/grain-scale";

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("grain-scale-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("grain-scale-combo").innerText();
  const matched = text.match(/(\d+)/);
  return Number(matched?.[1] ?? Number.NaN);
}

interface ScaleState {
  left: number;
  right: number;
  target: number;
  combo: number;
}

/** HUD の表示（左右の重さ・目標値・コンボ）を1回のブラウザ往復でまとめて読む。 */
async function readScaleState(page: Page): Promise<ScaleState> {
  return page.evaluate(() => {
    const readNumber = (testId: string): number => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      const matched = el?.textContent?.match(/(\d+)/);
      return matched ? Number(matched[1]) : Number.NaN;
    };
    return {
      left: readNumber("grain-scale-left-weight"),
      right: readNumber("grain-scale-right-weight"),
      target: readNumber("grain-scale-target-weight"),
      combo: readNumber("grain-scale-combo"),
    };
  });
}

/** 壺を目標の x 比率へドラッグで動かす（ステージ上端付近から始めてもどこでも壺は追従する）。 */
async function moveSpoutTo(page: Page, stage: Locator, xRatio: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const y = box.y + box.height * 0.1;
  await page.mouse.move(box.x + box.width * xRatio, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * xRatio, y, { steps: 2 });
  await page.mouse.up();
}

test.describe("Grain Scale のストーリー", () => {
  test("遊び始めてから一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);

    // ラウンドが実際に進む
    await expect
      .poll(() => readTimerSeconds(page), { message: "残り時間が減っていく" })
      .toBeLessThan(startedAt);

    // 壺を動かして砂を注ぐ（このゲームの中心操作）
    const stage = page.getByTestId("game-shell-stage");
    await moveSpoutTo(page, stage, 0.25);
    await waitForFrames(page, 30);
    await moveSpoutTo(page, stage, 0.75);
    await waitForFrames(page, 30);

    // 一時停止するとオーバーレイが出て、時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中に操作しても壊れない
    await moveSpoutTo(page, stage, 0.4);
    expect(await readTimerSeconds(page), "一時停止中の操作で時間が動かない").toBe(pausedAt);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("両皿を目標の重さへ釣り合わせ続けるとラウンドが成功しコンボが進む", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;
    const y = box.y + box.height * 0.1;
    const xAt = (ratio: number) => box.x + box.width * ratio;

    // ポインタは押したまま動かし続ける（実際のドラッグ操作と同じ経路）。
    // 毎回ボタンを押し直すと1手あたりの操作間隔が伸び、その間も砂が注がれ続けて
    // 目標の帯を飛び越えてしまうため、移動だけを都度行って反応を速くする。
    await page.mouse.move(xAt(0.22), y);
    await page.mouse.down();

    // 画面に表示されている両皿の重さと目標値（ユーザーが見ているのと同じ情報）を見ながら、
    // 軽い方へ壺を動かして注ぎ、両方が目標範囲に入ったら壺を隙間へ逃がして注ぎを止め、
    // 釣り合った状態を維持する。目標の重さは毎ラウンドでランダムなので、成功するまで続ける。
    let state = await readScaleState(page);
    for (let i = 0; i < 300 && state.combo === 0; i++) {
      const isLeftInRange = Math.abs(state.left - state.target) <= TARGET_TOLERANCE;
      const isRightInRange = Math.abs(state.right - state.target) <= TARGET_TOLERANCE;
      const ratio = isLeftInRange && isRightInRange ? 0.5 : state.left <= state.right ? 0.22 : 0.78;

      await page.mouse.move(xAt(ratio), y);
      await waitForFrames(page, 3);
      state = await readScaleState(page);
    }
    await page.mouse.up();

    expect(state.combo, "釣り合わせ続けるとコンボが進む").toBeGreaterThan(0);

    expect(errors, "注ぎ操作中にエラーが出ていない").toEqual([]);
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

  test("キーボードでも壺を操作でき、Rキーでリセットできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await stage.click({ position: { x: 10, y: 10 } });
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 20);
    await page.keyboard.up("ArrowRight");

    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "矢印キー操作後もキャンバスが生きている").toBeVisible();

    const beforeReset = await readTimerSeconds(page);
    await page.keyboard.press("r");
    await waitForFrames(page, 5);
    const afterReset = await readTimerSeconds(page);
    expect(afterReset, "Rキーでラウンドがリセットされる").toBeGreaterThanOrEqual(beforeReset);
    expect(await readCombo(page), "リセットでコンボも0に戻る").toBe(0);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
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
    await moveSpoutTo(page, stage, 0.3);
    await expect
      .poll(() => readTimerSeconds(page), { message: "リサイズ後もラウンドが進む" })
      .toBeLessThan(75);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
