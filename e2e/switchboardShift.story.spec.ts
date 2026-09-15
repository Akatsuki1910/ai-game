import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/switchboard-shift";
const SLOT_COUNT = 5;

// SwitchboardShiftGame.tsx のジャック配置と同じ比率(コンポーネント側の定数と対応)。
const SOURCE_X_RATIO = 0.22;
const DEST_X_RATIO = 0.78;
const TOP_Y_RATIO = 0.16;
const BOTTOM_Y_RATIO = 0.86;

function slotYRatio(index: number): number {
  return TOP_Y_RATIO + (index * (BOTTOM_Y_RATIO - TOP_Y_RATIO)) / (SLOT_COUNT - 1);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const value = await page.getByTestId("switchboard-shift-lives").getAttribute("data-lives");
  expect(value, "ライフが属性から読み取れる").not.toBeNull();
  return Number(value);
}

interface LiveSource {
  index: number;
  color: string;
}

/**
 * 発信ジャックの状態を1回のラウンドトリップでまとめて読む。
 * 点灯時間は短いため、1件ずつ getAttribute するとその間に
 * タイムアウトへ突入するレースが起きやすい。
 */
async function readSourceStatuses(
  page: Page,
): Promise<{ index: number; color: string; state: string }[]> {
  return page.evaluate((slotCount) => {
    const results: { index: number; color: string; state: string }[] = [];
    for (let i = 0; i < slotCount; i++) {
      const el = document.querySelector(`[data-testid="switchboard-shift-source-${i}"]`);
      if (!el) continue;
      results.push({
        index: i,
        color: el.getAttribute("data-color") ?? "",
        state: el.getAttribute("data-state") ?? "",
      });
    }
    return results;
  }, SLOT_COUNT);
}

/** 受信ジャックの色を1回のラウンドトリップでまとめて読む(順序は固定なのでindexがそのまま添字)。 */
async function readDestinationColors(page: Page): Promise<string[]> {
  return page.evaluate((slotCount) => {
    const colors: string[] = [];
    for (let i = 0; i < slotCount; i++) {
      const el = document.querySelector(`[data-testid="switchboard-shift-destination-${i}"]`);
      colors.push(el?.getAttribute("data-color") ?? "");
    }
    return colors;
  }, SLOT_COUNT);
}

/** 現在点灯中(呼出中)の発信ジャックを1つ探す。無ければnull。 */
async function findLiveSource(page: Page): Promise<LiveSource | null> {
  const statuses = await readSourceStatuses(page);
  const live = statuses.find((status) => status.state === "live");
  return live ? { index: live.index, color: live.color } : null;
}

async function waitForLiveSource(page: Page): Promise<LiveSource> {
  let found: LiveSource | null = null;
  await expect
    .poll(
      async () => {
        found = await findLiveSource(page);
        return found !== null;
      },
      { message: "発信ジャックが点灯する", timeout: 8000 },
    )
    .toBe(true);
  expect(found, "点灯中の発信ジャックが見つかる").not.toBeNull();
  // biome-ignore lint/style/noNonNullAssertion: 直前のexpectで非nullを確認済み
  return found!;
}

/** 指定した色を持つ受信ジャックのindexを探す。 */
async function findDestinationIndexByColor(page: Page, color: string): Promise<number> {
  const colors = await readDestinationColors(page);
  const index = colors.indexOf(color);
  if (index === -1) throw new Error(`色 ${color} を持つ受信ジャックが見つからない`);
  return index;
}

async function findDestinationIndexNotColor(page: Page, color: string): Promise<number> {
  const colors = await readDestinationColors(page);
  const index = colors.findIndex((destColor) => destColor !== color);
  if (index === -1) throw new Error("不一致の受信ジャックが見つからない");
  return index;
}

async function dragSourceToDestination(
  page: Page,
  stage: Locator,
  sourceIndex: number,
  destinationIndex: number,
): Promise<void> {
  await dragOnStage(
    page,
    stage,
    { xRatio: SOURCE_X_RATIO, yRatio: slotYRatio(sourceIndex) },
    { xRatio: DEST_X_RATIO, yRatio: slotYRatio(destinationIndex) },
  );
}

test.describe("Switchboard Shift のストーリー", () => {
  test("光ったジャックを正しく繋ぐとスコアが増え、一時停止・再開もできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(3);

    const stage = page.getByTestId("game-shell-stage");
    const live = await waitForLiveSource(page);
    const destinationIndex = await findDestinationIndexByColor(page, live.color);
    await dragSourceToDestination(page, stage, live.index, destinationIndex);

    await expect
      .poll(() => readScore(page), { message: "正しく接続するとスコアが増える" })
      .toBeGreaterThan(0);
    expect(await readLives(page), "正解ではライフは減らない").toBe(3);

    // 一時停止するとオーバーレイが出て、状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedLives = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readLives(page), "一時停止中はライフが変化しない").toBe(pausedLives);

    // 一時停止中にドラッグしても無視される。
    await dragOnStage(
      page,
      stage,
      { xRatio: SOURCE_X_RATIO, yRatio: slotYRatio(0) },
      { xRatio: DEST_X_RATIO, yRatio: slotYRatio(1) },
    );
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると進行を再開する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    const resumedLive = await waitForLiveSource(page);
    const resumedDestination = await findDestinationIndexByColor(page, resumedLive.color);
    await dragSourceToDestination(page, stage, resumedLive.index, resumedDestination);
    await expect
      .poll(() => readScore(page), { message: "再開後も接続してスコアが増える" })
      .toBeGreaterThan(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("誤接続と放置でライフが減り、尽きるとゲームオーバー。リスタートで最初から遊べる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // 1回目: 誤った色の受信ジャックへ繋いでライフを減らす。
    const firstLive = await waitForLiveSource(page);
    const wrongIndex = await findDestinationIndexNotColor(page, firstLive.color);
    await dragSourceToDestination(page, stage, firstLive.index, wrongIndex);
    await expect.poll(() => readLives(page), { message: "誤接続でライフが減る" }).toBe(2);

    // 2回目: 何もせず放置してタイムアウトさせる。
    await waitForLiveSource(page);
    await expect
      .poll(() => readLives(page), { message: "放置(タイムアウト)でライフが減る", timeout: 8000 })
      .toBe(1);

    // 3回目: 再び誤接続してライフを0にし、ゲームオーバーにする。
    const lastLive = await waitForLiveSource(page);
    const lastWrongIndex = await findDestinationIndexNotColor(page, lastLive.color);
    await dragSourceToDestination(page, stage, lastLive.index, lastWrongIndex);

    await expect(page.getByTestId("switchboard-shift-gameover")).toBeVisible();
    expect(await readLives(page), "ライフが0になっている").toBe(0);

    // ゲームオーバー中にドラッグしても、実際のユーザーと同様に入力が無視される。
    const scoreAtGameOver = await readScore(page);
    await dragSourceToDestination(page, stage, 0, 0);
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );
    expect(await readLives(page), "ゲームオーバー後の操作でライフが変化しない").toBe(0);

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("switchboard-shift-restart").click();
    await expect(page.getByTestId("switchboard-shift-gameover")).toBeHidden();
    expect(await readLives(page), "リスタートでライフが全回復する").toBe(3);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ライフ減少・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも接続でき、連打や画面リサイズをしても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // キーボード操作: 1〜5で発信ジャックを持ち、再度1〜5で受信ジャックへ接続する。
    // 点灯時間はごく短いため、たまたまその瞬間にタイムアウトへ入れ替わることがある。
    // その場合は次に点灯したジャックで取り直して接続を試みる(ゲーム側のロジックではなく、
    // 実時間で動くゲームに対するテスト操作タイミングの揺れを吸収するためのリトライ)。
    const scoreBeforeKeyboard = await readScore(page);
    await expect(async () => {
      const live = await waitForLiveSource(page);
      const destinationIndex = await findDestinationIndexByColor(page, live.color);
      await page.keyboard.press(String(live.index + 1));
      await page.keyboard.press(String(destinationIndex + 1));
      expect(await readScore(page)).toBeGreaterThan(scoreBeforeKeyboard);
    }).toPass({ timeout: 20000 });

    // ランダムな位置へのドラッグを連打しても表示が壊れない(ゲームオーバーなら都度リスタート)。
    const gameOver = page.getByTestId("switchboard-shift-gameover");
    for (let i = 0; i < 10; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("switchboard-shift-restart").click();
        continue;
      }
      await dragOnStage(
        page,
        stage,
        { xRatio: SOURCE_X_RATIO, yRatio: slotYRatio(i % SLOT_COUNT) },
        { xRatio: DEST_X_RATIO, yRatio: slotYRatio((i + 2) % SLOT_COUNT) },
      );
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("switchboard-shift-restart").click();
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
    if (!(await gameOver.isVisible().catch(() => false))) {
      const before = await readScore(page);
      const resizedLive = await waitForLiveSource(page);
      const resizedDestination = await findDestinationIndexByColor(page, resizedLive.color);
      await dragSourceToDestination(page, stage, resizedLive.index, resizedDestination);
      await expect
        .poll(() => readScore(page), { message: "リサイズ後も接続できる" })
        .toBeGreaterThanOrEqual(before);
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
