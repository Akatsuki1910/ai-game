import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/pagoda-stack";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readHeight(page: Page): Promise<number> {
  const value = await page.getByTestId("pagoda-stack-height").getAttribute("data-height");
  expect(value, "高さが属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readCombo(page: Page): Promise<number> {
  const value = await page.getByTestId("pagoda-stack-combo").getAttribute("data-combo");
  expect(value, "コンボが属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readOverlapPreview(page: Page): Promise<number> {
  const value = await page.getByTestId("pagoda-stack-status").getAttribute("data-overlap-preview");
  expect(value, "重なりプレビューが属性から読み取れる").not.toBeNull();
  return Number(value);
}

/**
 * タップ(=drop)を1回行い、少し待って表示の更新を反映させる。
 * 振れている段のタイミングは内部タイマー依存のため、タップの瞬間の重なりは
 * 「積める(高さが伸びる)」か「外れる/薄すぎて崩れる(ゲームオーバーになる)」の
 * どちらかになる。pulse-lock など他ゲームのストーリーテストと同じ考え方で、
 * 狙ったタイミングを外部からピンポイントで当てには行かず、繰り返しタップして
 * どちらの結果になっても壊れないことを検証する。
 */
async function tapStageOnce(page: Page, stage: Locator): Promise<void> {
  await stage.click();
  await waitForFrames(page, 5);
}

test.describe("Pagoda Stack のストーリー", () => {
  test("起動直後は高さ0・スコア0・コンボ0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("pagoda-stack-height")).toBeVisible();
    await expect(page.getByTestId("pagoda-stack-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readHeight(page), "開始時の高さは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);

    const stage = page.getByTestId("pagoda-stack-stage");
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("タップするたびに積むか崩れるかのどちらかが必ず起こり、いつか崩れてゲームオーバーになり、もう一度あそべる", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("pagoda-stack-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("pagoda-stack-gameover");

    let previousScore = await readScore(page);
    let previousHeight = await readHeight(page);
    let placedCount = 0;

    for (let i = 0; i < 80; i++) {
      const wasOver = await gameOver.isVisible();
      await tapStageOnce(page, stage);

      const score = await readScore(page);
      const height = await readHeight(page);

      if (wasOver) {
        expect(score, `${i}回目: ゲームオーバー後はタップしても得点が変わらない`).toBe(
          previousScore,
        );
        expect(height, `${i}回目: ゲームオーバー後はタップしても高さが変わらない`).toBe(
          previousHeight,
        );
      } else {
        const isPlaced = height > previousHeight;
        const isGameOverNow = await gameOver.isVisible();
        expect(isPlaced || isGameOverNow, `${i}回目: 積むか崩れるかのどちらかが起きる`).toBe(true);
        if (isPlaced) {
          expect(height, `${i}回目: 積むと高さが1増える`).toBe(previousHeight + 1);
          expect(score, `${i}回目: 積むとスコアが増える`).toBeGreaterThan(previousScore);
          placedCount += 1;
        } else {
          expect(height, `${i}回目: 外した/崩れた場合は高さが増えない`).toBe(previousHeight);
        }
      }

      previousScore = score;
      previousHeight = height;

      if (await gameOver.isVisible()) break;
    }

    expect(
      await gameOver.isVisible(),
      "十分な回数タップすれば最終的に塔が崩れてゲームオーバーになる",
    ).toBe(true);
    expect(placedCount, "ゲームオーバーになる前に少なくとも1回は積めている").toBeGreaterThan(0);
    expect(previousHeight, "ゲームオーバー時の高さは積んだ段数と一致する").toBeGreaterThan(0);
    expect(previousScore, "積んだ分のスコアが入っている").toBeGreaterThan(0);

    // ゲームオーバー中にタップしても状態が変化しない(念のためもう一度確認)
    await tapStageOnce(page, stage);
    expect(await readScore(page), "ゲームオーバー後はスコアが変わらない").toBe(previousScore);
    expect(await readHeight(page), "ゲームオーバー後は高さが変わらない").toBe(previousHeight);

    await page.getByTestId("pagoda-stack-restart").click();
    await expect(gameOver).toBeHidden();
    await expect.poll(() => readHeight(page), { message: "リスタートすると高さが0に戻る" }).toBe(0);
    await expect
      .poll(() => readScore(page), { message: "リスタートするとスコアが0に戻る" })
      .toBe(0);
    await expect
      .poll(() => readCombo(page), { message: "リスタートするとコンボが0に戻る" })
      .toBe(0);

    expect(errors, "一連の操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボード(Enter)でも操作でき、一時停止中は振れが止まり、連打やリサイズをしても壊れない", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("pagoda-stack-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const gameOver = page.getByTestId("pagoda-stack-gameover");

    // 一時停止すると重なりプレビューが変化しない(振れが止まる)ことを確認する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedPreview = await readOverlapPreview(page);
    await waitForFrames(page, 60);
    expect(
      await readOverlapPreview(page),
      "一時停止中は振れが進まないのでプレビューも変化しない",
    ).toBe(pausedPreview);
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    // 一時停止ボタンにフォーカスが残っていると、Enterキーがボタンの再クリックとして
    // 扱われてしまう(再び一時停止してしまう)ため、フォーカスを外しておく。
    await page.getByTestId("game-shell-pause").evaluate((el) => (el as HTMLElement).blur());

    // キーボード(Enter)でタップ(=drop)が効くことを確認する。積むか崩れるかのどちらかが起きればよい。
    const heightBefore = await readHeight(page);
    await page.keyboard.press("Enter");
    await waitForFrames(page, 5);
    const heightAfterEnter = await readHeight(page);
    const overAfterEnter = await gameOver.isVisible();
    expect(
      heightAfterEnter > heightBefore || overAfterEnter,
      "Enterキーでも積むか崩れるかのどちらかが起きる",
    ).toBe(true);

    if (overAfterEnter) {
      await page.getByTestId("pagoda-stack-restart").click();
      await expect(gameOver).toBeHidden();
    }

    // タップを連打しても(途中でゲームオーバーになるだけで)壊れない。
    for (let i = 0; i < 10; i++) {
      await stage.click();
      await waitForFrames(page, 3);
    }
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    if (await gameOver.isVisible()) {
      await page.getByTestId("pagoda-stack-restart").click();
      await expect(gameOver).toBeHidden();
      // 高さの表示は次のフレームで反映されるため、0に戻るのを待ってから比較の基準を読む
      // (すぐ読むと前のゲームの高さを基準にしてしまい、1段積んでも増えていないように見える)。
      await expect.poll(() => readHeight(page), { message: "リスタートで高さが0に戻る" }).toBe(0);
    }

    // リサイズ後も操作を受け付ける(積むか崩れるかのどちらかが起きる)。
    const heightBeforeResize = await readHeight(page);
    await stage.click();
    await waitForFrames(page, 5);
    const heightAfterResize = await readHeight(page);
    expect(
      heightAfterResize > heightBeforeResize || (await gameOver.isVisible()),
      "リサイズ後も積むか崩れるかのどちらかが起きる",
    ).toBe(true);

    expect(errors, "一時停止・連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
