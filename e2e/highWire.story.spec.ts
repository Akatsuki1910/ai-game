import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/high-wire";

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("high-wire-distance").innerText();
  const matched = text.match(/(\d+)m/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readGems(page: Page): Promise<number> {
  const text = await page.getByTestId("high-wire-gems").innerText();
  const matched = text.match(/GEM (\d+)/);
  expect(matched, `ジェム数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("High Wire のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも綱の上を前進し続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("high-wire-distance")).toBeVisible();
    await expect(page.getByTestId("high-wire-gems")).toBeVisible();
    await expect(page.getByTestId("high-wire-wind")).toBeVisible();

    const distanceAtStart = await readDistance(page);
    expect(distanceAtStart, "開始直後の距離は0以上").toBeGreaterThanOrEqual(0);
    const gemsAtStart = await readGems(page);
    expect(gemsAtStart, "開始時のジェム数は0").toBe(0);

    // ピクセル比較ではなく距離の数値で判定する。スクリーンショット比較は実行環境の
    // フレームレート低下(GPU/CPUの奪い合い)の影響を受けやすく、不安定になるため。
    await expect
      .poll(() => readDistance(page), { message: "無操作でも前進して距離が増える" })
      .toBeGreaterThan(distanceAtStart);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("片側だけに体重をかけ続けると風に負けてやがて転落し、リスタートで何度でも遊び直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // 右端を押し続けて右に体重をかけ続け、逆側の風にも負けて確実に転落させる。
    const rightEdge = { x: box.x + box.width * 0.98, y: box.y + box.height * 0.5 };

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        page.getByTestId("high-wire-gameover"),
        `${attempt}回目: 開始時は非表示`,
      ).toBeHidden();

      await page.mouse.move(rightEdge.x, rightEdge.y);
      await page.mouse.down();

      await expect(
        page.getByTestId("high-wire-gameover"),
        `${attempt}回目: 片側に体重をかけ続けると転落してゲームオーバーになる`,
      ).toBeVisible({ timeout: 20_000 });

      await page.mouse.up();
      await expect(page.getByTestId("high-wire-restart")).toBeVisible();

      const distanceAtGameOver = await readDistance(page);
      expect(Number.isFinite(distanceAtGameOver), "ゲームオーバー時の距離が有限の値").toBe(true);

      await page.getByTestId("high-wire-restart").click();
      await expect(
        page.getByTestId("high-wire-gameover"),
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
    // ピクセル比較ではなく距離の数値で判定する。スクリーンショット比較は実行環境の
    // フレームレート低下(GPU/CPUの奪い合い)の影響を受けやすく、不安定になるため。
    const distanceWhilePaused = await readDistance(page);
    await waitForFrames(page, 30);
    expect(await readDistance(page), "一時停止中は前進も完全に止まる").toBe(distanceWhilePaused);

    // 一時停止中に体重をかける操作をしても、距離は止まったまま(操作自体は内部状態に効いてもよい)
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.up();
    }
    await waitForFrames(page, 15);
    expect(await readDistance(page), "一時停止中の操作でも距離は止まったまま").toBe(
      distanceWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    const distanceBeforeResume = await readDistance(page);
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    // 無操作のまま長く放置すると風に押されて転落してしまう(それ自体は仕様通り)ため、
    // 「無操作でも動く」ことの確認は距離の数値で素早く行い、転落するほど長くは待たない。
    await expect
      .poll(() => readDistance(page), { message: "再開すると距離が進む" })
      .toBeGreaterThan(distanceBeforeResume);

    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 3; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
  });

  test("マウス/キーボードで体重をかける操作を連打・左右切り替えしても壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const left = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 };
    const right = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.5 };

    // マウスで左右に体重をかける操作を素早く切り替える
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(i % 2 === 0 ? left.x : right.x, left.y);
      await page.mouse.down();
      await page.mouse.up();
    }
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "マウス連打後もキャンバスが生きている").toBeVisible();

    // キーボード(矢印キー/A・D)でも同じ操作ができる
    for (const key of ["ArrowLeft", "a", "ArrowRight", "d"]) {
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

    // リサイズ後も物理判定が生きていて、片側に体重をかけ続ければ転落する
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.98, box.y + box.height * 0.5);
      await page.mouse.down();
    }
    await expect(
      page.getByTestId("high-wire-gameover"),
      "リサイズ後も転落してゲームオーバーになる",
    ).toBeVisible({ timeout: 20_000 });
    await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
