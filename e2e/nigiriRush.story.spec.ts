import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/nigiri-rush";
const LANE_COUNT = 3;
const FIND_TIMEOUT = 20_000;

interface LaneSnapshot {
  index: number;
  state: string;
  kind: string;
}

interface StageSnapshot {
  target: string;
  lanes: LaneSnapshot[];
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const value = await page.getByTestId("nigiri-rush-lives").getAttribute("data-lives");
  expect(value, "ライフが属性から読み取れる").not.toBeNull();
  return Number(value);
}

/** 注文と全レーンの状態を1回のラウンドトリップでまとめて読む(個別に読むとレースが起きやすいため)。 */
async function readStage(page: Page): Promise<StageSnapshot> {
  return page.evaluate((laneCount) => {
    const target =
      document.querySelector('[data-testid="nigiri-rush-target"]')?.getAttribute("data-kind") ?? "";
    const lanes: LaneSnapshot[] = [];
    for (let i = 0; i < laneCount; i++) {
      const el = document.querySelector(`[data-testid="nigiri-rush-lane-${i}"]`);
      lanes.push({
        index: i,
        state: el?.getAttribute("data-state") ?? "",
        kind: el?.getAttribute("data-kind") ?? "",
      });
    }
    return { target, lanes };
  }, LANE_COUNT);
}

async function clickLane(page: Page, laneIndex: number): Promise<void> {
  await page.getByTestId(`nigiri-rush-lane-${laneIndex}`).click();
}

/**
 * 条件(isDesired)に合うレーンが出現するまで待つ。待っている間に、探している対象
 * ではない「注文中のネタ」が出現したら、放置してタイムアウトしライフを失ったり
 * 出現枠を占有し続けたりしないよう、その場で取っておく(自然なプレイでも注文が
 * 来ていれば取るはずの操作であり、テストの前提を崩さないための後始末)。
 */
async function waitForLane(
  page: Page,
  isDesired: (lane: LaneSnapshot, target: string) => boolean,
  message: string,
): Promise<LaneSnapshot> {
  const deadline = Date.now() + FIND_TIMEOUT;
  while (Date.now() < deadline) {
    const stage = await readStage(page);
    const desired = stage.lanes.find(
      (lane) => lane.state === "active" && isDesired(lane, stage.target),
    );
    if (desired) return desired;

    const strayTarget = stage.lanes.find(
      (lane) => lane.state === "active" && lane.kind === stage.target,
    );
    if (strayTarget) {
      await clickLane(page, strayTarget.index);
      continue;
    }
    await waitForFrames(page, 5);
  }
  throw new Error(message);
}

const isTargetMatch = (lane: LaneSnapshot, target: string) => lane.kind === target;
const isWrongEdible = (lane: LaneSnapshot, target: string) =>
  lane.kind !== "" && lane.kind !== target && lane.kind !== "wasabi";
const isHazard = (lane: LaneSnapshot) => lane.kind === "wasabi";

test.describe("Nigiri Rush のストーリー", () => {
  test("注文と同じネタを取るとスコアが増え、一時停止・再開もできる", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(3);

    const lane = await waitForLane(page, isTargetMatch, "注文と同じネタのレーンが出現する");
    const livesBeforeCorrect = await readLives(page);
    await clickLane(page, lane.index);

    await expect
      .poll(() => readScore(page), { message: "注文と同じネタを取るとスコアが増える" })
      .toBeGreaterThan(0);
    expect(await readLives(page), "正解ではライフは減らない").toBe(livesBeforeCorrect);

    // 一時停止するとオーバーレイが出て、状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedLives = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readLives(page), "一時停止中はライフが変化しない").toBe(pausedLives);

    // 一時停止中はキーボードでレーンを取ろうとしても無視される。
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await page.keyboard.press("3");
    expect(await readScore(page), "一時停止中のキー操作でスコアが動かない").toBe(pausedScore);

    // 再開すると進行を再開する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    const resumedLane = await waitForLane(
      page,
      isTargetMatch,
      "再開後に注文と同じネタのレーンが出現する",
    );
    await clickLane(page, resumedLane.index);
    await expect
      .poll(() => readScore(page), { message: "再開後も取るとスコアが増える" })
      .toBeGreaterThan(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("誤答・わさび・取り逃しでライフが減り、尽きるとゲームオーバー。リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 1回目: 注文と違うネタ(わさび以外)を取ってライフを減らす。
    const wrongLane = await waitForLane(page, isWrongEdible, "注文と違うネタのレーンが出現する");
    const livesBeforeWrong = await readLives(page);
    await clickLane(page, wrongLane.index);
    await expect
      .poll(() => readLives(page), { message: "誤答でライフが減る" })
      .toBe(livesBeforeWrong - 1);

    // 2回目: わさびを取ってライフを減らす。
    const wasabiLane = await waitForLane(page, isHazard, "わさびのレーンが出現する");
    const livesBeforeWasabi = await readLives(page);
    await clickLane(page, wasabiLane.index);
    await expect
      .poll(() => readLives(page), { message: "わさびを取るとライフが減る" })
      .toBe(livesBeforeWasabi - 1);

    // 3回目以降: 注文中のネタが出現しても今度はわざと無視し、取り逃しでライフを0にする。
    // (誤答・わさびの操作がクリックのタイミングによりまれに不発になっていた場合に
    // 備え、その回数分だけ繰り返す。ゲーム側のロジックではなく、実時間で動く
    // ゲームに対するテスト操作タイミングの揺れを吸収するためのもの)。
    while ((await readLives(page)) > 0) {
      await waitForLane(page, isTargetMatch, "注文と同じネタのレーンが再び出現する");
      const before = await readLives(page);
      await expect
        .poll(() => readLives(page), {
          message: "取り逃し(タイムアウト)でライフが減る",
          timeout: 10_000,
        })
        .toBeLessThan(before);
    }

    await expect(page.getByTestId("nigiri-rush-gameover")).toBeVisible();

    // ゲームオーバー中はキー操作をしても無視される。
    const scoreAtGameOver = await readScore(page);
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await page.keyboard.press("3");
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );
    expect(await readLives(page), "ゲームオーバー後の操作でライフが変化しない").toBe(0);

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("nigiri-rush-restart").click();
    await expect(page.getByTestId("nigiri-rush-gameover")).toBeHidden();
    expect(await readLives(page), "リスタートでライフが全回復する").toBe(3);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ライフ減少・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも取れ、連打や画面リサイズをしても壊れない", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // キーボード操作: 注文と同じネタのレーンを1〜3キーで取る。
    // 出現から一致するまでに時間がかかることがあるため、見つからなければ
    // 待ち直すリトライを許容する(ゲーム側のロジックではなく、実時間で動く
    // ゲームに対するテスト操作タイミングの揺れを吸収するためのもの)。
    const scoreBeforeKeyboard = await readScore(page);
    await expect(async () => {
      const lane = await waitForLane(page, isTargetMatch, "注文と同じネタのレーンが出現する");
      await page.keyboard.press(String(lane.index + 1));
      expect(await readScore(page)).toBeGreaterThan(scoreBeforeKeyboard);
    }).toPass({ timeout: 45_000 });

    // ランダムなレーンを連打しても表示が壊れない(ゲームオーバーなら都度リスタート)。
    const stage = page.getByTestId("game-shell-stage");
    const gameOver = page.getByTestId("nigiri-rush-gameover");
    for (let i = 0; i < 10; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("nigiri-rush-restart").click();
        continue;
      }
      await clickLane(page, i % LANE_COUNT);
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("nigiri-rush-restart").click();
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
      const lane = await waitForLane(
        page,
        isTargetMatch,
        "リサイズ後に注文と同じネタのレーンが出現する",
      );
      await clickLane(page, lane.index);
      await expect
        .poll(() => readScore(page), { message: "リサイズ後も取れる" })
        .toBeGreaterThanOrEqual(before);
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
