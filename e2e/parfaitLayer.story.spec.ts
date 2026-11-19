import { expect, type Locator, type Page, test } from "@playwright/test";
import { INGREDIENT_IDS } from "../src/app/games/parfait-layer/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/parfait-layer";

// このゲームに「権限」「キャッシュ」の概念はなく(単一セッションの純粋なローカル状態)、
// 該当する異常系は対象外。空/ゼロ件(レシピが1つもない)状態も起動直後から常にレシピが
// あるため存在しない。代わりに 違う材料(失敗) / あふれ(失敗) / 一時停止中の操作(中断) /
// 連打(再入) / ゲームオーバー後のリスタート / リサイズ を扱う。

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("parfait-layer-lives").innerText();
  const matched = text.match(/(\d+)\s*\/\s*(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("parfait-layer-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readFillPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("parfait-layer-fill").innerText();
  const matched = text.match(/(\d+)%/);
  expect(matched, `満たされ具合から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 現在の層の目安(目標の帯)を百分率で読む。レシピはラウンドごとにランダム生成されるため、
 * 層の目標量は固定時間では当てられない。帯を読んでそこまで注ぐことで、どのレシピでも
 * 確実に品質の高い(得点が入る)層を確定させる。 */
async function readTargetBandPercent(page: Page): Promise<{ min: number; max: number }> {
  const text = await page.getByTestId("parfait-layer-target").innerText();
  const matched = text.match(/(\d+)%〜(\d+)%/);
  expect(matched, `目安表示から帯を読み取れる: "${text}"`).not.toBeNull();
  return { min: Number(matched?.[1] ?? Number.NaN), max: Number(matched?.[2] ?? Number.NaN) };
}

/** 現在注ぐべき材料のID(data-ingredient)を、レシピ表示の「現在の層」チップから読む。 */
async function readCurrentIngredient(page: Page): Promise<string> {
  const chip = page.getByTestId("parfait-layer-recipe").locator('[data-status="current"]').first();
  const value = await chip.getAttribute("data-ingredient");
  expect(value, "現在注ぐべき材料が読み取れる").not.toBeNull();
  return value as string;
}

async function selectIngredient(page: Page, ingredientId: string): Promise<void> {
  await page.getByTestId(`parfait-layer-ingredient-${ingredientId}`).click();
}

/** ステージ中央を指定ミリ秒ぶん長押しして注ぐ(マウスとタッチのどちらでも同じ経路)。 */
async function pourOnStage(page: Page, stage: Locator, holdMs: number) {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/**
 * 現在の層の目安(帯)に届いた瞬間に離して、どのレシピでも確実に品質の高い層を確定させる。
 * 長押しを続けるほど流量が加速する仕様上、`expect.poll` の指数的に広がるポーリング間隔では
 * 帯を飛び越えてあふれてしまうことがあるため、短い固定間隔で手動ポーリングして即座に離す。
 */
async function pourUntilInBand(page: Page, stage: Locator): Promise<void> {
  const { min } = await readTargetBandPercent(page);
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();

  const deadline = Date.now() + 8_000;
  let fill = await readFillPercent(page);
  while (fill < min && Date.now() < deadline) {
    await page.waitForTimeout(20);
    fill = await readFillPercent(page);
  }
  await page.mouse.up();

  expect(
    fill,
    `満たされ具合が目安(${min}%以上)に達してから注ぎを止められる`,
  ).toBeGreaterThanOrEqual(min);
}

test.describe("Parfait Layer のストーリー", () => {
  test("起動直後はラウンド1・ライフ満タン・スコア0でレシピが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("parfait-layer-round")).toBeVisible();
    await expect(page.getByTestId("parfait-layer-lives")).toBeVisible();
    await expect(page.getByTestId("parfait-layer-recipe")).toBeVisible();
    await expect(page.getByTestId("parfait-layer-target")).toBeVisible();
    for (const id of INGREDIENT_IDS) {
      await expect(page.getByTestId(`parfait-layer-ingredient-${id}`)).toBeVisible();
    }

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフ満タン").toBe(3);
    expect(await readFillPercent(page), "開始時はグラスが空").toBe(0);

    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("レシピと同じ材料を選んで長押しで注ぐと層が確定し、スコアが増えてレシピが進む", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    await selectIngredient(page, correctIngredient);
    await expect(page.getByTestId(`parfait-layer-ingredient-${correctIngredient}`)).toHaveAttribute(
      "data-selected",
      "true",
    );

    const scoreBefore = await readScore(page);
    await pourUntilInBand(page, stage);

    await expect
      .poll(() => readScore(page), { message: "正しい材料を注ぎ切ると得点が増える" })
      .toBeGreaterThan(scoreBefore);
    await expect(page.getByTestId("parfait-layer-recipe-chip-0")).toHaveAttribute(
      "data-status",
      "done",
    );
    await expect(page.getByTestId("parfait-layer-recipe-chip-1")).toHaveAttribute(
      "data-status",
      "current",
    );
    await expect(page.getByTestId("parfait-layer-feedback")).toContainText("+");

    expect(await readLives(page), "正しい材料ではライフが減らない").toBe(3);
    expect(errors, "注ぐ操作でエラーが出ていない").toEqual([]);
  });

  test("レシピと違う材料を注いで離すとライフが減り、レシピは進まない(やり直し)", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    const wrongIngredient = INGREDIENT_IDS.find((id) => id !== correctIngredient);
    expect(wrongIngredient, "正解以外の材料が見つかる").toBeDefined();
    if (!wrongIngredient) return;

    await selectIngredient(page, wrongIngredient);
    const livesBefore = await readLives(page);
    await pourOnStage(page, stage, 200);

    await expect
      .poll(() => readLives(page), { message: "違う材料を注ぐとライフが減る" })
      .toBeLessThan(livesBefore);
    await expect(page.getByTestId("parfait-layer-feedback")).toContainText("ちがう");
    await expect(
      page.getByTestId("parfait-layer-recipe-chip-0"),
      "違う材料ではその層が確定しないのでやり直しになる",
    ).toHaveAttribute("data-status", "current");

    // 選び直して正しい材料ならやり直せる
    await selectIngredient(page, correctIngredient);
    const scoreBefore = await readScore(page);
    await pourUntilInBand(page, stage);
    await expect
      .poll(() => readScore(page), { message: "選び直せば続けられる" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });

  test("長押しを続けて容量を超えるほど注ぐと、あふれてライフが減り強制的に注ぎが止まる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    await selectIngredient(page, correctIngredient);
    const livesBefore = await readLives(page);

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await expect
        .poll(() => readLives(page), {
          message: "長時間注ぎ続けるとあふれてライフが減る",
          timeout: 10_000,
        })
        .toBeLessThan(livesBefore);
      await page.mouse.up();
    }

    await expect(page.getByTestId("parfait-layer-feedback")).toContainText("あふれ");
    expect(await readFillPercent(page), "あふれた後は注ぎかけの量が片付く").toBeLessThan(100);

    expect(errors, "あふれの操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止中はスコア・ライフ・満たされ具合が変化せず、再開すると再び注げる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    await selectIngredient(page, correctIngredient);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);
    const fillWhilePaused = await readFillPercent(page);

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 20);
      await page.mouse.up();
    }

    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中はライフが変化しない").toBe(livesWhilePaused);
    expect(await readFillPercent(page), "一時停止中は満たされ具合が変化しない").toBe(
      fillWhilePaused,
    );

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    const scoreBefore = await readScore(page);
    await pourUntilInBand(page, stage);
    await expect
      .poll(() => readScore(page), { message: "再開すれば再び注いで得点が増える" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "一時停止中の操作でエラーが出ていない").toEqual([]);
  });

  test("キーボードでも材料を選んで長押しで注げる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    const keyIndex = INGREDIENT_IDS.indexOf(correctIngredient as (typeof INGREDIENT_IDS)[number]);
    expect(keyIndex, "材料に対応する数字キーが見つかる").toBeGreaterThanOrEqual(0);

    await page.keyboard.press(String(keyIndex + 1));
    await expect(page.getByTestId(`parfait-layer-ingredient-${correctIngredient}`)).toHaveAttribute(
      "data-selected",
      "true",
    );

    // 長押しを続けるほど流量が加速するため、expect.poll の指数的なポーリング間隔では
    // 帯を飛び越えてしまうことがある。短い固定間隔で手動ポーリングして即座に離す。
    const { min } = await readTargetBandPercent(page);
    const scoreBefore = await readScore(page);
    await page.keyboard.down("Enter");
    const deadline = Date.now() + 8_000;
    let fill = await readFillPercent(page);
    while (fill < min && Date.now() < deadline) {
      await page.waitForTimeout(20);
      fill = await readFillPercent(page);
    }
    await page.keyboard.up("Enter");
    expect(
      fill,
      `満たされ具合が目安(${min}%以上)に達してから注ぎを止められる`,
    ).toBeGreaterThanOrEqual(min);

    await expect
      .poll(() => readScore(page), { message: "キーボードの長押しでも得点が増える" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "キーボード操作でエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、もう一度あそぶで最初から再開できる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (let i = 0; i < 3; i++) {
      const correctIngredient = await readCurrentIngredient(page);
      const wrongIngredient = INGREDIENT_IDS.find((id) => id !== correctIngredient);
      if (!wrongIngredient) continue;
      await selectIngredient(page, wrongIngredient);
      await pourOnStage(page, stage, 150);
      await waitForFrames(page, 5);
    }

    await expect(
      page.getByTestId("parfait-layer-gameover"),
      "ライフが尽きてゲームオーバーになる",
    ).toBeVisible();
    await expect(page.getByTestId("parfait-layer-restart")).toBeVisible();

    // ゲームオーバー中は注いでも状態が進まない(連打しても壊れない)
    for (let i = 0; i < 5; i++) {
      await pourOnStage(page, stage, 20);
    }
    await expect(page.getByTestId("parfait-layer-gameover")).toBeVisible();

    await page.getByTestId("parfait-layer-restart").click();

    await expect(page.getByTestId("parfait-layer-gameover")).toBeHidden();
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(3);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readRound(page), "リスタートでラウンド1に戻る").toBe(1);

    expect(errors, "ゲームオーバー〜リスタートでエラーが出ていない").toEqual([]);
  });

  test("Rキーでセッション全体がリセットされる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    await selectIngredient(page, correctIngredient);
    await pourUntilInBand(page, stage);
    await expect.poll(() => readScore(page), { message: "1層分の得点が入る" }).toBeGreaterThan(0);

    await page.keyboard.press("r");

    await expect.poll(() => readScore(page), { message: "Rキーでスコアが0に戻る" }).toBe(0);
    expect(await readLives(page), "Rキーでライフが満タンに戻る").toBe(3);
    expect(await readRound(page), "Rキーでラウンド1に戻る").toBe(1);
    await expect(page.getByTestId("parfait-layer-recipe-chip-0")).toHaveAttribute(
      "data-status",
      "current",
    );

    expect(errors, "リセット操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("parfait-layer-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("parfait-layer-round")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const correctIngredient = await readCurrentIngredient(page);
    await selectIngredient(page, correctIngredient);
    const scoreBefore = await readScore(page);
    await pourUntilInBand(page, stage);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後も注ぐと得点が増える" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
