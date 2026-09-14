import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/loom-weave";

async function readProgress(page: Page): Promise<number> {
  const text = await page.getByTestId("loom-weave-progress").innerText();
  const matched = text.match(/(\d+)\s*\/\s*\d+/);
  expect(matched, `段数表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readIntegrity(page: Page): Promise<number> {
  const value = await page.getByTestId("loom-weave-integrity").getAttribute("data-integrity");
  expect(value, "耐久値が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readActiveColor(page: Page): Promise<string> {
  const value = await page.getByTestId("loom-weave-active-color").getAttribute("data-color");
  expect(value, "現在の指示色が読み取れる").not.toBeNull();
  return value ?? "";
}

/** 表示されている指示色のボタンを1回押す。 */
async function pressActiveColorButton(page: Page): Promise<void> {
  const color = await readActiveColor(page);
  await page.getByTestId(`loom-weave-button-${color}`).click();
}

/** 常に間違った色のボタンを押してミスを連発させる。 */
async function pressWrongColorButton(page: Page): Promise<void> {
  const active = await readActiveColor(page);
  const colors = ["indigo", "gold", "crimson"];
  const wrong = colors.find((color) => color !== active);
  expect(wrong, "指示色以外の色が見つかる").toBeDefined();
  await page.getByTestId(`loom-weave-button-${wrong}`).click();
}

test.describe("Loom Weave のストーリー", () => {
  test("正解を選び続けると段数とスコアが進み、一時停止・再開もできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("loom-weave-active-color")).toBeVisible();

    const startingProgress = await readProgress(page);
    expect(startingProgress, "開始時は0段").toBe(0);

    // 正解を数回選び続けて進行することを確認する。
    for (let i = 0; i < 4; i++) {
      await pressActiveColorButton(page);
      await waitForFrames(page, 5);
    }

    await expect
      .poll(() => readProgress(page), { message: "段数が進む" })
      .toBeGreaterThan(startingProgress);

    const scoreText = await page.getByTestId("game-shell-score").innerText();
    expect(Number(scoreText.replace(/[^\d]/g, "")), "得点が入っている").toBeGreaterThan(0);

    // 一時停止するとリングが止まり、耐久が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedIntegrity = await readIntegrity(page);
    await waitForFrames(page, 60);
    expect(await readIntegrity(page), "一時停止中は耐久が変化しない").toBe(pausedIntegrity);
    const pausedProgress = await readProgress(page);
    expect(await readProgress(page), "一時停止中は段数も進まない").toBe(pausedProgress);

    // 再開すると再び進行する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    for (let i = 0; i < 3; i++) {
      await pressActiveColorButton(page);
      await waitForFrames(page, 5);
    }
    await expect
      .poll(() => readProgress(page), { message: "再開後も段数が進む" })
      .toBeGreaterThan(pausedProgress);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("外し続けると耐久が尽きて生地が破れ、リスタートで最初から遊べる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("loom-weave-active-color")).toBeVisible();

    // 5回外せば耐久0で必ず終了する(ミス1回で20減、開始100)。
    for (let i = 0; i < 6; i++) {
      const gameOver = page.getByTestId("loom-weave-gameover");
      if (await gameOver.isVisible().catch(() => false)) break;
      await pressWrongColorButton(page);
      await waitForFrames(page, 5);
    }

    await expect(page.getByTestId("loom-weave-gameover")).toBeVisible();
    expect(await readIntegrity(page), "耐久が0になっている").toBe(0);

    // 終了オーバーレイが全画面を覆い、下の色ボタンをクリックできない
    // (実際のユーザーも操作できなくなっていることの確認)。
    await expect(async () => {
      await page.getByTestId("loom-weave-button-indigo").click({ timeout: 300 });
    }).rejects.toThrow();

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("loom-weave-restart").click();
    await expect(page.getByTestId("loom-weave-gameover")).toBeHidden();
    expect(await readProgress(page), "リスタートで段数がリセットされる").toBe(0);
    expect(await readIntegrity(page), "リスタートで耐久が全回復する").toBe(100);

    expect(errors, "破損・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("連打しても表示が壊れず、リサイズ後も操作を受け付ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("loom-weave-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // ボタン連打(正解・不正解入り混じり)をしても表示が破綻しない。
    // 途中で生地が破れて終了オーバーレイが出た場合はリスタートしてから続ける
    // (オーバーレイ表示中はボタンへのクリックが届かないのが正しい挙動のため)。
    const colors = ["indigo", "gold", "crimson"] as const;
    const gameOver = page.getByTestId("loom-weave-gameover");
    for (let i = 0; i < 30; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("loom-weave-restart").click();
        continue;
      }
      await page.getByTestId(`loom-weave-button-${colors[i % colors.length]}`).click();
    }
    await waitForFrames(page, 10);
    await expect(page.getByTestId("loom-weave-progress")).toBeVisible();

    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("loom-weave-restart").click();
    }

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("loom-weave-button-indigo")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける。
    if (!(await gameOver.isVisible().catch(() => false))) {
      const before = await readProgress(page);
      await pressActiveColorButton(page);
      await expect
        .poll(() => readProgress(page), { message: "リサイズ後も進行する" })
        .toBeGreaterThan(before);
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
