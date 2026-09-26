import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/ember-loft";

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("ember-loft-distance").innerText();
  const matched = text.match(/(\d+)m/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readOrbs(page: Page): Promise<number> {
  const text = await page.getByTestId("ember-loft-orbs").innerText();
  const matched = text.match(/ORB (\d+)/);
  expect(matched, `オーブ数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readIntegrityPercent(page: Page): Promise<number> {
  const fill = page.getByTestId("ember-loft-integrity").locator("div");
  const width = await fill.evaluate((el) => el.style.width);
  const matched = width.match(/([\d.]+)%/);
  expect(matched, `耐久バーの幅から数値を読み取れる: "${width}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Ember Loft のストーリー", () => {
  test("起動直後はHUDが表示され、無操作だと熱を失って地面に墜落する", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("ember-loft-distance")).toBeVisible();
    await expect(page.getByTestId("ember-loft-orbs")).toBeVisible();
    await expect(page.getByTestId("ember-loft-wind")).toBeVisible();
    await expect(page.getByTestId("ember-loft-integrity")).toBeVisible();
    await expect(page.getByTestId("ember-loft-heat")).toBeVisible();

    const orbsAtStart = await readOrbs(page);
    expect(orbsAtStart, "開始時のオーブ数は0").toBe(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 何もしなければバーナーが点火されず熱を失い続け、地面に触れて墜落する。
    await expect(
      page.getByTestId("ember-loft-gameover"),
      "無操作のまま放置すると墜落してゲームオーバーになる",
    ).toBeVisible({ timeout: 20_000 });

    expect(errors, "起動〜墜落までエラーが出ていない").toEqual([]);
  });

  test("バーナーを長押しし続けると墜落せずに飛び続けられ、リスタートで何度でも遊び直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const center = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };

    await page.mouse.move(center.x, center.y);
    await page.mouse.down();

    const distanceAtStart = await readDistance(page);
    await expect
      .poll(() => readDistance(page), {
        message: "バーナーを点火し続けている間は前進を続ける",
        timeout: 10_000,
      })
      .toBeGreaterThan(distanceAtStart);
    await expect(
      page.getByTestId("ember-loft-gameover"),
      "点火し続けている間は墜落しない",
    ).toBeHidden();

    await page.mouse.up();

    // 手を離して熱を失わせ、地面に落ちて墜落させる。
    await expect(
      page.getByTestId("ember-loft-gameover"),
      "手を離し続けると熱を失い墜落する",
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ember-loft-restart")).toBeVisible();

    await page.getByTestId("ember-loft-restart").click();
    await expect(
      page.getByTestId("ember-loft-gameover"),
      "リスタートでオーバーレイが消える",
    ).toBeHidden();
    const integrityAfterRestart = await readIntegrityPercent(page);
    expect(integrityAfterRestart, "リスタート後は耐久が全回復している").toBe(100);

    expect(errors, "墜落とリスタートを繰り返してもエラーが出ていない").toEqual([]);
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
    const distanceWhilePaused = await readDistance(page);
    await waitForFrames(page, 30);
    expect(await readDistance(page), "一時停止中は前進も完全に止まる").toBe(distanceWhilePaused);

    // 一時停止中にバーナーを操作しても、距離は止まったまま(操作自体は内部状態に効いてもよい)
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.up();
    }
    await waitForFrames(page, 15);
    expect(await readDistance(page), "一時停止中の操作でも距離は止まったまま").toBe(
      distanceWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 3; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
  });

  test("マウス連打とキーボード長押しの両方でバーナーを操作でき、連打しても壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const center = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };

    // マウスで点火/消火を素早く連打する
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await waitForFrames(page, 2);
      await page.mouse.up();
    }
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "マウス連打後もキャンバスが生きている").toBeVisible();

    // キーボード(↑/W)でも同じ操作ができる
    for (const key of ["ArrowUp", "w"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 10);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }
    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "連打操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続き、墜落判定も機能し続ける", async ({ page }) => {
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

    // リサイズ後も物理判定が生きていて、無操作を続ければ墜落する
    await expect(
      page.getByTestId("ember-loft-gameover"),
      "リサイズ後も無操作を続ければ墜落してゲームオーバーになる",
    ).toBeVisible({ timeout: 20_000 });

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
