import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/senko-spark";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readSparksCaught(page: Page): Promise<number> {
  const text = await page.getByTestId("senko-spark-count").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `火花の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readStabilityPercent(page: Page): Promise<number> {
  const width = await page
    .getByTestId("senko-spark-stability-fill")
    .evaluate((el) => (el as HTMLElement).style.width);
  const matched = width.match(/(\d+(?:\.\d+)?)/);
  expect(matched, `安定度ゲージの表示から数値を読み取れる: "${width}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/**
 * ゲーム画面に入り、キャンバスが表示されるまで待つ。
 * キャンバスがDOMに現れた直後はResizeObserver経由のワールドサイズ反映が
 * まだ終わっていないことがあるため、最初の操作の前に数フレーム待っておく
 * (ステージの実サイズが反映される前に動かすと、見た目は動いても内部的には
 * 極小の仮サイズのまま座標がクランプされてしまうことがある)。
 */
async function openGame(page: Page): Promise<Locator> {
  await page.goto(GAME_PATH);
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas")).toBeVisible();
  await waitForFrames(page, 15);
  return stage;
}

async function dragAbsolute(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

/**
 * 漂う火花をキーボードでゆっくり追いかけるのは1フレームあたりの移動量が小さく、
 * フレーム供給が遅い環境では寿命切れ(4.5秒)に間に合わないことがある。
 * そのため、火球の目印から火花の目印へ1回のドラッグでほぼ到達させ、
 * 短い整定時間を置いてから(タップ相当の)Enterで掬う。1回で届かなければ
 * 現在位置から数回だけ追いドラッグする。
 */
async function catchNearestSpark(page: Page): Promise<void> {
  const sparkMarker = page.getByTestId("senko-spark-spark-marker");
  await expect(sparkMarker, "火花が出現する").toBeVisible({ timeout: 10_000 });

  for (let attempt = 0; attempt < 4; attempt++) {
    const emberBox = await page.getByTestId("senko-spark-ember-marker").boundingBox();
    const isSparkVisible = await sparkMarker.isVisible();
    if (!isSparkVisible) break; // 掬えた、または寿命切れ
    const sparkBox = await sparkMarker.boundingBox();
    expect(emberBox, "火球の目印の座標が取得できる").not.toBeNull();
    expect(sparkBox, "火花の目印の座標が取得できる").not.toBeNull();
    if (!emberBox || !sparkBox) break;

    await dragAbsolute(page, { x: emberBox.x, y: emberBox.y }, { x: sparkBox.x, y: sparkBox.y });
    // ドラッグ直後は火球がバネで追いついてくる途中なので、整定を待つ。
    await waitForFrames(page, 30);

    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await waitForFrames(page, 5);

    if ((await readSparksCaught(page)) > 0) return;
  }
}

test.describe("Senko Spark のストーリー", () => {
  test("遊び始めは安定度満タン・スコア0で、そっと操作すれば安定度を保ったままスコアが伸びる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const stage = await openGame(page);

    // スコアは時間経過だけでも自動的に増えるため、開始直後の値は厳密な0でなくごく小さい値を許容する
    // (起動直後に何フレーム処理が進んでいるかは実行環境の速度に依存するため)。
    const startScore = await readScore(page);
    expect(startScore, "開始直後のスコアはごく小さい").toBeLessThan(20);
    expect(await readSparksCaught(page), "開始時の火花は0").toBe(0);
    expect(await readStabilityPercent(page), "開始時の安定度はほぼ満タン").toBeGreaterThan(95);

    // ごく小さなドラッグ(そっと動かす)を何度か繰り返す
    for (let i = 0; i < 5; i++) {
      await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.52, yRatio: 0.51 });
      await waitForFrames(page, 10);
    }

    await expect
      .poll(() => readScore(page), { message: "生存時間ぶんスコアが増える" })
      .toBeGreaterThan(startScore);
    expect(
      await readStabilityPercent(page),
      "そっと操作していれば安定度はほぼ減らない",
    ).toBeGreaterThan(80);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("持ち手を大きく素早く動かすと火球が離れて安定度が落ちる", async ({ page }) => {
    const errors = collectPageErrors(page);
    const stage = await openGame(page);

    const before = await readStabilityPercent(page);

    // dragOnStage の down→move→up は実行が速い環境だと1フレームも処理されずに
    // 終わってしまうことがある(その場合、持ち手の移動がゲームループに一度も
    // 反映されず安定度が減らない)。ボタンを押している間に明示的にフレームを
    // 消化させてから離すことで、移動が確実にワールドへ反映されるようにする。
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;
    const from = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.15 };
    const to = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.85 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await waitForFrames(page, 3);
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await waitForFrames(page, 5);
    await page.mouse.up();
    await waitForFrames(page, 10);

    const after = await readStabilityPercent(page);
    expect(after, "大きく揺らすと安定度が落ちる").toBeLessThan(before);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("揺さぶり続けると安定度が尽きて終了し、もう一度あそぶで最初からやり直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const stage = await openGame(page);

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    const corners = [
      { x: box.x + box.width * 0.1, y: box.y + box.height * 0.1 },
      { x: box.x + box.width * 0.9, y: box.y + box.height * 0.9 },
    ];

    // ボタンを押したまま対角の端を素早く往復し続け、火球が追いつく前に常に大きく揺さぶる
    await page.mouse.move(corners[0].x, corners[0].y);
    await page.mouse.down();

    await expect(async () => {
      for (const corner of corners) {
        await page.mouse.move(corner.x, corner.y, { steps: 1 });
        await waitForFrames(page, 2);
      }
      await expect(page.getByTestId("senko-spark-gameover")).toBeVisible({ timeout: 200 });
    }).toPass({ timeout: 45_000, intervals: [50] });

    await page.mouse.up();

    const finalScore = await readScore(page);
    expect(finalScore, "終了画面にスコアが出ている").toBeGreaterThanOrEqual(0);

    // もう一度あそぶで最初から再開できる。スコアは時間経過だけでも増えるため、
    // クリック直後の表示更新タイミング次第でごくわずかに進んでいる可能性を許容する。
    await page.getByTestId("senko-spark-restart").click();
    await expect(page.getByTestId("senko-spark-gameover")).toBeHidden();
    await expect
      .poll(() => readScore(page), { message: "リスタートでスコアが0近くに戻る" })
      .toBeLessThan(5);
    await expect
      .poll(() => readStabilityPercent(page), { message: "リスタートで安定度が満タンに戻る" })
      .toBe(100);

    expect(errors, "揺さぶり中にエラーが出ていない").toEqual([]);
  });

  test("漂う火花を追いかけて掬うと、火花カウントとスコアが増える", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openGame(page);

    await catchNearestSpark(page);

    await expect
      .poll(() => readSparksCaught(page), { message: "火花を掬うとカウントが増える" })
      .toBeGreaterThan(0);
    expect(await readScore(page), "火花を掬うとボーナス得点が入る").toBeGreaterThan(0);

    expect(errors, "火花を掬う操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はスコアも安定度も変化せず、再開すると続きから進む。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const stage = await openGame(page);

    const runningScore = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "無操作でも時間経過でスコアが進む" })
      .toBeGreaterThan(runningScore);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedScore = await readScore(page);
    const pausedStability = await readStabilityPercent(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが進まない").toBe(pausedScore);
    expect(await readStabilityPercent(page), "一時停止中は安定度も変化しない").toBe(
      pausedStability,
    );

    // 一時停止中にドラッグしても状態は変わらない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.1, yRatio: 0.1 });
    expect(await readScore(page), "一時停止中の操作でもスコアは変わらない").toBe(pausedScore);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readScore(page), { message: "再開後はまたスコアが進む" })
      .toBeGreaterThan(pausedScore);

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
    const stage = await openGame(page);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も火球の目印がステージ内にあり、操作を受け付ける
    const markerBox = await page.getByTestId("senko-spark-ember-marker").boundingBox();
    const stageBox = await stage.boundingBox();
    expect(markerBox, "リサイズ後も火球の目印が存在する").not.toBeNull();
    expect(stageBox, "リサイズ後のステージ領域が取得できる").not.toBeNull();
    if (markerBox && stageBox) {
      expect(markerBox.x, "火球がステージ内に収まる").toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(markerBox.x).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
    }

    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.55, yRatio: 0.45 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
