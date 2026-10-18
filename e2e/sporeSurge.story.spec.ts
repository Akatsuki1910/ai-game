import { expect, type Page, test } from "@playwright/test";
import {
  collectPageErrors,
  dragOnStage,
  expectStageToAnimate,
  waitForFrames,
} from "./support/gameStory";

const GAME_PATH = "/games/spore-surge";

async function readLevel(page: Page): Promise<number> {
  const text = await page.getByTestId("spore-surge-level").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `レベル表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readKills(page: Page): Promise<number> {
  const text = await page.getByTestId("spore-surge-kills").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `撃破数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readHp(page: Page): Promise<number> {
  const text = await page.getByTestId("spore-surge-hp").innerText();
  const matched = text.match(/HP\s*(\d+)\/(\d+)/);
  expect(matched, `HP表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Spore Surge のストーリー", () => {
  test("遊び始めてから撃破を重ね、レベルアップの強化を選んで生き延びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: HUD が初期状態で出ている
    await expect(page.getByTestId("spore-surge-hp")).toBeVisible();
    expect(await readHp(page), "開始時のHPは満タン").toBe(100);
    expect(await readLevel(page), "開始時はレベル1").toBe(1);
    expect(await readKills(page), "開始時の撃破数は0").toBe(0);
    // スコアは生存時間にも応じて増えるため、起動直後は小さい値のはず（0固定ではない）
    expect(await readScore(page), "開始時のスコアはまだ小さい").toBeLessThan(20);

    // ドラッグで移動できる（このゲームの中心操作。攻撃は自動）
    const stage = page.getByTestId("game-shell-stage");
    await expectStageToAnimate(page, stage);
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.35, yRatio: 0.4 });
    await waitForFrames(page, 20);

    // 自動攻撃で影ダニを倒していく
    await expect
      .poll(() => readKills(page), { message: "自動攻撃で撃破数が増えていく", timeout: 30_000 })
      .toBeGreaterThan(0);

    // 花粉を集めてレベルアップすると、強化選択のオーバーレイが出て進行が止まる
    await expect
      .poll(() => readLevel(page), { message: "花粉を集めてレベル2になる", timeout: 45_000 })
      .toBeGreaterThanOrEqual(2);

    const upgradeOverlay = page.getByTestId("spore-surge-upgrade-overlay");
    await expect(upgradeOverlay).toBeVisible();
    const upgradeCards = page.locator('[data-testid^="spore-surge-upgrade-option-"]');
    await expect(upgradeCards).toHaveCount(3);

    const scoreBeforeChoice = await readScore(page);
    await waitForFrames(page, 30);
    expect(await readScore(page), "強化選択中はスコアが進まない").toBe(scoreBeforeChoice);

    // 強化を1つ選ぶと再開する
    await upgradeCards.first().click();
    await expect(upgradeOverlay).toBeHidden();

    await expect
      .poll(() => readScore(page), {
        message: "強化選択後はまたスコアが増えていく",
        timeout: 15_000,
      })
      .toBeGreaterThan(scoreBeforeChoice);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("spore-surge-hp")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    const scoreRunning = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "連打後も進行している" })
      .toBeGreaterThanOrEqual(scoreRunning);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const scorePaused = await readScore(page);
    const killsPaused = await readKills(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "連打後の一時停止も効いている").toBe(scorePaused);
    expect(await readKills(page), "一時停止中は撃破数も増えない").toBe(killsPaused);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("一時停止中はダメージも進行も止まり、再開すると続きから進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("game-shell-stage");
    await waitForFrames(page, 30);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedHp = await readHp(page);
    const pausedScore = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readHp(page), "一時停止中はHPが減らない").toBe(pausedHp);
    expect(await readScore(page), "一時停止中はスコアが進まない").toBe(pausedScore);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.3, yRatio: 0.6 });
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readScore(page), { message: "再開後はまたスコアが進む" })
      .toBeGreaterThanOrEqual(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
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

    // リサイズ後も操作を受け付けて進行する
    await dragOnStage(page, stage, { xRatio: 0.4, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.45 });
    const scoreAfterResize = await readScore(page);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後もゲームが進行する" })
      .toBeGreaterThanOrEqual(scoreAfterResize);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
