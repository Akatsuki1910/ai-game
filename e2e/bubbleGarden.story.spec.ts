import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/bubble-garden";

type BubbleSize = "small" | "medium" | "large";

// engine/world.ts の CHARGE_MAX_SECONDS・サイズ閾値と一致させる想定の長押し時間(ms)。
const HOLD_MS_FOR_SIZE: Record<BubbleSize, number> = {
  small: 220,
  medium: 700,
  large: 1100,
};

// engine/world.ts の RISE_SPEED_BY_SIZE(正規化座標/秒)から、蔓(0.92)から花(0.16)まで
// 届くのにかかる時間を逆算した目安(ms)。狙いを合わせ続ける長さに使う。
const RISE_MS_FOR_SIZE: Record<BubbleSize, number> = {
  small: 2600,
  medium: 3200,
  large: 4000,
};

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readVitality(page: Page): Promise<number> {
  const value = await page.getByTestId("bubble-garden-vitality").getAttribute("data-vitality");
  expect(value, "元気が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readBloomed(page: Page): Promise<number> {
  const value = await page.getByTestId("bubble-garden-bloomed").getAttribute("data-bloomed");
  expect(value, "開花数が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readTarget(page: Page): Promise<{ size: BubbleSize; x: number }> {
  const target = page.getByTestId("bubble-garden-target");
  const size = (await target.getAttribute("data-size")) as BubbleSize | null;
  const x = await target.getAttribute("data-x");
  expect(size, "的のサイズが属性から読み取れる").not.toBeNull();
  expect(x, "的のx位置が属性から読み取れる").not.toBeNull();
  return { size: size as BubbleSize, x: Number(x) };
}

async function readBubbleX(page: Page): Promise<number | null> {
  const value = await page.getByTestId("bubble-garden-bubble").getAttribute("data-x");
  if (value === null || value === "") return null;
  return Number(value);
}

/** DOM APIで直接ボタンを押す/離す(ポーズ中の操作確認にも使うため座標クリックに依存しない)。 */
async function pressButton(page: Page, testId: string, holdMs: number): Promise<void> {
  await page.evaluate((id) => {
    const button = document.querySelector(`[data-testid="${id}"]`);
    button?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  }, testId);
  await page.waitForTimeout(holdMs);
  await page.evaluate((id) => {
    const button = document.querySelector(`[data-testid="${id}"]`);
    button?.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  }, testId);
}

/** 長押し時間を変えて、小/中/大いずれかのサイズの泡を放つ。 */
async function blowBubble(page: Page, size: BubbleSize): Promise<void> {
  await pressButton(page, "bubble-garden-blow-button", HOLD_MS_FOR_SIZE[size]);
  await waitForFrames(page, 2);
}

/**
 * ステージ上の正規化x位置(0〜1、画面中央の高さ)にポインタを置いて押し続ける。
 * ポインタで狙った位置へ寄せ続ける操作(PC のドラッグ/スマホの押し続けに相当)を模す。
 * 一度押し続けるだけで、的は動かないため風に流されても常にそこへ寄っていく。
 */
async function holdPointerAtRatio(
  page: Page,
  stage: Locator,
  xRatio: number,
  durationMs: number,
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const x = box.x + box.width * xRatio;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(durationMs);
  await page.mouse.up();
}

/** 的と同じサイズの泡を、的の直下に狙いを合わせながら放って開花を狙う(失敗しても異常系にはならない)。 */
async function attemptBloom(page: Page, stage: Locator): Promise<void> {
  const target = await readTarget(page);
  await blowBubble(page, target.size);
  await holdPointerAtRatio(page, stage, target.x, RISE_MS_FOR_SIZE[target.size]);
  await waitForFrames(page, 10);
}

test.describe("Bubble Garden のストーリー", () => {
  test("起動直後は元気満タン・得点0・開花0で的と泡のHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-vitality")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-target")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-bubble")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-blow-button")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-steer-left")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-steer-right")).toBeVisible();
    await expect(page.getByTestId("bubble-garden-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readVitality(page), "開始時の元気は満タン").toBe(100);
    expect(await readBloomed(page), "開始時の開花数は0").toBe(0);

    const target = await readTarget(page);
    expect(["small", "medium", "large"]).toContain(target.size);

    const stage = page.getByTestId("bubble-garden-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("長押しの長さで泡のサイズが変わる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("bubble-garden-stage").locator("canvas")).toBeVisible();

    await blowBubble(page, "small");
    await expect(page.getByTestId("bubble-garden-bubble")).toHaveAttribute("data-size", "small");

    // 泡が飛んでいる間は的に届くまで待ち、消えるのを確認してから次を試す。
    await expect
      .poll(
        async () =>
          (await page.getByTestId("bubble-garden-bubble").getAttribute("data-size")) === "",
        {
          timeout: 15000,
        },
      )
      .toBe(true);

    await blowBubble(page, "large");
    await expect(page.getByTestId("bubble-garden-bubble")).toHaveAttribute("data-size", "large");

    expect(errors, "泡を放つ操作でエラーが出ていない").toEqual([]);
  });

  test("的と同じ大きさの泡を中心へ寄せて届けると開花し、得点と元気が伸びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("bubble-garden-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const scoreBefore = await readScore(page);
    const bloomedBefore = await readBloomed(page);

    let bloomedAfterAny = bloomedBefore;
    for (let i = 0; i < 6 && bloomedAfterAny === bloomedBefore; i++) {
      await attemptBloom(page, stage);
      bloomedAfterAny = await readBloomed(page);
    }

    expect(bloomedAfterAny, "狙いを合わせて何度か試せば少なくとも1回は開花する").toBeGreaterThan(
      bloomedBefore,
    );
    expect(await readScore(page), "開花すると得点が増える").toBeGreaterThan(scoreBefore);

    expect(errors, "開花を狙う操作でエラーが出ていない").toEqual([]);
  });

  test("左右の狙いボタンを押し続けると、飛んでいる泡の位置がその方向へ動く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("bubble-garden-stage").locator("canvas")).toBeVisible();

    await blowBubble(page, "large"); // 大きいほど上昇が遅く、操作の余地が長い
    await expect(page.getByTestId("bubble-garden-bubble")).toHaveAttribute("data-size", "large");
    const xBefore = await readBubbleX(page);
    expect(xBefore, "泡のx位置が読み取れる(飛行中のはず)").not.toBeNull();

    await pressButton(page, "bubble-garden-steer-right", 500);
    await waitForFrames(page, 6);

    const xAfter = await readBubbleX(page);
    expect(xAfter, "泡がまだ飛んでいる(大きい泡は上昇が遅いため)").not.toBeNull();
    expect(xAfter, "右ボタンを押し続けると右へ寄っていく").toBeGreaterThan(xBefore ?? 0);

    expect(errors, "狙いボタンの操作でエラーが出ていない").toEqual([]);
  });

  test("サイズを外した泡を放つと失敗して元気が減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("bubble-garden-stage").locator("canvas")).toBeVisible();

    const target = await readTarget(page);
    const wrongSize: BubbleSize = target.size === "large" ? "small" : "large";
    const vitalityBefore = await readVitality(page);

    await blowBubble(page, wrongSize);
    // 泡が的に届いて判定されるまで(泡が消えるまで)待つ。
    await expect
      .poll(
        async () =>
          (await page.getByTestId("bubble-garden-bubble").getAttribute("data-size")) === "",
        {
          timeout: 15000,
        },
      )
      .toBe(true);

    expect(await readVitality(page), "サイズを外すと元気が減る").toBeLessThan(vitalityBefore);

    expect(errors, "失敗操作でエラーが出ていない").toEqual([]);
  });

  test("長押しを粘りすぎる(オーバーチャージ)と泡を放つ前に失敗して元気が減る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("bubble-garden-stage").locator("canvas")).toBeVisible();

    const vitalityBefore = await readVitality(page);

    // CHARGE_MAX_SECONDS(1.3s) + オーバーチャージ猶予(0.5s) を確実に超える長押し。
    await pressButton(page, "bubble-garden-blow-button", 2200);
    await waitForFrames(page, 5);

    expect(await readVitality(page), "粘りすぎると暴発して元気が減る").toBeLessThan(vitalityBefore);
    expect(
      await page.getByTestId("bubble-garden-bubble").getAttribute("data-size"),
      "暴発するので泡は飛ばない",
    ).toBe("");

    expect(errors, "オーバーチャージ中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は操作しても状態が変化せず、再開すると効果が戻る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("bubble-garden-stage").locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const vitalityWhilePaused = await readVitality(page);
    const scoreWhilePaused = await readScore(page);

    await pressButton(page, "bubble-garden-blow-button", 600);
    await waitForFrames(page, 10);

    expect(await readVitality(page), "一時停止中は操作しても元気が変わらない").toBe(
      vitalityWhilePaused,
    );
    expect(await readScore(page), "一時停止中は操作しても得点が変わらない").toBe(scoreWhilePaused);
    expect(
      await page.getByTestId("bubble-garden-bubble").getAttribute("data-size"),
      "一時停止中は長押ししても泡が放たれない",
    ).toBe("");

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await blowBubble(page, "medium");
    await expect(page.getByTestId("bubble-garden-bubble")).toHaveAttribute("data-size", "medium");

    expect(errors, "一時停止の操作でエラーが出ていない").toEqual([]);
  });

  test("連打しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("bubble-garden-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => {
        const down = (id: string) =>
          document
            .querySelector(`[data-testid="${id}"]`)
            ?.dispatchEvent(
              new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3 }),
            );
        const up = (id: string) =>
          document
            .querySelector(`[data-testid="${id}"]`)
            ?.dispatchEvent(
              new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 3 }),
            );
        down("bubble-garden-blow-button");
        up("bubble-garden-blow-button");
        down("bubble-garden-steer-left");
        up("bubble-garden-steer-left");
        down("bubble-garden-steer-right");
        up("bubble-garden-steer-right");
      });
    }
    await waitForFrames(page, 10);

    const vitality = await readVitality(page);
    expect(vitality, "連打しても元気は0未満にならない").toBeGreaterThanOrEqual(0);
    expect(vitality, "連打しても元気は100を超えない").toBeLessThanOrEqual(100);
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("bubble-garden-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("bubble-garden-vitality")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const vitalityBefore = await readVitality(page);
    const wrongTarget = await readTarget(page);
    const wrongSize: BubbleSize = wrongTarget.size === "small" ? "large" : "small";
    await blowBubble(page, wrongSize);
    await expect
      .poll(
        async () =>
          (await page.getByTestId("bubble-garden-bubble").getAttribute("data-size")) === "",
        {
          timeout: 15000,
        },
      )
      .toBe(true);

    expect(await readVitality(page), "リサイズ後も操作の効果が出る").toBeLessThan(vitalityBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("元気が尽きると結果画面が出て、もう一度あそぶで最初から遊べる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("bubble-garden-stage").locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("bubble-garden-gameover");

    for (let i = 0; i < 15 && !(await gameOver.isVisible()); i++) {
      const target = await readTarget(page);
      const wrongSize: BubbleSize = target.size === "small" ? "large" : "small";
      await blowBubble(page, wrongSize);
      await expect
        .poll(
          async () =>
            (await gameOver.isVisible()) ||
            (await page.getByTestId("bubble-garden-bubble").getAttribute("data-size")) === "",
          { timeout: 15000 },
        )
        .toBe(true);
    }

    await expect(gameOver, "失敗を繰り返すと元気が尽きてゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("bubble-garden-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readVitality(page), "リスタートで元気が満タンに戻る").toBe(100);
    expect(await readBloomed(page), "リスタートで開花数が0に戻る").toBe(0);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });
});
