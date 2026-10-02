import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  ATTEMPTS_MAX,
  CHUTE_X_MAX,
  type ClawPhase,
  SLOT_X_RATIOS,
} from "../src/app/games/prize-crane/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/prize-crane";

// どのtierでも確実に失敗する(全スロットから最大許容距離より離れている)位置。
// スロットへの搬出口外側の位置としても使える(0.05 < CHUTE_X_MAX の判定とは別の用途)。
const GUARANTEED_MISS_X_RATIO = 0.05;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("prize-crane-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readAttempts(page: Page): Promise<number> {
  const value = await page.getByTestId("prize-crane-attempts").getAttribute("data-attempts");
  expect(value, "アテンプト数が属性から読み取れる").not.toBeNull();
  return Number(value);
}

interface Status {
  phase: string;
  tier: string;
}

async function readStatus(page: Page): Promise<Status> {
  const el = page.getByTestId("prize-crane-status");
  const phase = await el.getAttribute("data-phase");
  const tier = await el.getAttribute("data-tier");
  expect(phase, "phase属性が読み取れる").not.toBeNull();
  return { phase: phase ?? "", tier: tier ?? "" };
}

async function waitForPhase(page: Page, phase: ClawPhase, timeout = 8000): Promise<void> {
  await expect
    .poll(async () => (await readStatus(page)).phase, {
      message: `phaseが${phase}になるのを待つ`,
      timeout,
    })
    .toBe(phase);
}

/** 降下・上昇(busy)が終わって idle か carrying のどちらかに落ち着くのを待ち、その結果を返す。 */
async function waitForSettledPhase(page: Page, timeout = 8000): Promise<string> {
  let settled = "";
  await expect
    .poll(
      async () => {
        settled = (await readStatus(page)).phase;
        return settled === "idle" || settled === "carrying";
      },
      { message: "降下・上昇が終わるのを待つ", timeout },
    )
    .toBe(true);
  return settled;
}

/** ステージ上の比率位置をクリックする(押した瞬間の位置でクレーンのx座標が決まる)。 */
async function clickStageAt(
  page: Page,
  stage: Locator,
  xRatio: number,
  yRatio = 0.5,
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

async function clickAction(page: Page): Promise<void> {
  await page.getByTestId("prize-crane-action").click();
}

test.describe("Prize Crane のストーリー", () => {
  test("正確に狙うと確実につかめて搬出でき、一時停止・再開もできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readAttempts(page), "開始時のアテンプトは満タン").toBe(ATTEMPTS_MAX);
    expect((await readStatus(page)).phase, "開始時はidle").toBe("idle");
    await expect(page.getByTestId("prize-crane-legend")).toBeVisible();

    // スロット0の中心ぴったりに狙いを定めて降ろす → 必ずつかめる。
    await clickStageAt(page, stage, SLOT_X_RATIOS[0]);
    await clickAction(page);
    expect(await readAttempts(page), "降ろすとアテンプトが1減る").toBe(ATTEMPTS_MAX - 1);

    await waitForPhase(page, "carrying");
    expect((await readStatus(page)).tier, "つかんだ景品のtierが分かる").not.toBe("");

    // 搬出口(左端)まで運んで置く → 加点・コンボが伸びる。
    await clickStageAt(page, stage, GUARANTEED_MISS_X_RATIO);
    expect(GUARANTEED_MISS_X_RATIO, "テスト用の位置は搬出口の内側").toBeLessThanOrEqual(
      CHUTE_X_MAX,
    );
    await clickAction(page);

    await waitForPhase(page, "idle");
    expect(await readScore(page), "搬出でスコアが増える").toBeGreaterThan(0);
    expect(await readCombo(page), "搬出でコンボが伸びる").toBe(1);

    // 一時停止すると状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedAttempts = await readAttempts(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);

    // 一時停止中は操作ボタンがオーバーレイに隠れてクリックできず、
    // キーボード操作(オーバーレイを迂回できる)も無視される。
    // (一時停止ボタン自体にフォーカスが残っていると、Enterキーがボタンのネイティブな
    //  クリックとして扱われ再開してしまうため、先にフォーカスを外す。)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await waitForFrames(page, 10);
    expect(await readAttempts(page), "一時停止中はアテンプトが減らない").toBe(pausedAttempts);

    // 再開すると操作を受け付ける。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await clickStageAt(page, stage, SLOT_X_RATIOS[1]);
    await clickAction(page);
    await waitForPhase(page, "carrying");
    await clickStageAt(page, stage, GUARANTEED_MISS_X_RATIO);
    await clickAction(page);
    await waitForPhase(page, "idle");
    expect(await readScore(page), "再開後も搬出でスコアが増える").toBeGreaterThan(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("外れ・取り落としでは加点されず、アテンプトが尽きるとゲームオーバー。リスタートで最初から遊べる", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // 1. どのスロットからも遠い位置で外す。
    await clickStageAt(page, stage, GUARANTEED_MISS_X_RATIO);
    await clickAction(page);
    await waitForPhase(page, "idle");
    expect(await readScore(page), "外れでは加点されない").toBe(0);
    expect(await readAttempts(page), "外すとアテンプトが減る").toBe(ATTEMPTS_MAX - 1);

    // 2. つかんでから搬出口の外(スロット位置そのまま)で置く → 取り落とし(fumble)。
    await clickStageAt(page, stage, SLOT_X_RATIOS[2]);
    await clickAction(page);
    await waitForPhase(page, "carrying");
    await clickAction(page); // 動かさずそのまま置く(搬出口の外)
    await waitForPhase(page, "idle");
    expect(await readScore(page), "取り落としでは加点されない").toBe(0);
    expect(await readCombo(page), "取り落としでコンボがリセットされる").toBe(0);
    expect(await readAttempts(page)).toBe(ATTEMPTS_MAX - 2);

    // 3. 残りのアテンプトを使い切るまで外し続ける。
    const gameOver = page.getByTestId("prize-crane-gameover");
    for (let guard = 0; guard < ATTEMPTS_MAX + 2 && (await readAttempts(page)) > 0; guard++) {
      await clickStageAt(page, stage, GUARANTEED_MISS_X_RATIO);
      await clickAction(page);
      await waitForPhase(page, "idle");
    }

    await expect(gameOver).toBeVisible();
    expect(await readAttempts(page), "アテンプトが0になっている").toBe(0);

    // ゲームオーバー中は操作ボタンがdisabledになり、キーボード操作も無視される。
    await expect(page.getByTestId("prize-crane-action")).toBeDisabled();
    const scoreAtGameOver = await readScore(page);
    await clickStageAt(page, stage, SLOT_X_RATIOS[0]);
    await page.keyboard.press("Enter");
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("prize-crane-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readAttempts(page), "リスタートでアテンプトが全回復する").toBe(ATTEMPTS_MAX);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readCombo(page), "リスタートでコンボが0に戻る").toBe(0);

    expect(errors, "ゲームオーバー・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも進行でき、激しく振ると取り落とし、連打や画面リサイズをしても壊れない", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // キーボード操作: 矢印キーで移動し、Enterで降ろす。
    const attemptsBeforeKeyboard = await readAttempts(page);
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 20);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.press("Enter");
    expect(await readAttempts(page), "Enterでアテンプトが減る").toBe(attemptsBeforeKeyboard - 1);
    const settledPhase = await waitForSettledPhase(page);
    if (settledPhase === "carrying") {
      await page.keyboard.press("Enter");
      await waitForPhase(page, "idle");
    }

    // 運搬中に激しく振ると取り落とす(ボタンを押さなくても自動的にidleへ戻る)。
    await clickStageAt(page, stage, SLOT_X_RATIOS[4]);
    await clickAction(page);
    await waitForPhase(page, "carrying");
    for (let i = 0; i < 6; i++) {
      await clickStageAt(page, stage, i % 2 === 0 ? 0.95 : 0.05);
    }
    await waitForPhase(page, "idle");
    expect(await readCombo(page), "振り落とし後はコンボがリセットされる").toBe(0);

    // ランダムな位置への連打をしても表示が壊れない(ゲームオーバーなら都度リスタート)。
    const gameOver = page.getByTestId("prize-crane-gameover");
    for (let i = 0; i < 10; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("prize-crane-restart").click();
        continue;
      }
      await clickStageAt(page, stage, (i % 5) / 5);
      // ボタンは降下・上昇中は disabled になるため、連打はキーボード(Enter)で行う。
      await page.keyboard.press("Enter");
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("prize-crane-restart").click();
    }
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける(直前の連打の影響が残っていないよう、まず落ち着くのを待つ)。
    if (!(await gameOver.isVisible().catch(() => false))) {
      await waitForSettledPhase(page);
      if ((await readStatus(page)).phase === "carrying") {
        await page.keyboard.press("Enter");
        await waitForPhase(page, "idle");
      }
      const before = await readAttempts(page);
      await clickStageAt(page, stage, SLOT_X_RATIOS[0]);
      await page.keyboard.press("Enter");
      await expect
        .poll(() => readAttempts(page), { message: "リサイズ後も操作できる" })
        .toBeLessThan(before);
    }

    expect(errors, "キーボード操作・振り落とし・連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
