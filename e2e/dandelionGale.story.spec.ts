import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/dandelion-gale";
const STARTING_LIVES = 3;
const FAN_OFFSET_PX = 55;

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("dandelion-gale-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLivesCount(page: Page): Promise<number> {
  const text = await page.getByTestId("dandelion-gale-lives").innerText();
  return [...text].filter((ch) => ch === "🌱").length;
}

async function readMarkerCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} の座標が取得できる`).not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * 種の反対側へポインタを置き、狙点へ向けて短く風を吹かせる(1回分のパルス)。
 * 風を掴みっぱなしにすると加速し続けて狙点を追い越し、行き過ぎては反対向きに
 * 加速し直す振動が起きて収束しないため、狙点を読み直すたびに短いパルスで少しずつ
 * 押しては離す(mouse.up)ことで、人が小刻みに操作するのに近い、収束する動きにする。
 */
async function pulseFanToward(page: Page, fanX: number, fanY: number): Promise<void> {
  await page.mouse.move(fanX, fanY);
  await page.mouse.down();
  await waitForFrames(page, 2);
  await page.mouse.up();
}

async function steerSeedTowardOnce(page: Page, aimTestId: string): Promise<void> {
  const seed = await readMarkerCenter(page, "dandelion-gale-seed-marker");
  const aim = await readMarkerCenter(page, aimTestId);
  const dx = aim.x - seed.x;
  const dy = aim.y - seed.y;
  const dist = Math.hypot(dx, dy) || 1;
  await pulseFanToward(
    page,
    seed.x - (dx / dist) * FAN_OFFSET_PX,
    seed.y - (dy / dist) * FAN_OFFSET_PX,
  );
}

/**
 * 雨粒は種より小さく速く動き続けるため、2次元で追いかけ回すと通信の往復遅延の間に
 * すり抜けてしまいやすい。雨粒はどのみち画面の上から下まで真っ直ぐ降り続けるため、
 * 横位置だけを雨粒に合わせ続ければ、あとは雨粒自身の落下(と重力)が縦位置を合わせてくれる。
 * 常に2つ同時に降っているうちの横位置がより近い方を選ぶことで、揺れの位相が悪く
 * すれ違うだけの回に当たっても、もう片方に賭け直す機会を確保する。
 */
async function alignSeedUnderRaindropOnce(page: Page): Promise<void> {
  const seed = await readMarkerCenter(page, "dandelion-gale-seed-marker");
  const raindropA = await readMarkerCenter(page, "dandelion-gale-raindrop-marker");
  const raindropB = await readMarkerCenter(page, "dandelion-gale-raindrop-marker-2");
  const raindrop =
    Math.abs(raindropA.x - seed.x) <= Math.abs(raindropB.x - seed.x) ? raindropA : raindropB;
  const dx = raindrop.x - seed.x;
  const dir = dx === 0 ? 1 : Math.sign(dx);
  await pulseFanToward(page, seed.x - dir * FAN_OFFSET_PX, seed.y);
}

/** 2枚のスクリーンショットが同じかどうかを返す(一時停止で本当に止まっているかの確認に使う)。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

test.describe("Dandelion Gale のストーリー", () => {
  test("風で花畑まで種を運び続けると得点とコンボが進む", async ({ page }) => {
    // 道中の雨粒に当たって種の位置がリセットされても諦めず進み続けるため、
    // (途中で1〜2回巻き戻る分の)余裕を持ったタイムアウトを取る。
    test.setTimeout(75_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await expect
      .poll(
        async () => {
          // 道中で雨粒に3回当たってラウンドが終わってしまっても、諦めずリスタートして進み続ける。
          if (await page.getByTestId("dandelion-gale-gameover").isVisible()) {
            await page.getByTestId("dandelion-gale-restart").click();
          }
          await steerSeedTowardOnce(page, "dandelion-gale-target-marker");
          return readCombo(page);
        },
        {
          message: "風で花畑へ種を届け続けるとコンボが進む",
          timeout: 60_000,
          intervals: [50],
        },
      )
      .toBeGreaterThan(0);

    expect(await readScore(page), "得点も増えている").toBeGreaterThan(0);
    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("雨粒に当たるとライフが減りコンボがリセットされ、尽きるとリスタートできる", async ({
    page,
  }) => {
    test.setTimeout(220_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    expect(await readLivesCount(page), "開始時のライフは3").toBe(STARTING_LIVES);

    // まず1回、雨粒に当たるとライフが減りコンボがリセットされることを確認する。
    await expect
      .poll(
        async () => {
          await alignSeedUnderRaindropOnce(page);
          return readLivesCount(page);
        },
        {
          message: "雨粒に当たるとライフが減る",
          timeout: 60_000,
          intervals: [50],
        },
      )
      .toBeLessThan(STARTING_LIVES);
    expect(await readCombo(page), "雨粒に当たるとコンボがリセットされる").toBe(0);

    // 複数の雨粒が密集して連続で当たり、1回の観測の間にライフが2つ以上減ることもあるため、
    // 「1回ごとに1ライフ減る」という前提を置かず、尽きるまで単純に押し続ける。
    await expect
      .poll(
        async () => {
          await alignSeedUnderRaindropOnce(page);
          return page.getByTestId("dandelion-gale-gameover").isVisible();
        },
        {
          message: "ライフを使い切るとラウンドが終わる",
          timeout: 90_000,
          intervals: [50],
        },
      )
      .toBe(true);
    expect(await readLivesCount(page), "ライフが0になっている").toBe(0);

    await page.getByTestId("dandelion-gale-restart").click();
    await expect(page.getByTestId("dandelion-gale-gameover")).toBeHidden();
    expect(await readLivesCount(page), "リスタートでライフが回復する").toBe(STARTING_LIVES);
    expect(await readCombo(page), "リスタートでコンボが0に戻る").toBe(0);

    expect(errors, "雨粒に当たってもエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await expect
      .poll(async () => isFrozen(page, stage, 20), {
        message: "無操作でも重力で画面は動く",
      })
      .toBe(false);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中は種も雨粒も完全に止まる").toBe(true);

    // 一時停止中にドラッグ操作をしても、描画も進行も止まったまま
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.4 });
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

    const markerBox = await page.getByTestId("dandelion-gale-target-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(markerBox, "リサイズ後も花畑の目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (markerBox && stageBox) {
      expect(markerBox.x, "花畑がステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(markerBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.55, yRatio: 0.45 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
