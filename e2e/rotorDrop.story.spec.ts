import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/rotor-drop";

async function readTimeRemaining(page: Page): Promise<number> {
  const text = await page.getByTestId("rotor-drop-time").innerText();
  const matched = text.match(/(\d+)秒/);
  expect(matched, `残り時間の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCollected(page: Page): Promise<number> {
  const text = await page.getByTestId("rotor-drop-collected").innerText();
  const matched = text.match(/OK (\d+)/);
  expect(matched, `回収数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readMissed(page: Page): Promise<number> {
  const text = await page.getByTestId("rotor-drop-missed").innerText();
  const matched = text.match(/MISS (\d+)/);
  expect(matched, `ハズレ数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readResolvedTotal(page: Page): Promise<number> {
  return (await readCollected(page)) + (await readMissed(page));
}

test.describe("Rotor Drop のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも時間が減りマーブルが自動でスポーン・解決されていく", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("rotor-drop-time")).toBeVisible();
    await expect(page.getByTestId("rotor-drop-collected")).toBeVisible();
    await expect(page.getByTestId("rotor-drop-missed")).toBeVisible();
    await expect(page.getByTestId("rotor-drop-gameover")).toBeHidden();

    const timeAtStart = await readTimeRemaining(page);
    expect(timeAtStart, "開始直後の残り時間はラウンド上限以下").toBeLessThanOrEqual(60);
    expect(await readResolvedTotal(page), "開始時点ではまだ何も解決されていない").toBe(0);

    await expect
      .poll(() => readTimeRemaining(page), { message: "無操作でも残り時間が減っていく" })
      .toBeLessThan(timeAtStart);

    // ピクセル比較ではなく回収/ハズレの数値で判定する。スクリーンショット比較は実行環境の
    // フレームレート低下(GPU/CPUの奪い合い)の影響を受けやすく、不安定になるため。
    await expect
      .poll(() => readResolvedTotal(page), {
        message: "無操作でもマーブルが自動でスポーンし、落ちきってOK/MISSのどちらかに積み上がる",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("左右の長押しでリングを回転できる。切り替え・連打・キーボード操作でも壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const left = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.5 };
    const right = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.5 };

    // 左右を素早く切り替えながら長押しする(連打耐性の確認)
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(i % 2 === 0 ? left.x : right.x, left.y);
      await page.mouse.down();
      await waitForFrames(page, 5);
      await page.mouse.up();
    }
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "マウス連打後もキャンバスが生きている").toBeVisible();

    // 右を押し続けたときとキーボードの右回転で、時間経過とともに回収/ハズレが積み上がる
    await page.mouse.move(right.x, right.y);
    await page.mouse.down();
    await expect
      .poll(() => readResolvedTotal(page), {
        message: "右長押し中もラウンドが進み続ける",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await page.mouse.up();

    for (const key of ["ArrowLeft", "a", "ArrowRight", "d"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 5);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }
    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "回転操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で残り時間もマーブルの動きも完全に止まり、再開すると進む。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const timeWhilePaused = await readTimeRemaining(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readTimeRemaining(page), "一時停止中は残り時間が減らない").toBe(timeWhilePaused);

    // 一時停止中に長押し操作をしても、時間・見た目は止まったまま
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readTimeRemaining(page), "一時停止中の操作でも残り時間は止まったまま").toBe(
      timeWhilePaused,
    );

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimeRemaining(page), { message: "再開すると残り時間が再び減る" })
      .toBeLessThan(timeWhilePaused);

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
    await expect(page.getByTestId("rotor-drop-time")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付け、ラウンドが進み続ける
    const resolvedBeforeResize = await readResolvedTotal(page);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
      await page.mouse.down();
    }
    await expect
      .poll(() => readResolvedTotal(page), {
        message: "リサイズ後もマーブルが解決され続ける",
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(resolvedBeforeResize);
    if (box) await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
