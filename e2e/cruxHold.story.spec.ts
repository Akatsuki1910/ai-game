import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/crux-hold";
// engine/world.ts の START_GRIP と一致させる想定の初期腕力。
const EXPECTED_START_GRIP = 100;

type Hand = "left" | "right";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readHeight(page: Page): Promise<number> {
  const text = await page.getByTestId("crux-hold-height").innerText();
  const matched = text.match(/([\d.]+)/);
  expect(matched, `高度の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readGrip(page: Page, hand: Hand): Promise<number> {
  const value = await page.getByTestId(`crux-hold-${hand}-grip`).getAttribute("data-grip");
  expect(value, `${hand}の腕力が属性から読み取れる`).not.toBeNull();
  return Number(value);
}

/**
 * 要求された側のホールドが当たり帯(data-in-window="true")に入った瞬間を待ち、
 * その場で(ブラウザ内の同じフレーム処理の中で)ボタンを叩く。Node側との往復を
 * 挟むと当たり帯(1秒前後)を逃してテストが不安定になるため、「待つ」と「叩く」を
 * 1回の page.evaluate 内で完結させている。
 * mode: "correct" は要求されている手、"wrong" はわざと反対の手を叩く。
 */
async function tapWhenReady(page: Page, mode: "correct" | "wrong"): Promise<Hand> {
  const requiredHand = await page.evaluate((tapMode) => {
    return new Promise<Hand>((resolve, reject) => {
      const hint = document.querySelector(
        '[data-testid="crux-hold-grab-hint"]',
      ) as HTMLElement | null;
      if (!hint) {
        reject(new Error("crux-hold-grab-hint 要素が見つからない"));
        return;
      }
      let frames = 0;
      const tick = (): void => {
        const required = hint.dataset.requiredHand;
        const inWindow = hint.dataset.inWindow === "true";
        if (inWindow && (required === "left" || required === "right")) {
          const pressHand: Hand =
            tapMode === "correct" ? required : required === "left" ? "right" : "left";
          const button = document.querySelector(
            `[data-testid="crux-hold-${pressHand}-button"]`,
          ) as HTMLElement | null;
          if (!button) {
            reject(new Error(`crux-hold-${pressHand}-button ボタンが見つからない`));
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
          resolve(required);
          return;
        }
        frames += 1;
        if (frames > 600) {
          reject(new Error("当たり帯に入ったホールドを検出できないままタイムアウトした"));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, mode);
  await waitForFrames(page, 4);
  return requiredHand;
}

/** 当たり帯に入った瞬間に、要求されている側の手を叩いて正解させる。 */
async function grabCorrectly(page: Page): Promise<void> {
  await tapWhenReady(page, "correct");
}

/** 当たり帯に入った瞬間に、わざと反対の手を叩いてミスを起こす。 */
async function grabWrongly(page: Page): Promise<void> {
  await tapWhenReady(page, "wrong");
}

/** ポーズ/ゲームオーバーのオーバーレイに重なっていても操作そのものを検証するため、DOM APIで直接叩く。 */
async function pressButton(page: Page, hand: Hand): Promise<void> {
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
  }, `crux-hold-${hand}-button`);
  await waitForFrames(page, 4);
}

test.describe("Crux Hold のストーリー", () => {
  test("起動直後はスコア0・高度0・両腕満タンでHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("crux-hold-height")).toBeVisible();
    await expect(page.getByTestId("crux-hold-left-grip")).toBeVisible();
    await expect(page.getByTestId("crux-hold-right-grip")).toBeVisible();
    await expect(page.getByTestId("crux-hold-left-button")).toBeVisible();
    await expect(page.getByTestId("crux-hold-right-button")).toBeVisible();
    await expect(page.getByTestId("crux-hold-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readHeight(page), "開始時の高度は0").toBe(0);
    // アンカー側の腕力はゲーム開始と同時に(ページ読み込みの実時間ぶん)減り始めるため、
    // 厳密な満タンではなく「まだ十分に残っている」ことを確認する。
    expect(await readGrip(page, "left"), "開始直後は左腕がまだ十分に残っている").toBeGreaterThan(
      60,
    );
    expect(await readGrip(page, "left")).toBeLessThanOrEqual(EXPECTED_START_GRIP);
    expect(await readGrip(page, "right"), "開始直後は右腕がまだ十分に残っている").toBeGreaterThan(
      60,
    );
    expect(await readGrip(page, "right")).toBeLessThanOrEqual(EXPECTED_START_GRIP);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("要求された手を当たり帯で掴み続けると得点と高度が増える", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const heightBefore = await readHeight(page);

    for (let i = 0; i < 5; i++) {
      await grabCorrectly(page);
    }

    expect(await readScore(page), "正解を積み重ねると得点が増える").toBeGreaterThan(scoreBefore);
    expect(await readHeight(page), "正解を積み重ねると高度が増える").toBeGreaterThan(heightBefore);

    expect(errors, "連続正解中にエラーが出ていない").toEqual([]);
  });

  test("わざと反対の手を叩くとミスになりアンカー側の腕力が減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const leftBefore = await readGrip(page, "left");
    const rightBefore = await readGrip(page, "right");

    await grabWrongly(page);

    const leftAfter = await readGrip(page, "left");
    const rightAfter = await readGrip(page, "right");
    expect(
      leftAfter < leftBefore || rightAfter < rightBefore,
      "ミスするとどちらか一方(アンカー側)の腕力が減る",
    ).toBe(true);

    expect(errors, "ミス操作でエラーが出ていない").toEqual([]);
  });

  test("何も掴まずに見逃すとアンカー側の腕力が減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    const leftBefore = await readGrip(page, "left");
    const rightBefore = await readGrip(page, "right");

    // 固定時間の待機ではなく、実際に腕力が減るまで(見逃しミスが発生するまで)待つ。
    await expect
      .poll(
        async () => {
          const left = await readGrip(page, "left");
          const right = await readGrip(page, "right");
          return left < leftBefore || right < rightBefore;
        },
        { intervals: [100], timeout: 15000 },
      )
      .toBe(true);

    expect(errors, "見逃し待機中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は叩いても状態が変化せず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const leftWhilePaused = await readGrip(page, "left");
    const rightWhilePaused = await readGrip(page, "right");

    await pressButton(page, "left");
    await pressButton(page, "right");
    await waitForFrames(page, 10);

    expect(await readScore(page), "一時停止中は叩いても得点が変わらない").toBe(scoreWhilePaused);
    expect(await readGrip(page, "left"), "一時停止中は腕力も変わらない").toBe(leftWhilePaused);
    expect(await readGrip(page, "right"), "一時停止中は腕力も変わらない").toBe(rightWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const leftAfterResume = await readGrip(page, "left");
    const rightAfterResume = await readGrip(page, "right");
    await grabWrongly(page);
    const leftAfterHit = await readGrip(page, "left");
    const rightAfterHit = await readGrip(page, "right");
    expect(
      leftAfterHit < leftAfterResume || rightAfterHit < rightAfterResume,
      "再開後は操作で腕力に変化が起きる",
    ).toBe(true);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("ミスを重ねて両腕の腕力が尽きると結果画面が出て、もう一度あそぶで最初から遊べる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-stage").locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("crux-hold-gameover");

    for (let i = 0; i < 40 && !(await gameOver.isVisible()); i++) {
      await grabWrongly(page);
    }

    await expect(gameOver, "ミスを繰り返すと滑落してゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("crux-hold-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readHeight(page), "リスタートで高度が0に戻る").toBe(0);
    // ここでもリスタート直後から実時間が経っているため、満タン近辺であることを確認する。
    expect(await readGrip(page, "left"), "リスタートで左腕がほぼ満タンに戻る").toBeGreaterThan(60);
    expect(await readGrip(page, "left")).toBeLessThanOrEqual(EXPECTED_START_GRIP);
    expect(await readGrip(page, "right"), "リスタートで右腕がほぼ満タンに戻る").toBeGreaterThan(60);
    expect(await readGrip(page, "right")).toBeLessThanOrEqual(EXPECTED_START_GRIP);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 15; i++) {
      await pressButton(page, "left");
      await pressButton(page, "right");
    }
    await waitForFrames(page, 10);

    expect(await readGrip(page, "left"), "連打しても腕力は0未満にならない").toBeGreaterThanOrEqual(
      0,
    );
    expect(await readGrip(page, "right"), "連打しても腕力は0未満にならない").toBeGreaterThanOrEqual(
      0,
    );
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
    await expect(page.getByTestId("crux-hold-height")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const leftBefore = await readGrip(page, "left");
    const rightBefore = await readGrip(page, "right");
    await grabWrongly(page);
    const leftAfter = await readGrip(page, "left");
    const rightAfter = await readGrip(page, "right");
    expect(leftAfter < leftBefore || rightAfter < rightBefore, "リサイズ後も操作の効果が出る").toBe(
      true,
    );

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
