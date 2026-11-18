import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/silhouette-seven";

/**
 * エンジン(engine/board.ts)の決定的なレイアウトに合わせた、形状ごとの
 * 枠(slot)とトレイ(tray)の相対座標。ラウンド1は全枠が正立(0度)なので
 * 回転なしでドラッグだけで合わせられる。
 */
const TRIANGLE_SLOT = { xRatio: 0.5, yRatio: 0.22 };
const TRIANGLE_TRAY = { xRatio: 0.08, yRatio: 0.18 };

const ROUND1_DRAGS: ReadonlyArray<{
  tray: { xRatio: number; yRatio: number };
  slot: { xRatio: number; yRatio: number };
}> = [
  { tray: TRIANGLE_TRAY, slot: TRIANGLE_SLOT },
  { tray: { xRatio: 0.26, yRatio: 0.14 }, slot: { xRatio: 0.7, yRatio: 0.18 } },
  { tray: { xRatio: 0.08, yRatio: 0.4 }, slot: { xRatio: 0.9, yRatio: 0.3 } },
  { tray: { xRatio: 0.28, yRatio: 0.42 }, slot: { xRatio: 0.5, yRatio: 0.54 } },
  { tray: { xRatio: 0.08, yRatio: 0.64 }, slot: { xRatio: 0.74, yRatio: 0.54 } },
  { tray: { xRatio: 0.26, yRatio: 0.68 }, slot: { xRatio: 0.58, yRatio: 0.84 } },
  { tray: { xRatio: 0.14, yRatio: 0.88 }, slot: { xRatio: 0.84, yRatio: 0.82 } },
];

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readPlacedCount(page: Page): Promise<number> {
  const text = await page.getByTestId("silhouette-seven-progress").innerText();
  const matched = text.match(/^(\d+)\//);
  expect(matched, `進捗表示から配置数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readRoundLabel(page: Page): Promise<string> {
  return page.getByTestId("silhouette-seven-round").innerText();
}

/** 指定した起点からピクセル単位でオフセットした分だけドラッグする（タップ/ドラッグの判定をビューポート幅に依存させないため）。 */
async function dragStageByPixels(
  page: Page,
  stage: Locator,
  from: { xRatio: number; yRatio: number },
  offset: { dx: number; dy: number },
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const start = { x: box.x + box.width * from.xRatio, y: box.y + box.height * from.yRatio };
  const end = { x: start.x + offset.dx, y: start.y + offset.dy };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

/** 動かさずにクリック（タップ判定）する＝45度回転させる操作。 */
async function tapStage(
  page: Page,
  stage: Locator,
  at: { xRatio: number; yRatio: number },
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const point = { x: box.x + box.width * at.xRatio, y: box.y + box.height * at.yRatio };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("Silhouette Seven のストーリー", () => {
  test("7ピースを全て正しい枠へドラッグすると次のラウンドに進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readPlacedCount(page), "開始時は未配置").toBe(0);
    expect(await readRoundLabel(page)).toContain("1");

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 最後の1個は置いた瞬間にラウンド2へ進んで進捗が0に戻るので、途中までは個数を確認する
    for (const [index, { tray, slot }] of ROUND1_DRAGS.slice(0, -1).entries()) {
      await dragOnStage(page, stage, tray, slot);
      await expect
        .poll(() => readPlacedCount(page), { message: `${index + 1}個目のピースがはまる` })
        .toBe(index + 1);
    }

    const last = ROUND1_DRAGS[ROUND1_DRAGS.length - 1];
    await dragOnStage(page, stage, last.tray, last.slot);

    // 7個全てはめ切ると次のラウンドへ進み、進捗は0に戻る
    await expect.poll(() => readRoundLabel(page), { message: "ラウンド2に進む" }).toContain("2");
    expect(await readPlacedCount(page), "新ラウンドは未配置からやり直し").toBe(0);
    expect(await readScore(page), "クリアで得点が入っている").toBeGreaterThan(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("枠から離れた位置に置くとはまらず、位置をやり直せば後からはまる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const emptySpot = { xRatio: 0.5, yRatio: 0.95 };

    // 三角形のピースを、どの枠からも離れた場所に落とす
    await dragOnStage(page, stage, TRIANGLE_TRAY, emptySpot);
    await waitForFrames(page, 20);
    expect(await readPlacedCount(page), "合わない位置でははまらない").toBe(0);

    // スナップバックしていないので、今の位置から正しい枠へドラッグし直せばはまる
    await dragOnStage(page, stage, emptySpot, TRIANGLE_SLOT);
    await expect
      .poll(() => readPlacedCount(page), { message: "やり直すとはまる" })
      .toBeGreaterThan(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("動かさずタップすると45度回転し、向きが合わないとラウンド2の枠にははまらない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // まずラウンド1を完走してラウンド2へ進む
    for (const { tray, slot } of ROUND1_DRAGS) {
      await dragOnStage(page, stage, tray, slot);
      await waitForFrames(page, 5);
    }
    await expect.poll(() => readRoundLabel(page)).toContain("2");
    expect(await readPlacedCount(page)).toBe(0);

    // ラウンド2は向きがずれているので、回転させずに置くと失敗する
    await dragOnStage(page, stage, TRIANGLE_TRAY, TRIANGLE_SLOT);
    await waitForFrames(page, 10);
    expect(await readPlacedCount(page), "向きが合わないとはまらない").toBe(0);

    // 枠の位置に落ちたピースを、動かさずに4回タップ(180度分)回転させる
    for (let i = 0; i < 4; i++) {
      await tapStage(page, stage, TRIANGLE_SLOT);
      await waitForFrames(page, 3);
    }

    // 向きが揃った状態で、位置を保ったまま再度置き直すとはまる
    await dragStageByPixels(page, stage, TRIANGLE_SLOT, { dx: 15, dy: 0 });
    await expect
      .poll(() => readPlacedCount(page), { message: "向きを合わせるとはまる" })
      .toBeGreaterThan(0);

    expect(errors, "回転操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は操作しても進捗が変わらず、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const stage = page.getByTestId("game-shell-stage");
    const pauseButton = page.getByTestId("game-shell-pause");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const placedWhilePaused = await readPlacedCount(page);
    await dragOnStage(page, stage, TRIANGLE_TRAY, TRIANGLE_SLOT);
    await waitForFrames(page, 20);
    expect(await readPlacedCount(page), "一時停止中はドラッグしても進捗が変わらない").toBe(
      placedWhilePaused,
    );

    // 奇数回クリックなので一時停止のまま、偶数回なら再開しているはず
    for (let i = 0; i < 3; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    expect(errors, "一時停止中にエラーが出ていない").toEqual([]);
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
    await dragOnStage(page, stage, TRIANGLE_TRAY, TRIANGLE_SLOT);
    await expect
      .poll(() => readPlacedCount(page), { message: "リサイズ後もはめ込める" })
      .toBeGreaterThan(0);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
