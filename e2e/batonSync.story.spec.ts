import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/baton-sync";

// engine/world.ts の TEMPO_MIN/MAX・DYNAMICS_MIN/MAX と同じ値。
// 目標の表示値から「ドラッグすべき画面上の比率」を逆算するために使う。
const TEMPO_MIN = 60;
const TEMPO_MAX = 200;
const DYNAMICS_MIN = 0;
const DYNAMICS_MAX = 100;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readFocus(page: Page): Promise<number> {
  const text = await page.getByTestId("baton-sync-focus").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `集中力の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 「テンポ ♩=130(目標 145)」のような表示から現在値と目標値を読み取る。 */
async function readReadoutValues(page: Page, testId: string): Promise<{ target: number }> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/目標\s*(\d+)/);
  expect(matched, `目標値を読み取れる: "${text}"`).not.toBeNull();
  return { target: Number(matched?.[1] ?? Number.NaN) };
}

/** 現在表示されている目標テンポ・目標音量にバトンを重ねる位置の比率を求める。 */
async function ratioToCurrentTarget(page: Page): Promise<{ xRatio: number; yRatio: number }> {
  const [{ target: targetTempo }, { target: targetDynamics }] = await Promise.all([
    readReadoutValues(page, "baton-sync-tempo"),
    readReadoutValues(page, "baton-sync-dynamics"),
  ]);
  return {
    xRatio: (targetTempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN),
    yRatio: 1 - (targetDynamics - DYNAMICS_MIN) / (DYNAMICS_MAX - DYNAMICS_MIN),
  };
}

test.describe("Baton Sync のストーリー", () => {
  test("遊び始めると自動でスコアが伸び、ドラッグで操作しても壊れず一時停止・再開できる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: スコア0・集中力満タンで始まる(開始位置が初期フレーズの目標と一致する設計)
    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readFocus(page), "開始時の集中力は満タン").toBe(100);

    // 何もしなくても中央の初期フレーズに合っているため、スコアが自然に伸びていく
    await expect
      .poll(() => readScore(page), { message: "スコアが時間経過で伸びる" })
      .toBeGreaterThan(0);

    const stage = page.getByTestId("game-shell-stage");

    // 一時停止すると時間が止まる(集中力もスコアも変化しない)
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedFocus = await readFocus(page);
    const pausedScore = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readFocus(page), "一時停止中は集中力が変わらない").toBe(pausedFocus);
    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(pausedScore);

    // 一時停止中は盤面がオーバーレイに覆われ、ステージへのドラッグは届かない
    // (このゲームの中心操作: ドラッグで左右=テンポ・上下=音量)
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.03, yRatio: 0.97 });
    expect(await readFocus(page), "一時停止中の操作で集中力が動かない").toBe(pausedFocus);

    // 再開する
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // 再開後にバトンを大きく外すと、集中力が減っていく
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.03, yRatio: 0.97 });
    await expect
      .poll(() => readFocus(page), { message: "外すと集中力が減る" })
      .toBeLessThan(pausedFocus);
    const loweredFocus = await readFocus(page);

    // (まだ最初のフレーズの間に)現在の目標ちょうどの位置へバトンを戻すと、集中力が回復する
    const targetRatio = await ratioToCurrentTarget(page);
    await dragOnStage(page, stage, { xRatio: 0.03, yRatio: 0.97 }, targetRatio);
    await expect
      .poll(() => readFocus(page), { message: "目標に重ねた位置に戻すと集中力が回復する" })
      .toBeGreaterThan(loweredFocus);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と進行がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    const runningScore = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "連打後も進行している(スコアが伸びる)" })
      .toBeGreaterThan(runningScore);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedScore = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "連打後の一時停止も効いている").toBe(pausedScore);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わってもバトン操作とスコア進行が続く", async ({ page }) => {
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

    // リサイズ後も操作を受け付け、進行が続く
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.5 });
    const scoreAfterResize = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後もスコアが進行する" })
      .toBeGreaterThan(scoreAfterResize);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("大きく外した位置に放置し続けると集中力が尽きて演奏が崩壊し、リスタートできる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");

    // テンポ最低・音量最低の隅へドラッグして放置する(目標から大きく外れ続ける異常系)
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.02, yRatio: 0.98 });

    await expect(
      page.getByTestId("baton-sync-gameover"),
      "集中力が尽きて演奏が崩壊する",
    ).toBeVisible({ timeout: 20000 });
    expect(await readFocus(page), "ゲームオーバー時は集中力が0").toBe(0);

    await page.getByTestId("baton-sync-restart").click();

    await expect(
      page.getByTestId("baton-sync-gameover"),
      "リスタートで崩壊表示が消える",
    ).toBeHidden();
    // リスタート直後は初期フレーズに自動的に合っているため即スコアが増え始めるが、
    // 直前までの蓄積スコアに比べれば十分小さい値まで戻っていることを確認する。
    expect(await readScore(page), "リスタートでスコアが低い値に戻る").toBeLessThan(50);
    expect(await readFocus(page), "リスタートで集中力が満タンに戻る").toBe(100);

    expect(errors, "ゲームオーバー/リスタート中にエラーが出ていない").toEqual([]);
  });
});
