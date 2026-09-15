import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/firefly-sync";

async function readChorus(page: Page): Promise<number> {
  const value = await page.getByTestId("firefly-sync-chorus").getAttribute("data-chorus");
  expect(value, "合唱計の値が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readEnergy(page: Page): Promise<number> {
  const value = await page.getByTestId("firefly-sync-energy").getAttribute("data-energy");
  expect(value, "エネルギー値が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readRemaining(page: Page): Promise<number> {
  const value = await page.getByTestId("firefly-sync-timer").getAttribute("data-remaining");
  expect(value, "残り時間が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readNight(page: Page): Promise<number> {
  const value = await page.getByTestId("firefly-sync-night").getAttribute("data-night");
  expect(value, "夜番号が属性から読み取れる").not.toBeNull();
  return Number(value);
}

/** ステージの中央をクリックしてパルスを送る。 */
async function tapCenter(page: Page): Promise<void> {
  await page.getByTestId("firefly-sync-stage").click();
}

test.describe("Firefly Sync のストーリー", () => {
  test("パルスを送り続けると合唱計が進み、夜をクリアしてスコアが入る。一時停止・再開もできる", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("firefly-sync-night")).toHaveText("夜 1");
    const startingChorus = await readChorus(page);

    // エネルギーが尽きても弾かれるだけで、時間経過とともに回復して送れるようになる。
    // タップしながら夜が進むまで待つ(CPU負荷が高い環境でもフレームは進むが遅くなりうる)。
    await expect
      .poll(
        async () => {
          await tapCenter(page);
          return readNight(page);
        },
        { message: "1夜目をクリアして夜が進む", timeout: 90_000, intervals: [50] },
      )
      .toBeGreaterThan(1);

    const scoreText = await page.getByTestId("game-shell-score").innerText();
    expect(Number(scoreText.replace(/[^\d]/g, "")), "得点が入っている").toBeGreaterThan(0);
    expect(startingChorus, "開始時の合唱計は低い").toBeLessThan(50);

    // 一時停止すると残り時間もエネルギーも変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedRemaining = await readRemaining(page);
    const pausedEnergy = await readEnergy(page);
    await waitForFrames(page, 60);
    expect(await readRemaining(page), "一時停止中は残り時間が変化しない").toBe(pausedRemaining);
    expect(await readEnergy(page), "一時停止中はエネルギーも回復しない").toBe(pausedEnergy);

    // 再開すると再び進行する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await waitForFrames(page, 90);
    expect(await readRemaining(page), "再開後は残り時間が減る").toBeLessThan(pausedRemaining);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("何もせず時間切れになると日が沈んで終了し、リスタートで最初から遊べる", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const gameOver = page.getByTestId("firefly-sync-gameover");
    await expect(gameOver).toBeHidden();

    // 何も操作せず時間切れになるのを待つ(1夜目は40秒制限。CPU負荷が高い環境では
    // フレームの実時間ペースが落ちるため、実時間としては余裕を持って待つ)。
    await expect(gameOver).toBeVisible({ timeout: 150_000 });
    expect(await readNight(page), "1夜目のまま終了する").toBe(1);

    // 終了オーバーレイの下のキャンバスはクリックできない(オーバーレイに覆われている)。
    await expect(async () => {
      await page.getByTestId("firefly-sync-canvas").click({ timeout: 300 });
    }).rejects.toThrow();

    await page.getByTestId("firefly-sync-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readNight(page), "リスタートで1夜目に戻る").toBe(1);
    expect(await readChorus(page), "リスタートで合唱計もリセットされる").toBeLessThan(5);

    expect(errors, "終了・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("連打しても表示が壊れず、リサイズ後も操作を受け付ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("firefly-sync-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 高速連打(ほとんどはエネルギー切れで弾かれるはず)をしても表示が破綻しない。
    for (let i = 0; i < 25; i++) {
      await tapCenter(page);
    }
    await waitForFrames(page, 10);
    await expect(page.getByTestId("firefly-sync-energy")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後もパルスを受け付ける(エネルギーが回復しているはず)。
    await waitForFrames(page, 60);
    const before = await readChorus(page);
    for (let i = 0; i < 8; i++) {
      await tapCenter(page);
      await waitForFrames(page, 6);
    }
    await expect
      .poll(() => readChorus(page), { message: "リサイズ後も合唱計が進む" })
      .toBeGreaterThanOrEqual(before);

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
