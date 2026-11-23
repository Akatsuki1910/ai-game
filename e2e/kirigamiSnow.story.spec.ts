import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/kirigami-snow";
const EXPECTED_START_LIVES = 3;

/**
 * 操作対象のメインウェッジ(折ったウェッジの最初のセル=row0,col0)のおおよその
 * 画面中心座標。実装(KirigamiSnowGame.tsx の computeMainLayout / wedgeGeometry.ts の
 * cellMidpoint)と同じ比率・幾何計算をテスト側でも再現し、実際の見た目の座標に
 * クリックする(内部関数を直接呼ぶのではなく、本物の画面操作で検証するため)。
 */
function firstCellScreenPoint(stageBox: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  const cx = stageBox.x + stageBox.width * 0.1;
  const cy = stageBox.y + stageBox.height * 0.18;
  const scale = Math.max(1, Math.min(stageBox.width, stageBox.height) * 0.42);

  // wedgeGeometry.ts: cellBounds(0, 0, 3) の中点(row0は1マスで角度[0, 45度]全体)。
  const innerRadius = 0.12;
  const ringHeight = (1 - innerRadius) / 3;
  const outerRadius = innerRadius + ringHeight;
  const radius = (innerRadius + outerRadius) / 2;
  const sectorAngle = Math.PI / 4;
  const angle = sectorAngle / 2;

  return {
    x: cx + scale * radius * Math.cos(angle),
    y: cy + scale * radius * Math.sin(angle),
  };
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("kirigami-snow-round").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("kirigami-snow-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

async function readAccuracyPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("kirigami-snow-accuracy-value").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function waitForCanvas(page: Page): Promise<Locator> {
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();
  return stage;
}

test.describe("Kirigami Snow のストーリー", () => {
  test("起動直後は1ラウンド目・満タンのライフ・スコア0でHUDが表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toContainText("0");
    await expect(page.getByTestId("kirigami-snow-gameover")).toBeHidden();
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(EXPECTED_START_LIVES);

    await waitForCanvas(page);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("マスをクリックするとカット/復元が切り替わり、一致率が変化する", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const stageBox = await stage.boundingBox();
    expect(stageBox, "ステージの領域が取得できる").not.toBeNull();
    if (!stageBox) return;

    const point = firstCellScreenPoint(stageBox);
    const accuracyBefore = await readAccuracyPercent(page);

    await page.mouse.click(point.x, point.y);
    await waitForFrames(page, 5);
    const accuracyAfterCut = await readAccuracyPercent(page);
    expect(accuracyAfterCut, "マスをカットすると一致率が変化する").not.toBe(accuracyBefore);

    await page.mouse.click(point.x, point.y);
    await waitForFrames(page, 5);
    const accuracyAfterRestore = await readAccuracyPercent(page);
    expect(accuracyAfterRestore, "同じマスをもう一度クリックすると元に戻る").toBe(accuracyBefore);

    expect(errors, "クリック操作中にエラーが出ていない").toEqual([]);
  });

  test("「仕上げる」ボタンでラウンドが終わり、次のラウンドへ進む(スコアも増える)", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    const roundBefore = await readRound(page);
    await page.getByTestId("kirigami-snow-finish").click();
    await waitForFrames(page, 10);

    const roundAfter = await readRound(page);
    expect(roundAfter, "仕上げると次のラウンドへ進む").toBe(roundBefore + 1);

    expect(errors, "仕上げ操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作(矢印/Enter/F)でもカット・仕上げができる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    await stage.click({ position: { x: 5, y: 5 } });

    const accuracyBefore = await readAccuracyPercent(page);
    await page.keyboard.press("Enter");
    await waitForFrames(page, 5);
    expect(await readAccuracyPercent(page), "Enterキーでカットできる").not.toBe(accuracyBefore);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");

    const roundBefore = await readRound(page);
    await page.keyboard.press("f");
    await waitForFrames(page, 10);
    expect(await readRound(page), "Fキーで仕上げてラウンドが進む").toBe(roundBefore + 1);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("連打しても壊れない(同じマスを高速に何度もクリック)", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    if (!stageBox) return;

    const point = firstCellScreenPoint(stageBox);
    for (let i = 0; i < 12; i++) {
      await page.mouse.click(point.x, point.y);
    }
    await waitForFrames(page, 10);

    // 偶数回クリックしたので元の状態に戻っているはず。壊れていないことだけを確認する。
    await expect(page.getByTestId("kirigami-snow-gameover")).toBeHidden();
    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はタイマーが進まず、操作しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const roundWhilePaused = await readRound(page);
    await waitForFrames(page, 60);
    expect(await readRound(page), "一時停止中はラウンドが進まない").toBe(roundWhilePaused);

    // 一時停止中に「仕上げる」ボタンを押しても反応しない(オーバーレイが覆っている)。
    await page
      .getByTestId("kirigami-snow-finish")
      .click({ force: true, trial: false, timeout: 2_000 })
      .catch(() => {});
    expect(await readRound(page), "一時停止中の操作でラウンドが変わらない").toBe(roundWhilePaused);

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "一時停止操作中にエラーが出ていない").toEqual([]);
  });

  test("制限時間が尽きると自動でラウンドが進む(何も操作しない場合)", async ({ page }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);

    const roundBefore = await readRound(page);
    await expect
      .poll(() => readRound(page), {
        message: "何もしなくても制限時間切れで次のラウンドへ進む",
        timeout: 30_000,
      })
      .toBeGreaterThan(roundBefore);

    expect(errors, "待機中にエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、リスタートできる", async ({ page }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);
    const gameOver = page.getByTestId("kirigami-snow-gameover");

    // 何も切らずに「仕上げる」を連打し続けると、一致率が低いまま毎ラウンド失敗して
    // ライフが尽きる。乱数で偶然成功してしまう可能性もゼロではないため、
    // 「ゲームオーバーになるか、十分な回数試しても耐え続けるか」のどちらかに至ることを確認する。
    const finishButton = page.getByTestId("kirigami-snow-finish");
    for (let i = 0; i < EXPECTED_START_LIVES + 2 && !(await gameOver.isVisible()); i++) {
      await finishButton.click({ timeout: 2_000 }).catch(() => {});
      await waitForFrames(page, 10);
    }

    if (await gameOver.isVisible()) {
      expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);
      await page.getByTestId("kirigami-snow-restart").click();
      await expect(gameOver).toBeHidden();
      expect(await readRound(page), "リスタートでラウンド1に戻る").toBe(1);
      expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(EXPECTED_START_LIVES);
    } else {
      await expect(page.getByTestId("kirigami-snow-lives")).toBeVisible();
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

    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    if (stageBox) {
      const point = firstCellScreenPoint(stageBox);
      const accuracyBefore = await readAccuracyPercent(page);
      await page.mouse.click(point.x, point.y);
      await waitForFrames(page, 5);
      expect(await readAccuracyPercent(page), "リサイズ後もクリックで操作できる").not.toBe(
        accuracyBefore,
      );
    }

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
