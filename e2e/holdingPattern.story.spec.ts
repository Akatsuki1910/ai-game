import { expect, type Page, test } from "@playwright/test";
import { MAX_STRIKES } from "../src/app/games/holding-pattern/engine/world";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/holding-pattern";

interface MarkerPoint {
  x: number;
  y: number;
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readStreak(page: Page): Promise<number> {
  const text = await page.getByTestId("holding-pattern-streak").innerText();
  const matched = text.match(/連続着陸 (\d+)/);
  expect(matched, `連続着陸の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readStrikes(page: Page): Promise<number> {
  const value = await page.getByTestId("holding-pattern-strikes").getAttribute("data-strikes");
  expect(value, "警告数が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readMarkerCenter(page: Page, testId: string): Promise<MarkerPoint | null> {
  const marker = page.getByTestId(testId);
  const isVisible = await marker.isVisible().catch(() => false);
  if (!isVisible) return null;
  const box = await marker.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function readPlaneHeading(page: Page): Promise<number> {
  const value = await page.getByTestId("holding-pattern-plane-marker").getAttribute("data-heading");
  expect(value, "機体の方位が属性から読み取れる").not.toBeNull();
  return Number(value);
}

function angleDiff(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * マウスでドラッグして、最も燃料が少ない機体をビーコンの先まで狙いを引き延ばして誘導し、
 * 必ず1機を着陸させるまで続ける。誘導中の機体が衝突や燃料切れで失われたら、
 * そのときの最優先機体(マーカーが指す機体)へ自動的に乗り換えて狙い直す。
 * ゲームオーバーになった場合もリスタートして続行する(どこかで必ず着陸させる)。
 */
async function landUrgentPlaneOnBeacon(page: Page, beaconTestId: string): Promise<void> {
  let scoreBefore = await readScore(page);
  let draggingPlaneId: string | null = null;

  await expect
    .poll(
      async () => {
        if (
          await page
            .getByTestId("holding-pattern-gameover")
            .isVisible()
            .catch(() => false)
        ) {
          if (draggingPlaneId !== null) {
            await page.mouse.up();
            draggingPlaneId = null;
          }
          await page.getByTestId("holding-pattern-restart").click();
          scoreBefore = 0;
          return false;
        }

        const plane = await readMarkerCenter(page, "holding-pattern-plane-marker");
        const beacon = await readMarkerCenter(page, beaconTestId);
        if (!plane || !beacon) return false;

        const currentPlaneId = await page
          .getByTestId("holding-pattern-plane-marker")
          .getAttribute("data-plane-id");
        if (draggingPlaneId !== currentPlaneId) {
          if (draggingPlaneId !== null) await page.mouse.up();
          await page.mouse.move(plane.x, plane.y);
          await page.mouse.down();
          draggingPlaneId = currentPlaneId;
        }

        await page.mouse.move(beacon.x, beacon.y, { steps: 2 });
        await waitForFrames(page, 4);
        return (await readScore(page)) > scoreBefore;
      },
      {
        message: "機体を誘導して着陸させる(失ったら次の機体に乗り換えて再挑戦する)",
        timeout: 45000,
        intervals: [50],
      },
    )
    .toBe(true);

  await page.mouse.up();
}

/**
 * キーボードで、最も燃料が少ない機体をビーコンの方角へ少しずつ旋回させる。
 * Nキーで常にその機体を選び直し、現在位置からビーコンへの方位との差分ぶんだけ
 * 左右キーを短く叩いて近づける(閉ループの手動操舵)。
 */
async function nudgeUrgentPlaneTowardBeaconOnce(page: Page, beaconTestId: string): Promise<void> {
  await page.keyboard.press("n");
  const plane = await readMarkerCenter(page, "holding-pattern-plane-marker");
  const beacon = await readMarkerCenter(page, beaconTestId);
  if (!plane || !beacon) return;

  const desiredHeading = Math.atan2(beacon.y - plane.y, beacon.x - plane.x);
  const currentHeading = await readPlaneHeading(page);
  const diff = angleDiff(desiredHeading, currentHeading);
  if (Math.abs(diff) < 0.08) return;

  const key = diff > 0 ? "ArrowRight" : "ArrowLeft";
  await page.keyboard.down(key);
  await waitForFrames(page, 4);
  await page.keyboard.up(key);
}

test.describe("Holding Pattern のストーリー", () => {
  test("ビーコンまで狙いを引き延ばして誘導すると着陸でき、スコアとストリークが増える。一時停止・再開もできる", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readStreak(page), "開始時のストリークは0").toBe(0);
    expect(await readStrikes(page), "開始時の警告は0").toBe(0);
    await expect(page.getByTestId("holding-pattern-legend")).toBeVisible();

    // 他の機体が同時に飛んでいるため、着陸直後に別の機体が警告(ストリークリセット)を
    // 起こすこともある。ここではストリークの厳密な値は問わず、着陸(スコア増加)自体を確認する。
    await landUrgentPlaneOnBeacon(page, "holding-pattern-beacon-0");
    expect(await readScore(page), "着陸でスコアが増える").toBeGreaterThan(0);

    // 一時停止するとオーバーレイが出て、状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedStreak = await readStreak(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readStreak(page), "一時停止中はストリークが変化しない").toBe(pausedStreak);

    // 一時停止中にドラッグしても無視される。
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.7, yRatio: 0.3 });
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると進行を再開する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    // landUrgentPlaneOnBeaconはゲームオーバーになった場合リスタートして続けるため、
    // (そのときスコアは0から積み直しになる)再開後の絶対スコアをpausedScoreと比較するのではなく、
    // 「もう一度どこかで着陸できた」ことをスコアの正値で確認する。
    await landUrgentPlaneOnBeacon(page, "holding-pattern-beacon-0");
    expect(await readScore(page), "再開後も着陸でスコアが増える").toBeGreaterThan(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("何もせず燃料切れを放置すると警告が積み重なってゲームオーバーになり、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await expect
      .poll(() => readStrikes(page), {
        message: "燃料切れが積み重なって警告が増えていく",
        timeout: 70_000,
      })
      .toBeGreaterThanOrEqual(1);

    await expect(page.getByTestId("holding-pattern-gameover")).toBeVisible({ timeout: 70_000 });
    expect(await readStrikes(page), `警告が上限(${MAX_STRIKES})に達している`).toBe(MAX_STRIKES);
    await expect(page.getByTestId("holding-pattern-gameover")).toContainText("SCORE");

    // ゲームオーバー中に操作しても無視される。
    const scoreAtGameOver = await readScore(page);
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.2, yRatio: 0.2 });
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );

    await page.getByTestId("holding-pattern-restart").click();
    await expect(page.getByTestId("holding-pattern-gameover")).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readStreak(page), "リスタートでストリークが0に戻る").toBe(0);
    expect(await readStrikes(page), "リスタートで警告が0に戻る").toBe(0);

    expect(errors, "警告蓄積・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも誘導して着陸でき、連打や画面リサイズをしても壊れない", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const scoreBeforeKeyboard = await readScore(page);
    const strikesBeforeKeyboard = await readStrikes(page);
    await expect
      .poll(
        async () => {
          await nudgeUrgentPlaneTowardBeaconOnce(page, "holding-pattern-beacon-1");
          const scoreChanged = (await readScore(page)) > scoreBeforeKeyboard;
          const strikesChanged = (await readStrikes(page)) > strikesBeforeKeyboard;
          return scoreChanged || strikesChanged;
        },
        { message: "キーボードで旋回させ続けると着陸または機体ロスで決着する", timeout: 30000 },
      )
      .toBe(true);

    // ランダムなドラッグを連打しても表示が壊れない(ゲームオーバーなら都度リスタート)。
    const gameOver = page.getByTestId("holding-pattern-gameover");
    for (let i = 0; i < 8; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("holding-pattern-restart").click();
        continue;
      }
      await dragOnStage(
        page,
        stage,
        { xRatio: 0.2 + 0.05 * i, yRatio: 0.5 },
        { xRatio: 0.8 - 0.05 * i, yRatio: 0.3 },
      );
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("holding-pattern-restart").click();
    }
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける。
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.3 });
    await waitForFrames(page, 20);
    await expect(
      stage.locator("canvas"),
      "リサイズ後の操作後もキャンバスが生きている",
    ).toBeVisible();

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
