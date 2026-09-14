import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/powder-rush";

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("powder-rush-distance").innerText();
  const matched = text.match(/(\d+)m/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readSize(page: Page): Promise<number> {
  const text = await page.getByTestId("powder-rush-size").innerText();
  const matched = text.match(/SIZE (\d+)/);
  expect(matched, `サイズの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Powder Rush のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも距離が進み陽射しでサイズが縮んでいく", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("powder-rush-distance")).toBeVisible();
    await expect(page.getByTestId("powder-rush-size")).toBeVisible();
    await expect(page.getByTestId("powder-rush-gameover")).toBeHidden();

    const distanceAtStart = await readDistance(page);
    expect(distanceAtStart, "開始直後の距離は0以上").toBeGreaterThanOrEqual(0);
    const sizeAtStart = await readSize(page);
    expect(sizeAtStart, "開始時のサイズは初期値の16").toBe(16);

    await expect
      .poll(() => readDistance(page), { message: "無操作でも距離が進む" })
      .toBeGreaterThan(distanceAtStart);
    await expect
      .poll(() => readSize(page), { message: "無操作だと陽射しでサイズが縮んでいく" })
      .toBeLessThan(sizeAtStart);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("ドラッグ/クリックした位置へスノーボールを操作できる。連打・キーボード操作でも壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const left = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.6 };
    const right = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.6 };

    // 左右を素早く切り替えながらドラッグする(連打耐性の確認)
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(i % 2 === 0 ? left.x : right.x, left.y);
      await page.mouse.down();
      await waitForFrames(page, 5);
      await page.mouse.up();
    }
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "マウス連打後もキャンバスが生きている").toBeVisible();

    // ドラッグし続けても距離は進み続ける
    const distanceBefore = await readDistance(page);
    await page.mouse.move(right.x, right.y);
    await page.mouse.down();
    await expect
      .poll(() => readDistance(page), { message: "ドラッグ中もラウンドが進み続ける" })
      .toBeGreaterThan(distanceBefore);
    await page.mouse.up();

    for (const key of ["ArrowLeft", "a", "ArrowRight", "d"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 5);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }
    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で距離もサイズも完全に止まり、再開すると進む。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const distanceWhilePaused = await readDistance(page);
    const sizeWhilePaused = await readSize(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readDistance(page), "一時停止中は距離が進まない").toBe(distanceWhilePaused);
    expect(await readSize(page), "一時停止中はサイズも変化しない").toBe(sizeWhilePaused);

    // 一時停止中にドラッグ操作をしても、時間・見た目は止まったまま
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readDistance(page), "一時停止中の操作でも距離は止まったまま").toBe(
      distanceWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readDistance(page), { message: "再開すると距離が再び進む" })
      .toBeGreaterThan(distanceWhilePaused);

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
    await expect(page.getByTestId("powder-rush-distance")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付け、距離が進み続ける
    const distanceBeforeResize = await readDistance(page);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await page.mouse.down();
    }
    await expect
      .poll(() => readDistance(page), { message: "リサイズ後も距離が進み続ける" })
      .toBeGreaterThan(distanceBeforeResize);
    if (box) await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("何もしなければ陽射しでいずれ溶けてゲームオーバーになり、リスタートで遊び直せる", async ({
    page,
  }) => {
    // 自然減少(半径0.6/秒)だけで溶けきるまで理論上17秒前後かかり、雪だまりを偶然拾って
    // わずかに延びることもあるため、既定の60秒より大きく延長する。
    test.setTimeout(120_000);

    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await expect(page.getByTestId("powder-rush-gameover")).toBeHidden();

    // 何も操作しない(ドラッグもキー入力もしない)まま放置する
    await expect(
      page.getByTestId("powder-rush-gameover"),
      "無操作を続けると自然減少だけで必ず溶けてゲームオーバーになる",
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("powder-rush-restart")).toBeVisible();

    const sizeAtGameOver = await readSize(page);
    expect(sizeAtGameOver, "ゲームオーバー時のサイズは溶ける閾値以下").toBeLessThanOrEqual(6);

    await page.getByTestId("powder-rush-restart").click();
    await expect(
      page.getByTestId("powder-rush-gameover"),
      "リスタートでオーバーレイが消える",
    ).toBeHidden();
    await expect
      .poll(() => readSize(page), { message: "リスタートでサイズが初期値に戻る" })
      .toBe(16);

    expect(errors, "溶解とリスタートの間にエラーが出ていない").toEqual([]);
  });
});
