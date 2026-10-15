import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/rapids-weave";

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("rapids-weave-distance").innerText();
  const matched = text.match(/(\d+)m/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("rapids-weave-lives").innerText();
  return [...text].filter((ch) => ch === "♥").length;
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("Rapids Weave のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも川を下って距離とスコアが伸びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("rapids-weave-distance")).toBeVisible();
    await expect(page.getByTestId("rapids-weave-lives")).toBeVisible();

    const distanceAtStart = await readDistance(page);
    expect(distanceAtStart, "開始直後の距離は0以上").toBeGreaterThanOrEqual(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(3);

    // ピクセル比較ではなく表示されている数値で判定する。スクリーンショット比較は実行環境の
    // フレームレート低下(GPU/CPUの奪い合い)の影響を受けやすく、不安定になるため。
    await expect
      .poll(() => readDistance(page), { message: "無操作でも前進して距離が増える" })
      .toBeGreaterThan(distanceAtStart);
    await expect
      .poll(() => readScore(page), { message: "距離が伸びるぶんスコアも増える" })
      .toBeGreaterThan(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("片側の岸へ傾け続けると衝突を繰り返してライフが尽きてゲームオーバーになり、リスタートで何度でも遊び直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // 画面の右端を押し続けて右へ傾け続け、岸に何度もぶつけて確実にライフを失わせる。
    const rightEdge = { x: box.x + box.width * 0.98, y: box.y + box.height * 0.5 };

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        page.getByTestId("rapids-weave-gameover"),
        `${attempt}回目: 開始時は非表示`,
      ).toBeHidden();
      expect(await readLives(page), `${attempt}回目: 開始時はライフ満タン`).toBe(3);

      await page.mouse.move(rightEdge.x, rightEdge.y);
      await page.mouse.down();

      await expect(
        page.getByTestId("rapids-weave-gameover"),
        `${attempt}回目: 右岸に当たり続けるとライフが尽きてゲームオーバーになる`,
      ).toBeVisible({ timeout: 20_000 });

      await page.mouse.up();
      await expect(page.getByTestId("rapids-weave-restart")).toBeVisible();

      const distanceAtGameOver = await readDistance(page);
      expect(Number.isFinite(distanceAtGameOver), "ゲームオーバー時の距離が有限の値").toBe(true);

      await page.getByTestId("rapids-weave-restart").click();
      await expect(
        page.getByTestId("rapids-weave-gameover"),
        `${attempt}回目: リスタートでオーバーレイが消える`,
      ).toBeHidden();
      expect(await readLives(page), `${attempt}回目: リスタート後はライフが満タンに戻る`).toBe(3);
    }

    expect(errors, "ゲームオーバーとリスタートを繰り返してもエラーが出ていない").toEqual([]);
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

    // 一時停止中に操舵しても、距離は止まったまま(内部状態が動いてもよい)
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

  test("マウス/キーボードで左右に傾ける操作を連打・切り替えしても壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const left = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 };
    const right = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.5 };

    // マウスで左右の傾きを素早く切り替える
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

  test("画面サイズが変わっても遊べる状態が続き、衝突判定も機能し続ける", async ({ page }) => {
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

    // リサイズ後も物理判定が生きていて、片側に傾け続ければ岸に当たってゲームオーバーになる
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.98, box.y + box.height * 0.5);
      await page.mouse.down();
    }
    await expect(
      page.getByTestId("rapids-weave-gameover"),
      "リサイズ後も衝突を繰り返してゲームオーバーになる",
    ).toBeVisible({ timeout: 20_000 });
    await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
