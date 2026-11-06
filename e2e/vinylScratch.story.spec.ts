import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/vinyl-scratch";
// engine/world.ts の START_HYPE と一致させる想定の初期ハイプ。
const EXPECTED_START_HYPE = 100;

type ScratchDirection = "forward" | "back";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readHype(page: Page): Promise<number> {
  const text = await page.getByTestId("vinyl-scratch-hype").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ハイプの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/**
 * BACK/FORWARDボタンへ直接 pointerdown を発火させる。一時停止オーバーレイや
 * ゲームオーバーオーバーレイがボタンの上に重なっている状況でも、
 * Playwright の actionability チェックに阻まれず操作そのものを検証できるようにするため、
 * Locator.click() ではなく DOM API を直接叩いている。
 */
async function pressButton(page: Page, direction: ScratchDirection): Promise<void> {
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
  }, `vinyl-scratch-${direction}`);
  await waitForFrames(page, 4);
}

/**
 * キューが判定窓に入る瞬間を待ち、その場で(ブラウザ内の同じフレーム処理の中で)
 * ボタンを叩く。Node側との往復を挟むと判定窓(数百ミリ秒)を容易に逃してテストが
 * 不安定になるため、「待つ」と「叩く」を1回の page.evaluate 内で完結させている。
 * mode: "correct" は現在のキューと同じ方向、"wrong" はわざと逆方向を叩く。
 */
async function tapWhenReady(page: Page, mode: "correct" | "wrong"): Promise<ScratchDirection> {
  const direction = await page.evaluate((tapMode) => {
    return new Promise<ScratchDirection>((resolve, reject) => {
      const hint = document.querySelector(
        '[data-testid="vinyl-scratch-ready"]',
      ) as HTMLElement | null;
      if (!hint) {
        reject(new Error("vinyl-scratch-ready 要素が見つからない"));
        return;
      }
      let frames = 0;
      const tick = (): void => {
        const readyDirection = hint.dataset.readyDirection;
        if (readyDirection === "forward" || readyDirection === "back") {
          const pressDirection: ScratchDirection =
            tapMode === "correct"
              ? readyDirection
              : readyDirection === "forward"
                ? "back"
                : "forward";
          const button = document.querySelector(
            `[data-testid="vinyl-scratch-${pressDirection}"]`,
          ) as HTMLElement | null;
          if (!button) {
            reject(new Error(`vinyl-scratch-${pressDirection} ボタンが見つからない`));
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
          resolve(readyDirection);
          return;
        }
        frames += 1;
        if (frames > 600) {
          reject(new Error("判定窓に入ったキューを検出できないままタイムアウトした"));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, mode);
  await waitForFrames(page, 4);
  return direction;
}

/** 判定窓に入った瞬間に、現在のキューと同じ方向を叩いて正解させる。 */
async function hitCorrectly(page: Page): Promise<void> {
  await tapWhenReady(page, "correct");
}

/** 判定窓に入った瞬間に、わざと逆方向を叩いてミスを起こす。 */
async function hitWrongly(page: Page): Promise<void> {
  await tapWhenReady(page, "wrong");
}

test.describe("Vinyl Scratch のストーリー", () => {
  test("起動直後は満タンのハイプでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("vinyl-scratch-hype")).toBeVisible();
    await expect(page.getByTestId("vinyl-scratch-back")).toBeVisible();
    await expect(page.getByTestId("vinyl-scratch-forward")).toBeVisible();
    await expect(page.getByTestId("vinyl-scratch-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readHype(page), "開始時はハイプが満タン").toBe(EXPECTED_START_HYPE);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("正しいタイミングで正しい方向へ擦り続けると得点が積み上がりハイプは減らない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const hypeBefore = await readHype(page);

    for (let i = 0; i < 6; i++) {
      await hitCorrectly(page);
    }

    expect(await readScore(page), "正解を積み重ねると得点が増える").toBeGreaterThan(scoreBefore);
    expect(await readHype(page), "正解し続けている間はハイプが減らない").toBeGreaterThanOrEqual(
      hypeBefore,
    );

    expect(errors, "連続正解中にエラーが出ていない").toEqual([]);
  });

  test("わざと違う方向へ擦るとミスになりハイプが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const hypeBefore = await readHype(page);
    await hitWrongly(page);

    expect(await readHype(page), "わざと違う方向へ擦るとハイプが減る").toBeLessThan(hypeBefore);

    expect(errors, "ミス操作でエラーが出ていない").toEqual([]);
  });

  test("何も擦らずに見逃すとハイプが減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const hypeBefore = await readHype(page);
    // 固定時間の待機ではなく、ハイプが実際に減るまで(見逃しミスが発生するまで)待つ。
    let latestHype = hypeBefore;
    await expect
      .poll(
        async () => {
          latestHype = await readHype(page);
          return latestHype;
        },
        { intervals: [50], timeout: 10000 },
      )
      .toBeLessThan(hypeBefore);

    expect(latestHype, "見逃しでハイプが減る").toBeLessThan(hypeBefore);

    expect(errors, "見逃し待機中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は叩いても得点やハイプが変化せず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const hypeWhilePaused = await readHype(page);

    await pressButton(page, "forward");
    await pressButton(page, "back");

    expect(await readScore(page), "一時停止中は叩いても得点が変わらない").toBe(scoreWhilePaused);
    expect(await readHype(page), "一時停止中は叩いてもハイプが変わらない").toBe(hypeWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const scoreAfterResume = await readScore(page);
    const hypeAfterResume = await readHype(page);
    await hitWrongly(page);
    const scoreAfterHit = await readScore(page);
    const hypeAfterHit = await readHype(page);
    expect(
      scoreAfterHit > scoreAfterResume || hypeAfterHit < hypeAfterResume,
      "再開後は操作で得点かハイプに変化が起きる",
    ).toBe(true);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("ハイプが尽きるまでミスを重ねると結果画面が出て、もう一度あそぶで最初から遊べる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("vinyl-scratch-gameover");

    for (let i = 0; i < 20 && !(await gameOver.isVisible()); i++) {
      await hitWrongly(page);
    }

    await expect(gameOver, "ミスを繰り返すとゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("vinyl-scratch-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readHype(page), "リスタートでハイプが満タンに戻る").toBe(EXPECTED_START_HYPE);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 10; i++) {
      await pressButton(page, "forward");
      await pressButton(page, "back");
    }
    await waitForFrames(page, 10);

    expect(await readHype(page), "連打してもハイプは0未満にならない").toBeGreaterThanOrEqual(0);
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("キャンバスをドラッグして擦る操作でも状態が変化し、壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("vinyl-scratch-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const hypeBefore = await readHype(page);

    for (let i = 0; i < 8; i++) {
      const toRatio = i % 2 === 0 ? 0.75 : 0.25;
      await dragOnStage(
        page,
        stage,
        { xRatio: 0.5, yRatio: 0.7 },
        { xRatio: toRatio, yRatio: 0.7 },
      );
      await waitForFrames(page, 4);
    }

    const scoreAfter = await readScore(page);
    const hypeAfter = await readHype(page);
    expect(
      scoreAfter > scoreBefore || hypeAfter < hypeBefore,
      "キャンバスのドラッグ操作がスクラッチとして反映される",
    ).toBe(true);
    await expect(stage.locator("canvas"), "ドラッグ後もキャンバスが生きている").toBeVisible();

    expect(errors, "ドラッグ操作中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("vinyl-scratch-hype")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const scoreBefore = await readScore(page);
    const hypeBefore = await readHype(page);
    await hitWrongly(page);
    const scoreAfter = await readScore(page);
    const hypeAfter = await readHype(page);
    expect(scoreAfter > scoreBefore || hypeAfter < hypeBefore, "リサイズ後も操作の効果が出る").toBe(
      true,
    );

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
