import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/sensu-fold";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function readAngle(page: Page): Promise<number> {
  const text = await page.getByTestId("sensu-fold-angle").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `角度の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readTarget(page: Page): Promise<number> {
  const text = await page.getByTestId("sensu-fold-target").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `目標の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readProgress(page: Page): Promise<{ done: number; total: number }> {
  const text = await page.getByTestId("sensu-fold-progress").innerText();
  const matched = text.match(/(\d+)\/(\d+)/);
  expect(matched, `進捗の表示から枚数を読み取れる: "${text}"`).not.toBeNull();
  return { done: Number(matched?.[1] ?? Number.NaN), total: Number(matched?.[2] ?? Number.NaN) };
}

async function readWrinkleCount(page: Page): Promise<number> {
  const text = await page.getByTestId("sensu-fold-wrinkles").innerText();
  return [...text].filter((char) => char === "❤").length;
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("sensu-fold-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンドの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** ステージ上でポインタを、狙った折り角度(0〜180度)に対応するY座標へ動かす。 */
async function moveToAngle(page: Page, stage: Locator, angleDeg: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const ratio = 1 - clamp(angleDeg, 0, 180) / 180;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * ratio);
}

/** 現在のポインタ位置でクリックし、ピン留め(pin)を試みる。 */
async function pinAtPointer(page: Page): Promise<void> {
  await page.mouse.down();
  await waitForFrames(page, 3);
  await page.mouse.up();
  await waitForFrames(page, 3);
}

/** 現在表示されている目標角度へポインタを合わせてピン留めを試みる(揺れ動くため必ず成功するとは限らない)。 */
async function attemptAlignedPin(page: Page, stage: Locator): Promise<void> {
  const target = await readTarget(page);
  await moveToAngle(page, stage, target);
  await waitForFrames(page, 2);
  await pinAtPointer(page);
}

test.describe("Sensu Fold のストーリー", () => {
  test("起動直後はHUDが表示され、目標帯が時間経過で揺れ動く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("sensu-fold-gauge")).toBeVisible();
    await expect(page.getByTestId("sensu-fold-gameover")).toBeHidden();
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    const progressAtStart = await readProgress(page);
    expect(progressAtStart, "開始時は0枚目/3枚").toEqual({ done: 0, total: 3 });
    expect(await readWrinkleCount(page), "開始時はハートが3つ").toBe(3);
    expect(await readAngle(page), "開始時の角度は0度").toBe(0);

    const targetAtStart = await readTarget(page);
    await expect
      .poll(() => readTarget(page), { message: "目標角度が時間経過で揺れ動く" })
      .not.toBe(targetAtStart);

    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("目標帯へポインタを合わせてピン留めすると成功し、次のパネルへ進む", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const wrinklesBefore = await readWrinkleCount(page);
    let progress = await readProgress(page);

    for (let attempt = 0; attempt < 10 && progress.done === 0; attempt++) {
      await attemptAlignedPin(page, stage);
      progress = await readProgress(page);
    }

    expect(progress.done, "狙って合わせ続ければ少なくとも1枚は折り進む").toBeGreaterThan(0);
    // ミスをしていても構わないが、そもそもピン留めの仕組み自体は機能している必要がある。
    expect(await readWrinkleCount(page), "ライフは0未満にはならない").toBeGreaterThanOrEqual(0);
    expect(wrinklesBefore).toBeLessThanOrEqual(3);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("目標から大きく外れた角度でピン留めするとミスになりライフが減り、進捗は進まない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const wrinklesBefore = await readWrinkleCount(page);
    const progressBefore = await readProgress(page);

    // ターゲットは常に35〜145度の範囲に収まるため、反対側の端(170度)を狙えば
    // どんな揺れ方をしていても許容誤差を確実に超えてミスになる。
    await moveToAngle(page, stage, 170);
    await waitForFrames(page, 2);
    await pinAtPointer(page);

    expect(await readWrinkleCount(page), "外すとライフが1つ減る").toBe(wrinklesBefore - 1);
    expect(await readProgress(page), "ミスすると進捗は進まない").toEqual(progressBefore);
    expect(await readAngle(page), "ミス後は角度が0に戻る").toBe(0);

    expect(errors, "ミス操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止で完全に止まり、再開すると進む。連打しても状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const targetWhilePaused = await readTarget(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readTarget(page), "一時停止中は目標角度が動かない").toBe(targetWhilePaused);

    // 一時停止中にポインタを動かしても、角度も目標も変化しない
    await moveToAngle(page, stage, 20);
    await waitForFrames(page, 10);
    expect(await readAngle(page), "一時停止中はポインタ操作を受け付けない").toBe(0);

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTarget(page), { message: "再開すると目標角度がまた動き出す" })
      .not.toBe(targetWhilePaused);

    for (let i = 0; i < 4; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 3; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
  });

  test("キーボードで角度を調整しEnterでピン留めできる。Rキーでリセットできる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await stage.click({ position: { x: 10, y: 10 } });

    const angleBefore = await readAngle(page);
    await page.keyboard.down("ArrowUp");
    await waitForFrames(page, 20);
    await page.keyboard.up("ArrowUp");
    const angleAfterUp = await readAngle(page);
    expect(angleAfterUp, "↑キーで角度が増える").toBeGreaterThan(angleBefore);

    await page.keyboard.down("ArrowDown");
    await waitForFrames(page, 40);
    await page.keyboard.up("ArrowDown");
    expect(await readAngle(page), "↓キーで角度が減る").toBeLessThan(angleAfterUp);

    const wrinklesBefore = await readWrinkleCount(page);
    const progressBefore = await readProgress(page);
    await page.keyboard.press("Enter");
    await waitForFrames(page, 5);
    const wrinklesAfter = await readWrinkleCount(page);
    const progressAfter = await readProgress(page);
    expect(
      wrinklesAfter < wrinklesBefore || progressAfter.done !== progressBefore.done,
      "Enterキーでピン留めが試みられ、成功(進捗が進む)か失敗(ライフが減る)のどちらかが起きる",
    ).toBe(true);

    await page.keyboard.press("r");
    await waitForFrames(page, 5);
    expect(await readRound(page), "Rキーでラウンドが1に戻る").toBe(1);
    expect(await readProgress(page), "Rキーで進捗がリセットされる").toEqual({ done: 0, total: 3 });
    expect(await readWrinkleCount(page), "Rキーでライフが全回復する").toBe(3);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("sensu-fold-gauge")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    await moveToAngle(page, stage, 90);
    await waitForFrames(page, 5);
    await expect
      .poll(() => readAngle(page), { message: "リサイズ後もポインタ操作が反映される" })
      .toBeGreaterThan(0);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、リスタートで遊び直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("sensu-fold-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await expect(page.getByTestId("sensu-fold-gameover")).toBeHidden();

    // 反対側の端を繰り返し狙うことで、揺れ方に関係なく確実にミスし続けてライフを0にする。
    for (let i = 0; i < 3; i++) {
      await moveToAngle(page, stage, 170);
      await waitForFrames(page, 2);
      await pinAtPointer(page);
    }

    await expect(
      page.getByTestId("sensu-fold-gameover"),
      "ライフが尽きるとゲームオーバーになる",
    ).toBeVisible();
    expect(await readWrinkleCount(page), "ゲームオーバー時のライフは0").toBe(0);

    await page.getByTestId("sensu-fold-restart").click();
    await expect(
      page.getByTestId("sensu-fold-gameover"),
      "リスタートでオーバーレイが消える",
    ).toBeHidden();
    expect(await readWrinkleCount(page), "リスタートでライフが全回復する").toBe(3);
    expect(await readRound(page), "リスタートでラウンドが1に戻る").toBe(1);

    expect(errors, "ゲームオーバーとリスタートの間にエラーが出ていない").toEqual([]);
  });
});
