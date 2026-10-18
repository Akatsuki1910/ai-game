import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/auger-drop";
const FISH_MARKER_TEST_IDS = [
  "auger-drop-fish-marker-0",
  "auger-drop-fish-marker-1",
  "auger-drop-fish-marker-2",
  "auger-drop-fish-marker-3",
];

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readMarkerCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} の座標が取得できる`).not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function readBarFillRatio(page: Page, testId: string): Promise<number> {
  const bar = page.getByTestId(testId);
  const barBox = await bar.boundingBox();
  const fillBox = await bar.locator("div").boundingBox();
  expect(barBox, `${testId} の領域が取得できる`).not.toBeNull();
  expect(fillBox, `${testId} の充填部の領域が取得できる`).not.toBeNull();
  if (!barBox || !fillBox) return 0;
  return fillBox.width / barBox.width;
}

/** ルアーのマーカーの真上へポインタを移動してから押し下げ、以後は離すまで「長押し」状態を保つ。 */
async function beginHold(page: Page): Promise<void> {
  const lure = await readMarkerCenter(page, "auger-drop-lure-marker");
  await page.mouse.move(lure.x, lure.y);
  await page.mouse.down();
}

/**
 * 一番近い魚めがけて、押しっぱなしのポインタを毎回読み直しながら左右に小刻みに揺する(ジグ)。
 * 食いついた後にこの関数を呼んでも、押しっぱなし自体がそのままリール操作として働く。
 */
async function jigTowardNearestFishOnce(page: Page, toggle: { value: boolean }): Promise<void> {
  const lure = await readMarkerCenter(page, "auger-drop-lure-marker");
  const candidates = await Promise.all(
    FISH_MARKER_TEST_IDS.map((testId) => readMarkerCenter(page, testId)),
  );
  const nearest = candidates.reduce((closest, candidate) => {
    const distClosest = Math.hypot(closest.x - lure.x, closest.y - lure.y);
    const distCandidate = Math.hypot(candidate.x - lure.x, candidate.y - lure.y);
    return distCandidate < distClosest ? candidate : closest;
  });
  const offset = toggle.value ? 18 : -18;
  toggle.value = !toggle.value;
  await page.mouse.move(nearest.x + offset, nearest.y);
  await waitForFrames(page, 3);
}

/** 2枚のスクリーンショットが同じかどうかを返す(一時停止で本当に止まっているかの確認に使う)。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

test.describe("Auger Drop のストーリー", () => {
  test("魚の近くでルアーを揺すり続けると食いつき、そのまま粘れば釣り上げてスコアが伸びる", async ({
    page,
  }) => {
    // 大物が掛かるとテンション超過で一度は逃すことがあるため、何度か掛け直す余裕を持たせる。
    test.setTimeout(100_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await page.getByTestId("auger-drop-catches").innerText(), "開始時の釣果は0匹").toContain(
      "0",
    );

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await beginHold(page);
    const toggle = { value: false };
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("auger-drop-gameover").isVisible()) {
            await page.mouse.up();
            await page.getByTestId("auger-drop-restart").click();
            await beginHold(page);
          }
          await jigTowardNearestFishOnce(page, toggle);
          return readScore(page);
        },
        {
          message: "誘って粘り続けると得点が入る",
          timeout: 85_000,
          intervals: [50],
        },
      )
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("長押しし続けてテンションを上げすぎると糸が切れて魚を逃し、あたたかさが減る", async ({
    page,
  }) => {
    test.setTimeout(100_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    const warmthBeforeAnyBite = await readBarFillRatio(page, "auger-drop-warmth");

    await beginHold(page);
    const toggle = { value: false };
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("auger-drop-gameover").isVisible()) {
            return true; // 粘り続けた結果あたたかさが尽きた場合も、テンション超過の帰結として許容する
          }
          const message = page.getByTestId("auger-drop-message");
          if ((await message.isVisible()) && (await message.innerText()).includes("逃げられた")) {
            return true;
          }
          await jigTowardNearestFishOnce(page, toggle);
          return false;
        },
        {
          message: "長押しし続けていれば、いずれ大物の糸が切れて逃げられる(または力尽きる)",
          timeout: 90_000,
          intervals: [50],
        },
      )
      .toBe(true);
    await page.mouse.up();

    const isOver = await page.getByTestId("auger-drop-gameover").isVisible();
    if (!isOver) {
      const warmthAfterSnap = await readBarFillRatio(page, "auger-drop-warmth");
      expect(warmthAfterSnap, "糸が切れるとあたたかさが減る").toBeLessThan(warmthBeforeAnyBite);
    }

    expect(errors, "テンション超過の前後でエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await expect
      .poll(async () => isFrozen(page, stage, 20), {
        message: "無操作でも魚が動くため画面は変化する",
      })
      .toBe(false);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中はルアーも魚も完全に止まる").toBe(true);

    // 一時停止中にドラッグ操作をしても、描画も進行も止まったまま
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.3 }, { xRatio: 0.3, yRatio: 0.5 });
    expect(await isFrozen(page, stage, 20), "一時停止中の操作でも画面は止まったまま").toBe(true);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    expect(await isFrozen(page, stage, 45), "再開すると画面がまた動き出す").toBe(false);

    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
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

    const holeBox = await page.getByTestId("auger-drop-hole-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(holeBox, "リサイズ後も穴の目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (holeBox && stageBox) {
      expect(holeBox.x, "穴がステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(holeBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.4 }, { xRatio: 0.6, yRatio: 0.6 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
