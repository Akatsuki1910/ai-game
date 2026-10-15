import { expect, type Page, test } from "@playwright/test";
import { CHAIN_THRESHOLD, LANE_COUNT } from "../src/app/games/cornice-watch/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/cornice-watch";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readVillageHealth(page: Page): Promise<number> {
  const value = await page.getByTestId("cornice-watch-village-health").getAttribute("data-health");
  expect(value, "集落の体力が属性から読み取れる").not.toBeNull();
  return Number(value);
}

/** レーンの積雪量を読み取る。ゲームループがまだ一度も回っていない間はdata-load属性が
 * 付いていないことがあるため、その場合は0として扱う。 */
async function readLaneLoad(page: Page, laneIndex: number): Promise<number> {
  const value = await page.getByTestId(`cornice-watch-lane-${laneIndex}`).getAttribute("data-load");
  return value === null ? 0 : Number(value);
}

/** 全レーンのうち、指定量以上積もっているレーンの番号を返す(なければnull)。 */
async function findLaneWithLoadAtLeast(page: Page, minLoad: number): Promise<number | null> {
  for (let i = 0; i < LANE_COUNT; i++) {
    if ((await readLaneLoad(page, i)) >= minLoad) return i;
  }
  return null;
}

test.describe("Cornice Watch のストーリー", () => {
  test("放置すると積雪が進み、タップで解放すると得点が入る", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("cornice-watch-stage").locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await expect(page.getByTestId("cornice-watch-village-health")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readVillageHealth(page), "開始時の集落は満タン").toBe(100);
    // レーンの初期積雪はわずかにばらつくうえ、遅い環境ではここまでの間にも進むため、
    // 「厳密に少ない」ことは検証せず、以降の「放置で増えていく」検証に任せる。

    // 何もしなくても積雪は自動的に増える
    await expect
      .poll(async () => findLaneWithLoadAtLeast(page, 0.15), {
        message: "放置しているだけで積雪が進む",
        timeout: 20_000,
      })
      .not.toBeNull();

    // 積もったレーンをクリックして解放すると得点が入る
    const laneIndex = await findLaneWithLoadAtLeast(page, 0.15);
    expect(laneIndex, "積もったレーンが見つかる").not.toBeNull();
    if (laneIndex !== null) {
      await page.getByTestId(`cornice-watch-lane-${laneIndex}`).click();
      // 解放直後から積雪はまた増え始めるため、厳密に0ではなく「大きく減った」ことを確認する。
      await expect
        .poll(() => readLaneLoad(page, laneIndex), { message: "解放したレーンは空に近く戻る" })
        .toBeLessThan(0.15);
    }
    await expect
      .poll(() => readScore(page), { message: "解放すると得点が入る" })
      .toBeGreaterThan(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("しきい値以上まで溜めてから解放すると隣のレーンへ雪が飛び火する", async ({ page }) => {
    test.setTimeout(70_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    // キャンバスのサイズが確定してゲームループが回り出すまで待ってから読み始める
    // (直後だとdata-load属性がまだ付いていないことがある)。
    await expect(page.getByTestId("cornice-watch-stage").locator("canvas")).toBeVisible();
    await waitForFrames(page, 10);

    await expect
      .poll(async () => findLaneWithLoadAtLeast(page, CHAIN_THRESHOLD), {
        message: "際どいしきい値まで積もるレーンを待つ",
        timeout: 40_000,
      })
      .not.toBeNull();
    // 積雪は解放するまで増え続ける一方なので、しきい値到達を確認した直後に読み直しても安全。
    const laneIndex = (await findLaneWithLoadAtLeast(page, CHAIN_THRESHOLD)) ?? 0;

    const neighborIndices = [laneIndex - 1, laneIndex + 1].filter((i) => i >= 0 && i < LANE_COUNT);
    expect(neighborIndices.length, "少なくとも1つは隣のレーンがある").toBeGreaterThan(0);
    const neighborLoadsBefore = await Promise.all(
      neighborIndices.map((i) => readLaneLoad(page, i)),
    );

    await page.getByTestId(`cornice-watch-lane-${laneIndex}`).click();

    for (let i = 0; i < neighborIndices.length; i++) {
      await expect
        .poll(() => readLaneLoad(page, neighborIndices[i]), {
          message: `隣のレーン${neighborIndices[i]}に雪が飛び火して増える`,
        })
        .toBeGreaterThan(neighborLoadsBefore[i]);
    }

    expect(errors, "際どい解放の操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は積雪もクリックによる解放も進まず、再開すると続きから進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await waitForFrames(page, 30);
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedLoads = await Promise.all(
      Array.from({ length: LANE_COUNT }, (_, i) => readLaneLoad(page, i)),
    );
    await waitForFrames(page, 60);
    const stillPausedLoads = await Promise.all(
      Array.from({ length: LANE_COUNT }, (_, i) => readLaneLoad(page, i)),
    );
    expect(stillPausedLoads, "一時停止中は積雪が変化しない").toEqual(pausedLoads);

    // 一時停止オーバーレイがステージを覆ってクリックそのものを物理的に防ぐが、
    // ロジック側でも無視されることを force クリックで確認する。
    await page.getByTestId("cornice-watch-lane-0").click({ force: true });
    expect(await readLaneLoad(page, 0), "一時停止中のクリックは無視される").toBe(pausedLoads[0]);
    expect(await readScore(page), "一時停止中はスコアも変化しない").toBe(0);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(async () => findLaneWithLoadAtLeast(page, 0.01), {
        message: "再開すると積雪がまた進む",
        timeout: 15_000,
      })
      .not.toBeNull();

    expect(errors, "一時停止・再開でエラーが出ていない").toEqual([]);
  });

  test("放置し続けると集落の体力が尽きてゲームオーバーになり、リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect
      .poll(() => page.getByTestId("cornice-watch-gameover").isVisible(), {
        message: "何もせず放置し続けると集落が雪崩に飲まれる",
        timeout: 100_000,
        intervals: [500],
      })
      .toBe(true);

    expect(await readVillageHealth(page), "体力が0になっている").toBe(0);
    await expect(page.getByTestId("cornice-watch-gameover")).toContainText("SCORE");

    // ゲームオーバー中はレーンをクリックしても反応しない
    const scoreAtGameOver = await readScore(page);
    await page.getByTestId("cornice-watch-lane-0").click({ force: true });
    expect(await readScore(page), "ゲームオーバー後はスコアが変化しない").toBe(scoreAtGameOver);

    await page.getByTestId("cornice-watch-restart").click();
    await expect(page.getByTestId("cornice-watch-gameover")).toBeHidden();
    expect(await readVillageHealth(page), "リスタートで集落の体力が全回復する").toBe(100);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバー・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("レーンを連打しても表示が壊れず、画面サイズが変わっても操作を受け付ける", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("cornice-watch-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 全レーンを連打しても壊れない(ほとんどは積雪0のため空振りのはず)。
    // 途中でゲームオーバーになった場合はリスタートしてから続ける
    // (オーバーレイ表示中はレーンへのクリックが届かないのが正しい挙動のため)。
    const gameOver = page.getByTestId("cornice-watch-gameover");
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < LANE_COUNT; i++) {
        if (await gameOver.isVisible().catch(() => false)) {
          await page.getByTestId("cornice-watch-restart").click();
        }
        await page.getByTestId(`cornice-watch-lane-${i}`).click();
      }
    }
    await waitForFrames(page, 10);
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("cornice-watch-restart").click();
    }
    await expect(page.getByTestId("cornice-watch-village-health")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("cornice-watch-lane-0")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // ここまでの連打で盤面が荒れている(積雪ペースの累積で全体が高止まりしている)ことがあるため、
    // Rキーでラウンドをリセットしてから最後の解放操作を検証する。
    await page.keyboard.press("r");
    await expect
      .poll(() => readVillageHealth(page), { message: "Rキーで集落の体力が全回復する" })
      .toBe(100);

    // リサイズ後も積雪の進行と解放操作を受け付ける
    await expect
      .poll(async () => findLaneWithLoadAtLeast(page, 0.05), {
        message: "リサイズ後も積雪が進む",
        timeout: 20_000,
      })
      .not.toBeNull();
    const laneIndex = await findLaneWithLoadAtLeast(page, 0.05);
    if (laneIndex !== null) {
      await page.getByTestId(`cornice-watch-lane-${laneIndex}`).click();
      await expect
        .poll(() => readLaneLoad(page, laneIndex), { message: "リサイズ後もクリックで解放できる" })
        .toBeLessThan(0.1);
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
