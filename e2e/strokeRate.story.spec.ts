import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/stroke-rate";
const EXPECTED_START_LIVES = 3;
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("stroke-rate-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

async function readRhythmPercent(page: Page): Promise<number> {
  const style = await page
    .getByTestId("stroke-rate-rhythm")
    .locator("div")
    .first()
    .getAttribute("style");
  const match = style?.match(/width:\s*([\d.]+)%/);
  return match ? Number(match[1]) : 0;
}

async function waitForCanvas(page: Page): Promise<Locator> {
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();
  return stage;
}

/**
 * `page.waitForTimeout` を挟む手動ポーリングで待つ。homing-arc 等と同様、
 * requestAnimationFrame ループと expect.poll の相性問題を避けるため。
 */
async function waitUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  page: Page,
  message: string,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<T> {
  const start = Date.now();
  let value = await read();
  while (!predicate(value) && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    value = await read();
  }
  expect(predicate(value), message).toBe(true);
  return value;
}

/** 左右交互に、良い判定になる間隔(0.4秒程度)でオールボタンを押し続ける。 */
async function rowSteadily(page: Page, strokes: number, intervalMs = 400): Promise<void> {
  const left = page.getByTestId("stroke-rate-oar-left");
  const right = page.getByTestId("stroke-rate-oar-right");
  for (let i = 0; i < strokes; i++) {
    await (i % 2 === 0 ? left : right).click();
    await page.waitForTimeout(intervalMs);
  }
}

test.describe("Stroke Rate のストーリー", () => {
  test("起動直後は満タンのライフ・スコア0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("stroke-rate-gameover")).toBeHidden();

    // 艇は常に現在(ベース速度)で流され続けるため、読み取るまでのわずかな時間でも
    // スコアが(常に)増え得る。厳密な0ではなく「ごく小さい値」であることを確認する。
    expect(await readScore(page), "開始直後のスコアはごく小さい").toBeLessThan(20);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    await waitForCanvas(page);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("何もしなくても艇は流れで自然に進み、スコアが伸びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    await waitUntil(
      () => readScore(page),
      (score) => score > 0,
      page,
      "何もせず待つだけでもスコアが伸びる(常に一定速度で流される)",
    );

    expect(errors, "待機中にエラーが出ていない").toEqual([]);
  });

  test("左右交互にオールボタンを押すとリズムが上がる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    const rhythmBefore = await readRhythmPercent(page);
    await rowSteadily(page, 6);

    const rhythmAfter = await readRhythmPercent(page);
    expect(rhythmAfter, "交互に漕ぐとリズムが上がる").toBeGreaterThan(rhythmBefore);
    await expect(page.getByTestId("stroke-rate-combo")).not.toContainText("COMBO 0");

    expect(errors, "オールを漕ぐ操作中にエラーが出ていない").toEqual([]);
  });

  test("同じ側を連打するとコンボが切れる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    await rowSteadily(page, 4);
    await expect(page.getByTestId("stroke-rate-combo")).not.toContainText("COMBO 0");

    const left = page.getByTestId("stroke-rate-oar-left");
    await left.click();
    await page.waitForTimeout(300);
    await left.click();

    await expect(page.getByTestId("stroke-rate-combo")).toContainText("COMBO 0");

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("キャンバスの左半分/右半分をクリックしても漕げる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      const leftX = box.x + box.width * 0.2;
      const rightX = box.x + box.width * 0.8;
      const y = box.y + box.height * 0.5;
      for (let i = 0; i < 6; i++) {
        await page.mouse.click(i % 2 === 0 ? leftX : rightX, y);
        await page.waitForTimeout(400);
      }
    }

    await expect(page.getByTestId("stroke-rate-combo")).not.toContainText("COMBO 0");
    expect(errors, "キャンバス操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はスコアが進まず、操作しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが進まない").toBe(scoreWhilePaused);

    // 一時停止中にオールボタンを押しても反応しない(オーバーレイが覆っている)
    await page
      .getByTestId("stroke-rate-oar-left")
      .click({ force: true, trial: false })
      .catch(() => {});
    expect(await readScore(page), "一時停止中の操作でスコアが変わらない").toBe(scoreWhilePaused);

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "一時停止・連打中にエラーが出ていない").toEqual([]);
  });

  test("流木に当たり続けてゲームオーバーになっても、遠くまで進めても、壊れずに進行してリスタートできる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);
    const gameOver = page.getByTestId("stroke-rate-gameover");

    // 流木のレーン位置は乱数で決まるため、特定回数で必ずゲームオーバーになるとは
    // 保証できない。blackoutFerry 等と同様に「ゲームオーバーになるか、十分遠くまで
    // 進むかのどちらかに至る」ことを、実際の操作(オールを漕ぎ続ける)で確認する。
    const left = page.getByTestId("stroke-rate-oar-left");
    const right = page.getByTestId("stroke-rate-oar-right");
    let reachedOutcome = false;
    for (let i = 0; i < 80 && !reachedOutcome; i++) {
      // ゲームオーバーの演出がちょうどこの瞬間に表示されると、オーバーレイが
      // ボタンのクリックを奪って actionability 待ちが長時間ブロックされてしまう
      // (再試行がテスト全体のタイムアウトまで続く)。短いタイムアウトで諦めて、
      // 直後の isVisible() チェックで確実にループを抜けられるようにする。
      await (i % 2 === 0 ? left : right).click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(350);

      if (await gameOver.isVisible()) {
        reachedOutcome = true;
        break;
      }
      if ((await readScore(page)) > 3000) {
        reachedOutcome = true;
        break;
      }
    }

    expect(reachedOutcome, "ゲームオーバーになるか、十分な距離まで進むかのどちらかに至る").toBe(
      true,
    );

    if (await gameOver.isVisible()) {
      expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);
      await page.getByTestId("stroke-rate-restart").click();
      await expect(gameOver).toBeHidden();
      // 艇は常に流され続けるため、クリック直後の読み取りまでの間にもスコアが
      // わずかに増え得る。「0に戻った」ではなく「ごく小さい値に戻った」で確認する。
      expect(await readScore(page), "リスタートでスコアがごく小さい値に戻る").toBeLessThan(20);
      expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);
    } else {
      await expect(page.getByTestId("stroke-rate-lives")).toBeVisible();
    }

    expect(errors, "進行中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も漕げる
    await rowSteadily(page, 4);
    await expect(page.getByTestId("stroke-rate-combo")).not.toContainText("COMBO 0");

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
