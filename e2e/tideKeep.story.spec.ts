import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/tide-keep";

async function readElapsed(page: Page): Promise<number> {
  const text = await page.getByTestId("tide-keep-elapsed").innerText();
  const matched = text.match(/(\d+)秒/);
  expect(matched, `経過秒数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readWavesSurvived(page: Page): Promise<number> {
  const text = await page.getByTestId("tide-keep-waves").innerText();
  const matched = text.match(/波 (\d+)回突破/);
  expect(matched, `突破した波の数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readIntegrityPercent(page: Page): Promise<number> {
  const fill = page.getByTestId("tide-keep-integrity").locator("div");
  const style = await fill.getAttribute("style");
  const matched = style?.match(/width:\s*(\d+)%/);
  expect(matched, `砦の健全度バーの幅から数値を読み取れる: "${style}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function holdPilingAtKeepCenter(page: Page, stage: Locator, frames: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await waitForFrames(page, frames);
  await page.mouse.up();
}

test.describe("Tide Keep のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも時間が経過していく", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("tide-keep-elapsed")).toBeVisible();
    await expect(page.getByTestId("tide-keep-waves")).toBeVisible();
    await expect(page.getByTestId("tide-keep-integrity")).toBeVisible();
    await expect(page.getByTestId("tide-keep-gameover")).toBeHidden();

    expect(await readElapsed(page), "開始直後は経過0秒付近").toBeLessThanOrEqual(1);
    expect(await readIntegrityPercent(page), "開始直後は砦が健全(満タン)").toBe(100);

    await expect
      .poll(() => readElapsed(page), { message: "無操作でも経過時間が進む" })
      .toBeGreaterThan(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("キーボードでショベルを移動しながら盛れる。連打・端への移動でも壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    for (const key of ["ArrowLeft", "a", "ArrowRight", "d"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 5);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }

    // 画面端まで振り切っても壊れないことを確認する(左端 → 右端)
    await page.keyboard.down("ArrowLeft");
    await waitForFrames(page, 60);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 90);
    await page.keyboard.up("ArrowRight");

    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();
    expect(errors, "キーボード操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で経過時間も健全度も完全に止まり、再開すると進む。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const elapsedWhilePaused = await readElapsed(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readElapsed(page), "一時停止中は経過時間が進まない").toBe(elapsedWhilePaused);

    // 一時停止中に盛る操作をしても、経過時間・見た目は止まったまま
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readElapsed(page), "一時停止中の操作でも経過時間は止まったまま").toBe(
      elapsedWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readElapsed(page), { message: "再開すると経過時間が再び進む" })
      .toBeGreaterThan(elapsedWhilePaused);

    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 3; i++) await pauseButton.click();
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
    await expect(page.getByTestId("tide-keep-elapsed")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付け、時間が進み続ける
    const elapsedBeforeResize = await readElapsed(page);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
    }
    await expect
      .poll(() => readElapsed(page), { message: "リサイズ後も経過時間が進み続ける" })
      .toBeGreaterThanOrEqual(elapsedBeforeResize);
    if (box) await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("放置すると砦の健全度が下がるが、盛れば持ち直せる。最終的に流されてもやり直せる", async ({
    page,
  }) => {
    // 無操作で健全度が下がり始めるまでエンジン単体シミュレーションで10〜20秒ほどかかり、
    // そこから盛って持ち直す様子を確認したうえで最後まで流させるため、既定の60秒より延長する。
    test.setTimeout(150_000);

    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 1. 何もしなければ、潮位の上昇と波の侵食だけで砦の健全度は必ず下がり始める
    await expect
      .poll(() => readIntegrityPercent(page), {
        message: "無操作を続けると砦の健全度が100%未満まで下がる",
        timeout: 60_000,
      })
      .toBeLessThan(100);

    const integrityAfterDecline = await readIntegrityPercent(page);

    // 2. 下がり始めた直後に砦(画面中央)へ盛り続けると、健全度が持ち直す
    await holdPilingAtKeepCenter(page, stage, 90);
    await expect
      .poll(() => readIntegrityPercent(page), {
        message: "盛り続けると健全度が持ち直す",
        timeout: 10_000,
      })
      .toBeGreaterThan(integrityAfterDecline);

    // 3. 盛るのをやめて放置を続けると、最終的に健全度が0になり砦が流される
    await expect
      .poll(() => readIntegrityPercent(page), {
        message: "盛るのをやめて放置を続けると健全度が0まで下がる",
        timeout: 60_000,
      })
      .toBe(0);
    await expect(page.getByTestId("tide-keep-gameover"), "ゲームオーバー画面が出る").toBeVisible();

    const elapsedAtGameOver = await readElapsed(page);
    await waitForFrames(page, 30);
    expect(await readElapsed(page), "終了後は経過時間が進まない").toBe(elapsedAtGameOver);

    // 4. もう一度あそぶで最初からやり直せる
    await page.getByTestId("tide-keep-restart").click();
    await expect(page.getByTestId("tide-keep-gameover")).toBeHidden();
    expect(await readIntegrityPercent(page), "やり直すと砦の健全度が満タンに戻る").toBe(100);
    expect(await readWavesSurvived(page), "やり直すと突破した波の数も0に戻る").toBe(0);

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });
});
