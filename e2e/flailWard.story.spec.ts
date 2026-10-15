import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/flail-ward";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("flail-ward-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readReachedCore(page: Page): Promise<number> {
  const text = await page.getByTestId("flail-ward-reached-core").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `被弾数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Flail Ward のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも時間経過でメテオが迫りライフが減っていく", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("flail-ward-lives")).toBeVisible();
    await expect(page.getByTestId("flail-ward-gameover")).toBeHidden();

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    const livesAtStart = await readLives(page);
    expect(livesAtStart, "開始時のライフは正の値").toBeGreaterThan(0);

    // フレイルを動かさずに放置すると、四方から迫るメテオの大半がコアに命中してライフが減る。
    await expect
      .poll(() => readReachedCore(page), {
        message: "無操作でもメテオが自動でコアに到達していく",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await expect
      .poll(() => readLives(page), { message: "被弾するとライフが減る" })
      .toBeLessThan(livesAtStart);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("ドラッグでフレイルを振り回すとメテオを弾いてスコアが伸びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const radius = Math.min(box.width, box.height) * 0.35;
    const STEPS_PER_REVOLUTION = 24;
    const MAX_REVOLUTIONS = 20;

    // フレイルを一定速度で振り回し続け、四方から来るメテオを弾くチャンスを稼ぐ。
    // 得点した時点、またはゲームオーバーになった時点で早めに切り上げる。
    await page.mouse.move(center.x + radius, center.y);
    await page.mouse.down();
    let scored = false;
    for (let revolution = 0; revolution < MAX_REVOLUTIONS && !scored; revolution++) {
      for (let step = 0; step <= STEPS_PER_REVOLUTION; step++) {
        const angle = (step / STEPS_PER_REVOLUTION) * Math.PI * 2;
        await page.mouse.move(
          center.x + Math.cos(angle) * radius,
          center.y + Math.sin(angle) * radius,
        );
        await waitForFrames(page, 2);
      }
      if ((await readScore(page)) > 0) scored = true;
      if (await page.getByTestId("flail-ward-gameover").isVisible()) break;
    }
    await page.mouse.up();

    expect(await readScore(page), "振り回しているうちにメテオを弾いて得点する").toBeGreaterThan(0);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();
    expect(errors, "振り回し中にエラーが出ていない").toEqual([]);
  });

  test("矢印キー/ADキーでも回転でき、一時停止/連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await stage.click({ position: { x: 10, y: 10 } });
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 30);
    await page.keyboard.up("ArrowRight");

    await page.keyboard.down("ArrowLeft");
    await waitForFrames(page, 30);
    await page.keyboard.up("ArrowLeft");

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("d");
      await page.keyboard.press("a");
    }
    await expect(stage.locator("canvas"), "キー操作後もキャンバスが生きている").toBeVisible();

    // 一時停止するとオーバーレイが出て、スコアが止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中はライフも変わらない").toBe(livesWhilePaused);

    // 一時停止中に操作しても壊れない
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 15);
    await page.keyboard.up("ArrowRight");
    expect(await readLives(page), "一時停止中の操作でライフが変わらない").toBe(livesWhilePaused);

    // 再開 → 一時停止ボタンの連打でも最終状態と表示が一致する
    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "キー操作/一時停止中にエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、Rキーでいつでもやり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // フレイルを動かさず放置してゲームオーバーまで進める
    await expect
      .poll(() => page.getByTestId("flail-ward-gameover").isVisible(), {
        message: "無操作を続けるとライフが尽きてゲームオーバーになる",
        timeout: 20_000,
      })
      .toBe(true);
    expect(await readLives(page), "ゲームオーバー時のライフは0").toBe(0);

    // ゲームオーバー中は操作しても状態が進まない
    const scoreAtGameOver = await readScore(page);
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await waitForFrames(page, 20);
      await page.mouse.up();
    }
    expect(await readScore(page), "ゲームオーバー中は操作してもスコアが変わらない").toBe(
      scoreAtGameOver,
    );

    // ボタンでリスタート
    await page.getByTestId("flail-ward-restart").click();
    await expect(page.getByTestId("flail-ward-gameover")).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBeGreaterThan(0);

    // Rキーでもいつでもやり直せる(ゲームオーバーまで待たず、プレイ中にリセットできることを確認する)
    await stage.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("r");
    await expect(page.getByTestId("flail-ward-gameover")).toBeHidden();
    expect(await readScore(page), "Rキーのリスタートでもスコアが0に戻る").toBe(0);
    expect(await readLives(page), "Rキーのリスタートでもライフが満タンに戻る").toBeGreaterThan(0);

    expect(errors, "ゲームオーバー/リスタート中にエラーが出ていない").toEqual([]);
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
    await expect(page.getByTestId("flail-ward-lives")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付け、進行し続ける
    const reachedBeforeResize = await readReachedCore(page);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
      await page.mouse.down();
    }
    await expect
      .poll(() => readReachedCore(page), {
        message: "リサイズ後もメテオの到達が進み続ける",
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(reachedBeforeResize);
    if (box) await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
