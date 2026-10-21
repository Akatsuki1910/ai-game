import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/taiko-pulse";
// engine/world.ts の START_LIVES と一致させる想定の初期ライフ数。
const EXPECTED_START_LIVES = 5;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("taiko-pulse-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readStage(page: Page): Promise<number> {
  const text = await page.getByTestId("taiko-pulse-stage-label").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ステージの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/**
 * DON/KATSUボタンへ直接 pointerdown を発火させる。一時停止オーバーレイや
 * ゲームオーバーオーバーレイがボタンの上に重なっている状況でも、
 * Playwright の actionability チェック(「要素が遮られていないか」)に
 * 阻まれず操作そのものを検証できるようにするため、Locator.click() ではなく
 * DOM API を直接叩いている。
 */
async function pressButton(page: Page, type: "don" | "katsu"): Promise<void> {
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
  }, `taiko-pulse-${type}`);
  await waitForFrames(page, 4);
}

/**
 * 音符が判定窓に入る瞬間を待ち、その場で(ブラウザ内の同じフレーム処理の中で)
 * ボタンを叩く。Node側との往復(Playwrightのポーリング→別の往復でクリック)を
 * 挟むと、判定窓(数百ミリ秒)を容易に逃してテストが不安定になるため、
 * 「待つ」と「叩く」を1回の page.evaluate 内で完結させている。
 * mode: "correct" は現在の音符と同じボタン、"wrong" はわざと逆のボタンを叩く。
 */
async function tapWhenReady(page: Page, mode: "correct" | "wrong"): Promise<"don" | "katsu"> {
  const type = await page.evaluate((tapMode) => {
    return new Promise<"don" | "katsu">((resolve, reject) => {
      const hint = document.querySelector(
        '[data-testid="taiko-pulse-ready"]',
      ) as HTMLElement | null;
      if (!hint) {
        reject(new Error("taiko-pulse-ready 要素が見つからない"));
        return;
      }
      let frames = 0;
      const tick = (): void => {
        const readyType = hint.dataset.readyType;
        if (readyType === "don" || readyType === "katsu") {
          const pressType =
            tapMode === "correct" ? readyType : readyType === "don" ? "katsu" : "don";
          const button = document.querySelector(
            `[data-testid="taiko-pulse-${pressType}"]`,
          ) as HTMLElement | null;
          if (!button) {
            reject(new Error(`taiko-pulse-${pressType} ボタンが見つからない`));
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
          resolve(readyType);
          return;
        }
        frames += 1;
        if (frames > 600) {
          reject(new Error("判定窓に入った音符を検出できないままタイムアウトした"));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, mode);
  await waitForFrames(page, 4);
  return type;
}

/** 判定窓に入った瞬間に、現在の音符と同じボタンを叩いて正解させる。 */
async function hitCorrectly(page: Page): Promise<void> {
  await tapWhenReady(page, "correct");
}

/** 判定窓に入った瞬間に、わざと逆のボタンを叩いてミスを起こす。 */
async function hitWrongly(page: Page): Promise<void> {
  await tapWhenReady(page, "wrong");
}

test.describe("Taiko Pulse のストーリー", () => {
  test("起動直後はステージ1・満タンのライフでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("taiko-pulse-stage-label")).toBeVisible();
    await expect(page.getByTestId("taiko-pulse-lives")).toBeVisible();
    await expect(page.getByTestId("taiko-pulse-don")).toBeVisible();
    await expect(page.getByTestId("taiko-pulse-katsu")).toBeVisible();
    await expect(page.getByTestId("taiko-pulse-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readStage(page), "開始時はステージ1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("正しいタイミングで正しいボタンを叩き続けると得点が積み上がりライフは減らない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const livesBefore = await readLives(page);

    for (let i = 0; i < 6; i++) {
      await hitCorrectly(page);
    }

    expect(await readScore(page), "正解を積み重ねると得点が増える").toBeGreaterThan(scoreBefore);
    expect(await readLives(page), "正解し続けている間はライフが減らない").toBe(livesBefore);

    expect(errors, "連続正解中にエラーが出ていない").toEqual([]);
  });

  test("わざと違うボタンを叩くとミスになりライフが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const livesBefore = await readLives(page);
    await hitWrongly(page);

    expect(await readLives(page), "わざと違うボタンを押すとライフが減る").toBe(livesBefore - 1);

    expect(errors, "ミス操作でエラーが出ていない").toEqual([]);
  });

  test("何も押さずに見逃すとライフが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const livesBefore = await readLives(page);
    // 固定時間の待機ではなく、ライフが実際に減るまで(見逃しミスが発生するまで)待つ。
    // ポーリング間隔を短くし、1回の見逃しで止まった直後の値を捉えて過剰なミスの
    // 混入(ポーリング間隔が粗く複数回分の見逃しをまたいでしまうこと)を防ぐ。
    let latestLives = livesBefore;
    await expect
      .poll(
        async () => {
          latestLives = await readLives(page);
          return latestLives;
        },
        { intervals: [50], timeout: 10000 },
      )
      .toBeLessThan(livesBefore);

    expect(latestLives, "何も操作しないと見逃しでライフがちょうど1つ減る").toBe(livesBefore - 1);

    expect(errors, "見逃し待機中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は叩いてもスコアやライフが変化せず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);

    await pressButton(page, "don");
    await pressButton(page, "katsu");

    expect(await readScore(page), "一時停止中は叩いても得点が変わらない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中は叩いてもライフが変わらない").toBe(livesWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const scoreAfterResume = await readScore(page);
    const livesAfterResume = await readLives(page);
    await hitWrongly(page);
    const scoreAfterHit = await readScore(page);
    const livesAfterHit = await readLives(page);
    expect(
      scoreAfterHit > scoreAfterResume || livesAfterHit < livesAfterResume,
      "再開後は操作で得点かライフに変化が起きる",
    ).toBe(true);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("ゲームオーバーになるまでミスを重ねると結果画面が出て、もう一度あそぶで最初から遊べる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("taiko-pulse-gameover");

    for (let i = 0; i < EXPECTED_START_LIVES && !(await gameOver.isVisible()); i++) {
      await hitWrongly(page);
    }

    await expect(gameOver, "ライフ分だけわざと外すとゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("taiko-pulse-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);
    expect(await readStage(page), "リスタートでステージ1に戻る").toBe(1);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 10; i++) {
      await pressButton(page, "don");
      await pressButton(page, "katsu");
    }
    await waitForFrames(page, 10);

    expect(await readLives(page), "連打してもライフは0未満にならない").toBeGreaterThanOrEqual(0);
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("taiko-pulse-stage-label")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const scoreBefore = await readScore(page);
    const livesBefore = await readLives(page);
    await hitWrongly(page);
    const scoreAfter = await readScore(page);
    const livesAfter = await readLives(page);
    expect(
      scoreAfter > scoreBefore || livesAfter < livesBefore,
      "リサイズ後も操作の効果が出る",
    ).toBe(true);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
