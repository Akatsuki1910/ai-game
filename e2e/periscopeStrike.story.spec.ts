import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/periscope-strike";

interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getStageBox(page: Page): Promise<StageBox> {
  const canvasHost = page.getByTestId("periscope-strike-canvas");
  await expect(canvasHost.locator("canvas")).toBeVisible();
  const box = await canvasHost.boundingBox();
  expect(box, "キャンバス領域が取得できる").not.toBeNull();
  if (!box) throw new Error("canvas box not found");
  return box;
}

/** ペリスコープを上げて少し左右に動かし、離して魚雷を1本発射する。 */
async function aimAndFire(page: Page, xRatio: number): Promise<void> {
  const box = await getStageBox(page);
  const startX = box.x + box.width * xRatio;
  const y = box.y + box.height * 0.5;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 10, y, { steps: 3 });
  await page.mouse.up();
}

/** ペリスコープを上げたまま保持する。呼び出し側で up() すること。 */
async function holdPeriscope(page: Page, xRatio: number): Promise<void> {
  const box = await getStageBox(page);
  const x = box.x + box.width * xRatio;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
}

async function readDetectionRatio(page: Page): Promise<number> {
  const track = page.getByTestId("periscope-strike-detection");
  const box = await track.boundingBox();
  const fillBox = await track.locator("div").boundingBox();
  expect(box && fillBox, "発見度ゲージのサイズが取得できる").not.toBeNull();
  if (!box || !fillBox) return 0;
  return fillBox.width / box.width;
}

async function readLivesCount(page: Page): Promise<number> {
  const text = await page.getByTestId("periscope-strike-lives").innerText();
  return (text.match(/♥/g) ?? []).length;
}

test.describe("Periscope Strike のストーリー", () => {
  test("ペリスコープを構えると発見度が増え、離すと戻る。一時停止も効く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("periscope-strike-lives")).toHaveText("♥♥♥");
    await expect(page.getByTestId("periscope-strike-combo")).toHaveText("COMBO 0");

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await holdPeriscope(page, 0.5);
    await waitForFrames(page, 20);
    await expect
      .poll(() => readDetectionRatio(page), { message: "構えている間は発見度が増える" })
      .toBeGreaterThan(0.1);
    await page.mouse.up();

    await expect
      .poll(() => readDetectionRatio(page), { message: "離すと発見度が下がっていく" })
      .toBeLessThan(0.1);

    // 一時停止すると状態が固定される
    const livesBeforePause = await readLivesCount(page);
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    await holdPeriscope(page, 0.5);
    await waitForFrames(page, 60);
    await page.mouse.up();
    expect(await readLivesCount(page), "一時停止中はライフ(発見度の蓄積)が変化しない").toBe(
      livesBeforePause,
    );

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("構えっぱなしにすると発見されてライフが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const livesBefore = await readLivesCount(page);
    await holdPeriscope(page, 0.5);

    await expect(page.getByTestId("periscope-strike-spotted"), {
      message: "構え続けると発見バナーが出る",
    }).toBeVisible({ timeout: 10_000 });

    await page.mouse.up();
    expect(await readLivesCount(page), "発見されるとライフが減る").toBeLessThan(livesBefore);

    expect(errors, "発見される操作でエラーが出ていない").toEqual([]);
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

    // 発射操作を連打しても壊れない
    for (let i = 0; i < 8; i++) await aimAndFire(page, 0.4 + i * 0.02);
    await waitForFrames(page, 20);
    await expect(page.getByTestId("periscope-strike-canvas").locator("canvas")).toBeVisible();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
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
    await aimAndFire(page, 0.5);
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "リサイズ後も操作できる").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
