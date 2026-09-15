import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, expectStageToAnimate, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/gold-seam";

interface Ratio {
  x: number;
  y: number;
}

/**
 * なぞっている間に繰り返し読む「先端(次になぞるべき地点)の座標」。
 * ステージ比率(0〜1)で保持されているデータ属性を読み、実際のマウス座標に変換して使う。
 */
async function readFrontierRatio(page: Page): Promise<Ratio> {
  return page.evaluate(() => {
    const markerEl = document.querySelector<HTMLElement>('[data-testid="gold-seam-frontier"]');
    return {
      x: Number(markerEl?.dataset.xRatio ?? Number.NaN),
      y: Number(markerEl?.dataset.yRatio ?? Number.NaN),
    };
  });
}

async function readGoldPercent(page: Page): Promise<number> {
  const fill = page.getByTestId("gold-seam-gold").locator("div");
  const style = await fill.getAttribute("style");
  const matched = style?.match(/width:\s*(\d+)%/);
  expect(matched, `金粉ゲージの幅から数値を読み取れる: "${style}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readProgressPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("gold-seam-progress").innerText();
  const matched = text.match(/継ぎ目 (\d+)%/);
  expect(matched, `継ぎ目の進捗表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** 4隅のうち、現在の先端から最も遠い場所を選ぶ(経路から確実に外れた位置でなぞらせるため)。 */
function pickFarCorner(frontier: Ratio): Ratio {
  const corners: Ratio[] = [
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.05, y: 0.95 },
    { x: 0.95, y: 0.95 },
  ];
  return corners.reduce((best, corner) =>
    Math.hypot(corner.x - frontier.x, corner.y - frontier.y) >
    Math.hypot(best.x - frontier.x, best.y - frontier.y)
      ? corner
      : best,
  );
}

/**
 * 実際の画面操作(ポインタを押したままのドラッグ)で、常に更新される先端の位置を
 * 一定回数追いかけ続ける。内部関数を直接呼ばず、本物のマウス操作だけでなぞらせる。
 */
interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function traceFrontierByMouse(page: Page, box: StageBox, iterations: number): Promise<void> {
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 0; i < iterations; i++) {
    const ratio = await readFrontierRatio(page);
    if (Number.isFinite(ratio.x) && Number.isFinite(ratio.y)) {
      await page.mouse.move(box.x + box.width * ratio.x, box.y + box.height * ratio.y);
    }
    await waitForFrames(page, 2);
  }
  await page.mouse.up();
}

test.describe("Gold Seam のストーリー", () => {
  test("起動直後はHUDが揃い、操作しなくても画面は生きている", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("gold-seam-bowls")).toHaveText("継いだ器 0個");
    await expect(page.getByTestId("gold-seam-progress")).toHaveText("継ぎ目 0%");
    expect(await readGoldPercent(page), "開始時の金粉は満タン").toBe(100);
    await expect(page.getByTestId("gold-seam-gameover")).toBeHidden();

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    // 無操作でも先端の輪が脈動しており、静止画のままにならない
    await expectStageToAnimate(page, stage);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("ひびの先端をなぞると継ぎ目の進捗が進み、金粉が消費される", async ({ page }) => {
    // 先端を追いかけるドラッグは何十回もマウス往復を繰り返すため、実時間で動く
    // WebGL描画と組み合わさると既定の60秒では余裕が足りないことがある。
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    await traceFrontierByMouse(page, box, 45);

    expect(await readProgressPercent(page), "先端をなぞると継ぎ目の進捗が進む").toBeGreaterThan(0);
    expect(await readGoldPercent(page), "金粉が消費される").toBeLessThan(100);

    expect(errors, "なぞっている間にエラーが出ていない").toEqual([]);
  });

  test("経路を外れ続けると金粉が尽きて器が割れ、やり直せる", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const frontier = await readFrontierRatio(page);
    const farCorner = pickFarCorner(frontier);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * farCorner.x, box.y + box.height * farCorner.y);
      await page.mouse.down();
    }

    await expect
      .poll(() => readGoldPercent(page), {
        message: "経路を外れ続けると金粉が尽きる",
        timeout: 20_000,
      })
      .toBe(0);
    if (box) await page.mouse.up();

    await expect(page.getByTestId("gold-seam-gameover"), "器が割れて終了画面が出る").toBeVisible();

    const scoreAtOver = await readScore(page);
    await waitForFrames(page, 30);
    expect(await readScore(page), "終了後はスコアが変化しない").toBe(scoreAtOver);

    // 外れた位置で押しっぱなしにしても、終了後は状態が変化しない(連続操作でも壊れない)
    if (box) {
      await page.mouse.move(box.x + box.width * farCorner.x, box.y + box.height * farCorner.y);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readGoldPercent(page), "終了後は金粉ゲージも変化しない").toBe(0);

    await page.getByTestId("gold-seam-restart").click();
    await expect(page.getByTestId("gold-seam-gameover")).toBeHidden();
    expect(await readGoldPercent(page), "やり直すと金粉が満タンに戻る").toBe(100);
    await expect(page.getByTestId("gold-seam-bowls")).toHaveText("継いだ器 0個");
    await expect(page.getByTestId("gold-seam-progress")).toHaveText("継ぎ目 0%");

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で完全に止まり、連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const goldWhilePaused = await readGoldPercent(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readGoldPercent(page), "一時停止中は金粉が変化しない").toBe(goldWhilePaused);

    // 一時停止中になぞる操作をしても状態は動かない
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readGoldPercent(page), "一時停止中の操作でも金粉は変化しない").toBe(
      goldWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("gold-seam-gold")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける(金粉ゲージが範囲内に収まり続ける)
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 20);
      await page.mouse.up();
    }
    const goldAfterResize = await readGoldPercent(page);
    expect(goldAfterResize).toBeGreaterThanOrEqual(0);
    expect(goldAfterResize).toBeLessThanOrEqual(100);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
