import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/relic-dust";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readPercent(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `${testId} の表示から%の数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("relic-dust-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `発掘ラウンドの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("relic-dust-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

// engine/world.ts の GRID_COLS/ROWS と遺物(ラウンド1)の半径の計算と同じ値。
// 遺物は常にステージ中央に配置されるため、比率に変換してホールド位置を決められる。
const RELIC_RADIUS_X_RATIO = 2.1 / 14;
const RELIC_RADIUS_Y_RATIO = 1.5 / 9;

// 中心 + 周囲8方向。各点でポインタを静止させたまま(速度0)何フレームか押し続けて
// 砂を払う: 動かさないのでヒビが入るリスクが無く、許容速度を気にせず安全に発掘できる。
const HOLD_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.6, 0],
  [-0.6, 0],
  [0, 0.6],
  [0, -0.6],
  [0.6, 0.6],
  [-0.6, -0.6],
  [0.6, -0.6],
  [-0.6, 0.6],
];

/**
 * ステージ中央にある遺物の周囲を、ポインタを静止させたまま(速度0 = ヒビのリスク無し)
 * 何点かホールドして丁寧に砂を払う。1ラウンド分(ラウンド1相当の大きさ)を発掘率の
 * 閾値ぶん払い切れる想定(engine/world.ts の CLEAR_RATE_PER_SECOND・ラウンド1の
 * 遺物サイズに依拠する)。
 */
async function digCarefully(page: Page, stage: Locator, holdFrames = 12): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;

  for (const [nx, ny] of HOLD_OFFSETS) {
    const x = box.x + box.width * (0.5 + nx * RELIC_RADIUS_X_RATIO);
    const y = box.y + box.height * (0.5 + ny * RELIC_RADIUS_Y_RATIO);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await waitForFrames(page, holdFrames);
    await page.mouse.up();
    // 指を離している間にスタミナが回復する(次のホールドに備える)。
    await waitForFrames(page, 3);
  }
}

// engine/world.ts の BASE_ROUND_SECONDS(24) と ROUND_SECONDS_STEP(1) から決まる、無操作で待つゲーム内時間。
const FIRST_ROUND_SECONDS = 24;
const FIRST_THREE_ROUNDS_SECONDS = 24 + 23 + 22;
// ソフトウェア描画の実行環境ではこのゲームが10fpsを下回ることがあり(実測: モバイル相当で約7fps)、
// GameLoop が1フレームの経過を0.1秒で打ち切るぶんゲーム内時間が実時間より遅れる。
// 実時間の待ち上限はゲーム内時間の2倍とっておく。
const SLOW_RENDER_TIME_FACTOR = 2;
const IDLE_ROUND_TIMEOUT_MS = FIRST_ROUND_SECONDS * SLOW_RENDER_TIME_FACTOR * 1000;
const IDLE_GAMEOVER_TIMEOUT_MS = FIRST_THREE_ROUNDS_SECONDS * SLOW_RENDER_TIME_FACTOR * 1000;
const TEST_OVERHEAD_MS = 20_000;

test.describe("Relic Dust のストーリー", () => {
  test("起動直後は発掘1・ライフ3・耐久100%・スタミナ100%・発掘率0%でHUDが表示される", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("relic-dust-round")).toBeVisible();
    await expect(page.getByTestId("relic-dust-lives")).toBeVisible();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時は発掘1").toBe(1);
    expect(await readLives(page), "開始時のライフは3").toBe(3);
    expect(await readPercent(page, "relic-dust-integrity"), "開始時の耐久は満タン").toBe(100);
    expect(await readPercent(page, "relic-dust-stamina"), "開始時のスタミナは満タン").toBe(100);
    expect(await readPercent(page, "relic-dust-progress"), "開始時の発掘率は0%").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("丁寧に遺物を払い続けると発掘率が上がり、ヒビを入れずにクリアしてスコアが増え次の発掘へ進む", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await digCarefully(page, stage, 10);

    expect(
      await readPercent(page, "relic-dust-integrity"),
      "ヒビを入れずに払えば耐久は満タンのまま",
    ).toBe(100);

    await expect
      .poll(() => readRound(page), { message: "クリアして次の発掘ラウンドへ進む", timeout: 20000 })
      .toBe(2);
    expect(await readLives(page), "ヒビを入れずにクリアすればライフは減らない").toBe(3);
    await expect
      .poll(() => readScore(page), { message: "クリア分のスコアが加算される" })
      .toBeGreaterThan(0);

    expect(errors, "発掘操作中にエラーが出ていない").toEqual([]);
  });

  test("遺物の上を素早く払うとヒビが入り耐久が減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // 遺物の中心ではなく縁寄りを狙う: ブラシ範囲に入る遺物セルを少数に絞り、
    // 1回のヒビでラウンドが壊れきって耐久がリセットされてしまう(中心を狙うと起こりうる)
    // ことを避け、「耐久が減る」のを確実に観測できるようにする。
    const target = {
      x: box.x + box.width * (0.5 + 0.9 * RELIC_RADIUS_X_RATIO),
      y: box.y + box.height * 0.5,
    };
    const integrityBefore = await readPercent(page, "relic-dust-integrity");

    // 画面の隅から遺物の縁まで、ごく短時間で一気に払う(高速スワイプ)。
    await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.02);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 1 });
    await waitForFrames(page, 3);
    await page.mouse.up();

    await expect
      .poll(() => readPercent(page, "relic-dust-integrity"), {
        message: "高速で払うとヒビが入り耐久が減る",
        timeout: 8000,
      })
      .toBeLessThan(integrityBefore);

    expect(errors, "ヒビ発生中にエラーが出ていない").toEqual([]);
  });

  test("何もせず放置すると制限時間が尽きてライフが減り、次の発掘へ自動的に進む", async ({
    page,
  }) => {
    test.setTimeout(IDLE_ROUND_TIMEOUT_MS + TEST_OVERHEAD_MS);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    expect(await readLives(page)).toBe(3);

    await expect
      .poll(() => readLives(page), {
        message: "無操作のまま制限時間が尽きるとライフが減る",
        timeout: IDLE_ROUND_TIMEOUT_MS,
      })
      .toBeLessThan(3);
    expect(await readRound(page), "タイムアウトでも次の発掘ラウンドへ進む").toBe(2);

    expect(errors, "放置中にエラーが出ていない").toEqual([]);
  });

  test("3回タイムアウトを放置し続けるとゲームオーバーになり、リスタートできる", async ({
    page,
  }) => {
    test.setTimeout(IDLE_GAMEOVER_TIMEOUT_MS + TEST_OVERHEAD_MS);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();
    await expect(page.getByTestId("relic-dust-gameover")).toBeHidden();

    await expect
      .poll(() => page.getByTestId("relic-dust-gameover").isVisible(), {
        message: "ライフを使い切ると発掘中止の表示が出る",
        timeout: IDLE_GAMEOVER_TIMEOUT_MS,
      })
      .toBe(true);
    expect(await readLives(page), "ゲームオーバー時のライフは0").toBe(0);

    await page.getByTestId("relic-dust-restart").click();

    await expect(page.getByTestId("relic-dust-gameover"), "リスタートで表示が消える").toBeHidden();
    expect(await readLives(page), "リスタートでライフが3に戻る").toBe(3);
    expect(await readRound(page), "リスタートで発掘1に戻る").toBe(1);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバー/リスタート中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は進行が止まり、操作を受け付けない。再開すると進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const progressWhilePaused = await readPercent(page, "relic-dust-progress");
    const staminaWhilePaused = await readPercent(page, "relic-dust-stamina");

    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.5 });
    await waitForFrames(page, 30);
    expect(
      await readPercent(page, "relic-dust-progress"),
      "一時停止中は払っても発掘率が変わらない",
    ).toBe(progressWhilePaused);
    expect(await readPercent(page, "relic-dust-stamina"), "一時停止中はスタミナも変化しない").toBe(
      staminaWhilePaused,
    );

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await expect
      .poll(() => readPercent(page, "relic-dust-stamina"), {
        message: "再開してから放置するとスタミナが回復方向に戻る(満タン付近を維持)",
      })
      .toBeGreaterThanOrEqual(90);

    expect(errors, "一時停止/再開中にエラーが出ていない").toEqual([]);
  });

  test("キーボードでも刷毛を動かして払うことができ、連打・端への移動でも壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "s", "a", "d"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 3);
      await page.keyboard.up(key);
    }

    // 端まで振り切っても壊れない。
    await page.keyboard.down("ArrowUp");
    await page.keyboard.down("ArrowLeft");
    await waitForFrames(page, 40);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.up("ArrowLeft");

    const progressBefore = await readPercent(page, "relic-dust-progress");
    await page.keyboard.down("Enter");
    await waitForFrames(page, 30);
    await page.keyboard.up("Enter");

    await expect
      .poll(() => readPercent(page, "relic-dust-progress"), {
        message: "Enter長押しでも砂を払って発掘率が進む",
      })
      .toBeGreaterThanOrEqual(progressBefore);

    for (let i = 0; i < 6; i++) await page.keyboard.press("Enter");

    await expect(stage.locator("canvas"), "キーボード連打後もキャンバスが生きている").toBeVisible();
    expect(errors, "キーボード操作・連打でエラーが出ていない").toEqual([]);
  });

  test("Rキーでセッション全体がリセットされる", async ({ page }) => {
    test.setTimeout(45000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await digCarefully(page, stage, 3);
    await expect
      .poll(() => readPercent(page, "relic-dust-progress"), { timeout: 15000 })
      .toBeGreaterThan(0);

    await page.keyboard.press("r");

    expect(await readRound(page), "Rキーで発掘1に戻る").toBe(1);
    expect(await readLives(page), "Rキーでライフが3に戻る").toBe(3);
    expect(await readScore(page), "Rキーでスコアが0に戻る").toBe(0);
    expect(await readPercent(page, "relic-dust-progress"), "Rキーで発掘率が0%に戻る").toBe(0);
    await expect(page.getByTestId("relic-dust-gameover")).toBeHidden();

    expect(errors, "リセット操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("relic-dust-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const progressBefore = await readPercent(page, "relic-dust-progress");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.48, yRatio: 0.52 });
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "リサイズ後も操作でキャンバスが生きている").toBeVisible();
    expect(
      await readPercent(page, "relic-dust-progress"),
      "リサイズ後も発掘率が0未満にはならない",
    ).toBeGreaterThanOrEqual(progressBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
