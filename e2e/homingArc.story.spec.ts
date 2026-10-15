import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/homing-arc";
const EXPECTED_START_LIVES = 3;
// 投球〜キャッチウィンドウ到達までは物理的には2〜3秒程度だが、低スペック環境での
// フレーム供給遅延を見込んで余裕を持ったタイムアウトにする(AGENTS.mdの既知のハマりどころ参照)。
const FLIGHT_POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("homing-arc-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

async function readStatus(page: Page): Promise<string> {
  return page.getByTestId("homing-arc-status").innerText();
}

async function waitForCanvas(page: Page): Promise<Locator> {
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();
  return stage;
}

/**
 * `expect.poll()` はこのゲームの requestAnimationFrame ループと組み合わせると、
 * 繰り返しの CDP 呼び出しが原因と見られる形でフレーム進行が止まってしまうことが
 * 確認された(手動の待機ループに置き換えると再現しない)。そのため、条件が満たされる
 * までの待ち合わせは `page.waitForTimeout` を挟む手動ポーリングで行う。
 * 固定時間の sleep ではなく「観測する条件＋有限のタイムアウト」で待つ点は変わらない。
 */
async function waitUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  page: Page,
  message: string,
  timeoutMs = FLIGHT_POLL_TIMEOUT_MS,
): Promise<T> {
  const start = Date.now();
  let value = await read();
  while (!predicate(value) && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    value = await read();
  }
  expect(predicate(value), message).toBe(true);
  return value;
}

/**
 * ステージ上でまっすぐ上へ弱く引っ張って離す（=弱いパワーでまっすぐ投げる）。
 * engine/world.ts の障害物は画面上部の限られた帯にしか出現せず、弱い直上投げの
 * 弧は幾何学的にその帯へ絶対に届かないため、障害物の乱数配置に関係なく
 * 必ずキャッチウィンドウまで到達する（詳細は world.ts のコメント参照）。
 */
async function throwStraightAndWeak(page: Page, stage: Locator): Promise<void> {
  await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.8 }, { xRatio: 0.5, yRatio: 0.86 });
  await waitUntil(
    () => readStatus(page),
    (s) => s !== "ねらう",
    page,
    "投げると飛行中になる",
  );
}

/** キャッチウィンドウが開くまで待ち、開いたらすぐタップしてキャッチする。 */
async function throwAndCatch(page: Page, stage: Locator): Promise<void> {
  await throwStraightAndWeak(page, stage);
  await waitUntil(
    () => readStatus(page),
    (s) => s === "キャッチ!",
    page,
    "投げるとやがてキャッチウィンドウが開く",
  );
  await stage.click();
}

/** 投げてキャッチせずに放置し、ミス（またはライフが減る結果）にする。 */
async function throwAndIgnore(page: Page, stage: Locator): Promise<void> {
  const livesBefore = await readLives(page);
  await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.75 }, { xRatio: 0.5, yRatio: 0.9 });
  await waitUntil(
    () => readStatus(page),
    (s) => s === "ねらう",
    page,
    "キャッチせず放置すると、やがて結果が出て狙い状態に戻る",
  );
  await waitUntil(
    () => readLives(page),
    (lives) => lives < livesBefore,
    page,
    "キャッチし損ねるとライフが減る",
  );
}

test.describe("Homing Arc のストーリー", () => {
  test("起動直後はねらう状態・満タンのライフでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("homing-arc-status")).toBeVisible();
    await expect(page.getByTestId("homing-arc-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readStatus(page), "開始時はねらう状態").toBe("ねらう");
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    await waitForCanvas(page);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("引っ張って投げ、戻ってきた瞬間にタップするとキャッチできて得点する", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    const stage = await waitForCanvas(page);

    await throwAndCatch(page, stage);

    await waitUntil(
      () => readScore(page),
      (s) => s > 0,
      page,
      "キャッチすると得点する",
    );
    expect(await readStatus(page), "キャッチ後はねらう状態に戻る").toBe("ねらう");
    expect(await readLives(page), "キャッチに成功すればライフは減らない").toBe(
      EXPECTED_START_LIVES,
    );
    await expect(page.getByTestId("homing-arc-combo")).toContainText("COMBO 1");

    // 連続でキャッチするとコンボが伸びる
    await throwAndCatch(page, stage);
    await expect(page.getByTestId("homing-arc-combo")).toContainText("COMBO 2");

    expect(errors, "投げてキャッチする操作中にエラーが出ていない").toEqual([]);
  });

  test("キャッチウィンドウの前に連打してもフライング判定にならない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await throwStraightAndWeak(page, stage);

    // ウィンドウが開く前に素早く何度もタップする（連打耐性の確認）。
    // ロケータ経由のクリックはアクショナビリティ確認のたびに実時間がかかり、
    // 低スペック環境ではウィンドウが開く前に叩ききれない恐れがあるため、
    // 座標を1度だけ取得して生のマウスクリックを連続で送る。
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      for (let i = 0; i < 8; i++) {
        await page.mouse.click(x, y);
      }
    }
    expect(await readLives(page), "早すぎるタップでライフは減らない").toBe(EXPECTED_START_LIVES);
    expect(await readScore(page), "早すぎるタップで得点しない").toBe(0);

    // それでもやがてキャッチウィンドウへは到達し、正しくキャッチできる
    await waitUntil(
      () => readStatus(page),
      (s) => s === "キャッチ!",
      page,
      "連打後もキャッチウィンドウへ到達する",
    );
    await stage.click();
    await waitUntil(
      () => readScore(page),
      (s) => s > 0,
      page,
      "ウィンドウ内のタップは得点になる",
    );

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は飛行が止まり、連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await throwStraightAndWeak(page, stage);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const statusWhilePaused = await readStatus(page);
    await waitForFrames(page, 60);
    expect(await readStatus(page), "一時停止中は状態が変わらない").toBe(statusWhilePaused);

    // 一時停止中にタップしてもキャッチ判定は進まない
    await stage.click();
    expect(await readLives(page), "一時停止中の操作でライフが変わらない").toBe(
      EXPECTED_START_LIVES,
    );

    // ここまでで一時停止ボタンは1回押した(＝一時停止中)状態。
    // 以降の連打テストは「再開中」を起点にしたいので、いったん再開しておく。
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

  test("キャッチし損ね続けるとライフが尽きてゲームオーバーになり、リスタートできる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const gameOver = page.getByTestId("homing-arc-gameover");

    for (let i = 0; i < EXPECTED_START_LIVES; i++) {
      await throwAndIgnore(page, stage);
    }

    await expect(gameOver, "ライフが尽きるとゲームオーバー表示になる").toBeVisible();
    expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);

    await page.getByTestId("homing-arc-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);
    expect(await readStatus(page), "リスタートでねらう状態に戻る").toBe("ねらう");

    expect(errors, "ゲームオーバーからリスタートまででエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も投げてキャッチできる
    await throwAndCatch(page, stage);
    await waitUntil(
      () => readScore(page),
      (s) => s > 0,
      page,
      "リサイズ後も得点できる",
    );

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
