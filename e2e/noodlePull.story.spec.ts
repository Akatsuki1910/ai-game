import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/noodle-pull";
// 的は的の幅の最小でも MIN_FOLD_STRETCH より十分広いので、0.55秒前後の押下は
// 的のランダムな位置に関わらず「的に近いか、的の中」になり、0点にはならない。
const MID_HOLD_MS = 550;
// 低スペックなサンドボックスではフレーム供給が遅く、ゲーム内時間の進みが実時間より
// 遅れることがある(AGENTS.md参照)。千切れ(SNAP_STRETCH=1.3)は1ラウンドの制限時間
// (6秒、ゲーム内時間)より確実に早く起きるため、固定時間ではなく「結果が出るまで
// 押し続ける」方式にして、フレーム供給の遅さに関わらず確実に千切れを再現する。
const SNAP_RESULT_TIMEOUT_MS = 20_000;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("noodle-pull-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readFreshnessPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("noodle-pull-freshness").innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `鮮度表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readStrandCount(page: Page): Promise<number> {
  const text = await page.getByTestId("noodle-pull-strands").innerText();
  const matched = text.match(/([\d,]+)本/);
  expect(matched, `麺の本数表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number((matched?.[1] ?? "0").replace(/,/g, ""));
}

/** ステージを holdMs だけ長押ししてから離す(長押し時間そのものが引き伸ばし量を決める)。 */
async function pressAndHold(page: Page, stage: Locator, holdMs: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await waitForFrames(page, 4);
}

test.describe("Noodle Pull のストーリー", () => {
  test("起動直後はラウンド1・鮮度満タン・麺1本・スコア0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("noodle-pull-round")).toBeVisible();
    await expect(page.getByTestId("noodle-pull-strands")).toBeVisible();
    await expect(page.getByTestId("noodle-pull-freshness")).toBeVisible();
    await expect(page.getByTestId("noodle-pull-result")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readStrandCount(page), "開始時は麺1本").toBe(1);
    // 読み取るまでの間にも鮮度は減り続け、環境によって描画が遅いと減り幅も変わるため、
    // ぴったり満タンではなく「まだ大きくは減っていない」ことを見る。
    expect(
      await readFreshnessPercent(page),
      "開始時は鮮度がまだ大きくは減っていない",
    ).toBeGreaterThanOrEqual(50);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("何もしなくても鮮度は時間経過で減っていく", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const before = await readFreshnessPercent(page);
    await expect
      .poll(() => readFreshnessPercent(page), { message: "無操作でも鮮度が減る", timeout: 5000 })
      .toBeLessThan(before);

    expect(errors, "無操作中にエラーが出ていない").toEqual([]);
  });

  test("ほどよく引いて離すと得点が加わり、少し間を置いて次のラウンドへ進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    await pressAndHold(page, stage, MID_HOLD_MS);

    await expect
      .poll(() => readScore(page), { message: "畳むと得点が増える" })
      .toBeGreaterThan(scoreBefore);

    await expect
      .poll(() => readRound(page), { message: "少し間を置いて次のラウンドへ進む", timeout: 4000 })
      .toBe(2);
    await expect(page.getByTestId("noodle-pull-result")).toBeHidden();
    expect(
      await readFreshnessPercent(page),
      "次のラウンドでは鮮度がリセットされてまだ大きくは減っていない",
    ).toBeGreaterThanOrEqual(50);

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });

  test("伸ばしすぎると離さなくても千切れて結果が表示され、スコアは増えずに次のラウンドへ進む", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const scoreBefore = await readScore(page);
    const roundBefore = await readRound(page);

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 千切れる(SNAP_STRETCH)まで実時間を固定せず押し続ける。結果が出たら離す。
    await expect(page.getByTestId("noodle-pull-result"), "千切れた結果表示が出る").toBeVisible({
      timeout: SNAP_RESULT_TIMEOUT_MS,
    });
    await page.mouse.up();

    await expect(page.getByTestId("noodle-pull-result")).toContainText("切れた");
    expect(await readScore(page), "千切れてもスコアは増えない").toBe(scoreBefore);

    await expect
      .poll(() => readRound(page), {
        message: "千切れても次のラウンドへ自動的に進む",
        timeout: 4000,
      })
      .toBe(roundBefore + 1);

    expect(errors, "千切れの操作でエラーが出ていない").toEqual([]);
  });

  test("キーボード(Enter長押し)でも遊べ、連打や短い空振りでも壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // ごく短い押下(空振り)を連打してもラウンドが進まない・壊れない
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Enter");
    }
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "空振り連打後もキャンバスが生きている").toBeVisible();

    // Enterを長押しして離すとキーボードでも畳める
    const roundBefore = await readRound(page);
    await page.keyboard.down("Enter");
    await page.waitForTimeout(MID_HOLD_MS);
    await page.keyboard.up("Enter");
    await waitForFrames(page, 4);

    await expect
      .poll(() => readRound(page), { message: "キーボード操作でもラウンドが進む", timeout: 4000 })
      .toBeGreaterThan(roundBefore);

    expect(errors, "キーボード操作・連打でエラーが出ていない").toEqual([]);
  });

  test("一時停止中は鮮度もスコアも変化せず、再開すると再び進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const freshnessWhilePaused = await readFreshnessPercent(page);
    const scoreWhilePaused = await readScore(page);

    await pressAndHold(page, stage, MID_HOLD_MS);

    expect(await readFreshnessPercent(page), "一時停止中は鮮度が変化しない").toBe(
      freshnessWhilePaused,
    );
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(scoreWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await expect
      .poll(() => readFreshnessPercent(page), { message: "再開すると鮮度が再び減り始める" })
      .toBeLessThan(freshnessWhilePaused);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("Rキーでセッション全体(ラウンド・スコア・鮮度・麺の本数)がリセットされる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await pressAndHold(page, stage, MID_HOLD_MS);
    await expect
      .poll(() => readRound(page), { message: "1ラウンド終えて2ラウンド目に入る", timeout: 4000 })
      .toBe(2);

    await page.keyboard.press("r");

    await expect.poll(() => readRound(page), { message: "Rキーでラウンド1に戻る" }).toBe(1);
    expect(await readScore(page), "Rキーでスコアが0に戻る").toBe(0);
    expect(await readStrandCount(page), "Rキーで麺が1本に戻る").toBe(1);
    expect(
      await readFreshnessPercent(page),
      "Rキーで鮮度がほぼ満タンに戻る",
    ).toBeGreaterThanOrEqual(50);
    await expect(page.getByTestId("noodle-pull-result")).toBeHidden();

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
    await expect(page.getByTestId("noodle-pull-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も触って壊れないことを確認する(ドラッグ相当の操作)
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.45 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    const scoreBefore = await readScore(page);
    await pressAndHold(page, stage, MID_HOLD_MS);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後も畳むと得点が増える" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
