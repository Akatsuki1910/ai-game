import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/grapple-arc";

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("grapple-arc-distance").innerText();
  const matched = text.match(/(\d+)m/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCombo(page: Page): Promise<{ combo: number; best: number }> {
  const text = await page.getByTestId("grapple-arc-combo").innerText();
  const matched = text.match(/COMBO (\d+) \(BEST (\d+)\)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return { combo: Number(matched?.[1] ?? Number.NaN), best: Number(matched?.[2] ?? Number.NaN) };
}

/** 2枚のスクリーンショットが同じかどうかを返す（一時停止で本当に止まっているかの確認に使う）。 */
async function isFrozen(page: Page, stage: Locator, frames: number): Promise<boolean> {
  const before = await stage.screenshot();
  await waitForFrames(page, frames);
  const after = await stage.screenshot();
  return before.equals(after);
}

/** 開始直後にロープを放し、何もつかまなければ重力でいずれ必ず谷底へ落ちる（乱数配置のアンカーには依存しない）。 */
async function releaseRope(stage: Locator): Promise<void> {
  await stage.click();
}

test.describe("Grapple Arc のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも振り子として動き続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("grapple-arc-distance")).toBeVisible();
    await expect(page.getByTestId("grapple-arc-combo")).toBeVisible();

    const distance = await readDistance(page);
    expect(distance, "距離は0以上の数値").toBeGreaterThanOrEqual(0);
    const combo = await readCombo(page);
    expect(combo.combo, "開始時のコンボは0").toBe(0);
    expect(combo.best, "開始時のベストコンボは0").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    expect(await isFrozen(page, stage, 40), "無操作でも振り子が揺れて画面が変化する").toBe(false);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("ロープを放すと自由落下になり谷底でゲームオーバーになる。リスタートで何度でも遊び直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        page.getByTestId("grapple-arc-gameover"),
        `${attempt}回目: 開始時は非表示`,
      ).toBeHidden();

      await releaseRope(stage);

      await expect(
        page.getByTestId("grapple-arc-gameover"),
        `${attempt}回目: 重力で必ず谷底に落ちてゲームオーバーになる`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("grapple-arc-restart")).toBeVisible();

      const distanceAtGameOver = await readDistance(page);
      expect(Number.isFinite(distanceAtGameOver), "ゲームオーバー時の距離が有限の値").toBe(true);

      await page.getByTestId("grapple-arc-restart").click();
      await expect(
        page.getByTestId("grapple-arc-gameover"),
        `${attempt}回目: リスタートでオーバーレイが消える`,
      ).toBeHidden();
    }

    expect(errors, "転落とリスタートを繰り返してもエラーが出ていない").toEqual([]);
  });

  test("一時停止で画面が完全に止まり、再開すると動き出す。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    expect(await isFrozen(page, stage, 45), "一時停止中は振り子も完全に止まる").toBe(true);

    // 一時停止中に掴む/放す操作をしても、描画は止まったまま（操作自体は内部状態に効いてもよい）
    await stage.click();
    expect(await isFrozen(page, stage, 20), "一時停止中の操作でも画面は止まったまま").toBe(true);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    expect(await isFrozen(page, stage, 45), "再開すると画面がまた動き出す").toBe(false);

    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
  });

  test("マウス/キーボードでの掴む・放すを連打しても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // マウスで素早く掴む/放すを繰り返す
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.up();
    }
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "マウス連打後もキャンバスが生きている").toBeVisible();

    // キーボード（↑ / W）でも同じ操作ができる
    await stage.click({ position: { x: 5, y: 5 } });
    await waitForFrames(page, 10);
    for (const key of ["ArrowUp", "w"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 5);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }
    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続き、転落判定も機能し続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も物理判定が生きていて、放せばゲームオーバーになる
    await releaseRope(stage);
    await expect(
      page.getByTestId("grapple-arc-gameover"),
      "リサイズ後も転落してゲームオーバーになる",
    ).toBeVisible({ timeout: 15_000 });

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
