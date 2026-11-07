import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/tsunahiki";
// engine/world.ts の ROPE_START / ROPE_MAX と一致させる想定の初期値。
const EXPECTED_ROPE_START = 50;
const EXPECTED_ROPE_MAX = 100;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRope(page: Page): Promise<number> {
  const text = await page.getByTestId("tsunahiki-rope").innerText();
  const matched = text.match(/(\d+)\s*\/\s*(\d+)/);
  expect(matched, `綱の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("tsunahiki-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンドの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/**
 * PULL!ボタンへ直接 pointerdown を発火させる。一時停止オーバーレイや
 * ゲームオーバーオーバーレイがボタンの上に重なっている状況でも、
 * Playwright の actionability チェックに阻まれず操作そのものを検証できるようにするため、
 * Locator.click() ではなく DOM API を直接叩いている。
 */
async function pressPull(page: Page): Promise<void> {
  await page.evaluate((testId) => {
    const button = document.querySelector(`[data-testid="${testId}"]`);
    button?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  }, "tsunahiki-pull");
  await waitForFrames(page, 4);
}

/**
 * 掛け声の判定窓(判定リングに玉が重なる瞬間)を待ち、その場で(ブラウザ内の同じ
 * フレーム処理の中で)PULL!ボタンを叩く。Node側との往復を挟むと判定窓(数百ミリ秒)を
 * 容易に逃してテストが不安定になるため、「待つ」と「叩く」を1回の page.evaluate 内で
 * 完結させている。
 */
async function pullWhenReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const hint = document.querySelector('[data-testid="tsunahiki-ready"]') as HTMLElement | null;
      if (!hint) {
        reject(new Error("tsunahiki-ready 要素が見つからない"));
        return;
      }
      let frames = 0;
      const tick = (): void => {
        if (hint.dataset.inZone === "true") {
          const button = document.querySelector(
            '[data-testid="tsunahiki-pull"]',
          ) as HTMLElement | null;
          if (!button) {
            reject(new Error("tsunahiki-pull ボタンが見つからない"));
            return;
          }
          button.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
            }),
          );
          resolve();
          return;
        }
        frames += 1;
        if (frames > 600) {
          reject(new Error("判定窓に入った掛け声を検出できないままタイムアウトした"));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await waitForFrames(page, 4);
}

test.describe("Tsunahiki のストーリー", () => {
  test("起動直後は綱が中央でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("tsunahiki-rope")).toBeVisible();
    await expect(page.getByTestId("tsunahiki-round")).toBeVisible();
    await expect(page.getByTestId("tsunahiki-pull")).toBeVisible();
    await expect(page.getByTestId("tsunahiki-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRope(page), "開始時の綱は中央").toBe(EXPECTED_ROPE_START);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("正しいタイミングでPULLし続けると得点が積み上がり綱が自陣側に進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const ropeBefore = await readRope(page);
    const roundBefore = await readRound(page);

    for (let i = 0; i < 6; i++) {
      await pullWhenReady(page);
    }

    expect(await readScore(page), "正解を積み重ねると得点が増える").toBeGreaterThan(scoreBefore);
    const ropeAfter = await readRope(page);
    const roundAfter = await readRound(page);
    expect(
      ropeAfter > ropeBefore || roundAfter > roundBefore,
      "正解し続けると綱が自陣側に進むか、ラウンドをクリアする",
    ).toBe(true);

    expect(errors, "連続正解中にエラーが出ていない").toEqual([]);
  });

  test("タイミングを外してPULLするとミスになり綱が相手側に戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const ropeBefore = await readRope(page);
    // 判定窓が来る前にすぐ叩き、わざとタイミングミスを起こす。
    await pressPull(page);

    expect(await readRope(page), "タイミングを外すと綱が相手側に戻る").toBeLessThan(ropeBefore);

    expect(errors, "ミス操作でエラーが出ていない").toEqual([]);
  });

  test("何もPULLせず掛け声を見逃すと綱が相手側に戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const ropeBefore = await readRope(page);
    // 固定時間の待機ではなく、綱が実際に動くまで(見逃しミスが発生するまで)待つ。
    let latestRope = ropeBefore;
    await expect
      .poll(
        async () => {
          latestRope = await readRope(page);
          return latestRope;
        },
        { intervals: [50], timeout: 15000 },
      )
      .toBeLessThan(ropeBefore);

    expect(latestRope, "見逃しで綱が相手側に戻る").toBeLessThan(ropeBefore);

    expect(errors, "見逃し待機中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はPULLしても得点や綱が変化せず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const ropeWhilePaused = await readRope(page);

    await pressPull(page);
    await pressPull(page);

    expect(await readScore(page), "一時停止中はPULLしても得点が変わらない").toBe(scoreWhilePaused);
    expect(await readRope(page), "一時停止中はPULLしても綱が変わらない").toBe(ropeWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const scoreAfterResume = await readScore(page);
    const ropeAfterResume = await readRope(page);
    await pressPull(page);
    const scoreAfterPull = await readScore(page);
    const ropeAfterPull = await readRope(page);
    expect(
      scoreAfterPull > scoreAfterResume || ropeAfterPull !== ropeAfterResume,
      "再開後は操作で得点か綱に変化が起きる",
    ).toBe(true);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("綱が尽きるまでミスを重ねると結果画面が出て、もう一度あそぶで最初から遊べる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("tsunahiki-gameover");

    for (let i = 0; i < 30 && !(await gameOver.isVisible()); i++) {
      // 判定窓を待たずに即座に叩くと確実にタイミングミスになる。
      await pressPull(page);
    }

    await expect(gameOver, "ミスを繰り返すとゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);
    expect(await readRope(page), "ゲームオーバー時の綱は0").toBe(0);

    await page.getByTestId("tsunahiki-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readRope(page), "リスタートで綱が中央に戻る").toBe(EXPECTED_ROPE_START);
    expect(await readRound(page), "リスタートでラウンドが1に戻る").toBe(1);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 20; i++) {
      await pressPull(page);
    }
    await waitForFrames(page, 10);

    const rope = await readRope(page);
    expect(rope, "連打しても綱は0未満にならない").toBeGreaterThanOrEqual(0);
    expect(rope, "連打しても綱は上限を超えない").toBeLessThanOrEqual(EXPECTED_ROPE_MAX);
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("キャンバスをタップしてもPULLとして反映される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("tsunahiki-stage");
    const canvas = page.getByTestId("tsunahiki-canvas").locator("canvas");
    await expect(canvas).toBeVisible();

    const ropeBefore = await readRope(page);
    await canvas.click();
    await waitForFrames(page, 4);

    expect(await readRope(page), "キャンバスのタップがPULL操作として反映される").toBeLessThan(
      ropeBefore,
    );
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "キャンバス操作中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("tsunahiki-rope")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const ropeBefore = await readRope(page);
    await pressPull(page);
    const ropeAfter = await readRope(page);
    expect(ropeAfter, "リサイズ後も操作の効果が出る").not.toBe(ropeBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
