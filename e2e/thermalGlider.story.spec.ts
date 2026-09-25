import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/thermal-glider";

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("thermal-glider-distance").innerText();
  const matched = text.match(/(\d+)m/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readAltitude(page: Page): Promise<number> {
  const text = await page.getByTestId("thermal-glider-altitude").innerText();
  const matched = text.match(/ALT (\d+)/);
  expect(matched, `高度の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Thermal Glider のストーリー", () => {
  test("起動直後はHUDが表示され、無操作でも距離が進み重力で高度が下がっていく", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("thermal-glider-distance")).toBeVisible();
    await expect(page.getByTestId("thermal-glider-altitude")).toBeVisible();
    await expect(page.getByTestId("thermal-glider-gameover")).toBeHidden();

    const distanceAtStart = await readDistance(page);
    expect(distanceAtStart, "開始直後の距離は0以上").toBeGreaterThanOrEqual(0);
    const altitudeAtStart = await readAltitude(page);
    // 読み取りタイミングによっては既に沈降で数フレーム分減っていることがあるため、
    // 厳密な初期値(70)との完全一致ではなく初期値付近であることを確認する。
    expect(altitudeAtStart, "開始時の高度は初期値の70付近").toBeGreaterThanOrEqual(65);
    expect(altitudeAtStart, "開始時の高度は初期値の70を超えない").toBeLessThanOrEqual(70);

    await expect
      .poll(() => readDistance(page), { message: "無操作でも距離が進む" })
      .toBeGreaterThan(distanceAtStart);
    await expect
      .poll(() => readAltitude(page), { message: "無操作だと重力で高度が下がっていく" })
      .toBeLessThan(altitudeAtStart);

    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas"), "動いている間もキャンバスが生きている").toBeVisible();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("ドラッグ/クリックした位置へグライダーを操作できる。連打・キーボード操作でも壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const upLeft = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.2 };
    const downRight = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.8 };

    // 上下左右を素早く切り替えながらドラッグする(連打耐性の確認)
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(i % 2 === 0 ? upLeft.x : downRight.x, upLeft.y);
      await page.mouse.down();
      await waitForFrames(page, 5);
      await page.mouse.up();
    }
    await waitForFrames(page, 10);
    await expect(stage.locator("canvas"), "マウス連打後もキャンバスが生きている").toBeVisible();

    // 上方向にドラッグし続けても壊れず、距離は進み続ける
    const distanceBeforeHold = await readDistance(page);
    await page.mouse.move(upLeft.x, upLeft.y);
    await page.mouse.down();
    await expect
      .poll(() => readDistance(page), { message: "上方向へのドラッグ中も距離が進み続ける" })
      .toBeGreaterThan(distanceBeforeHold);
    await page.mouse.up();

    for (const key of ["ArrowLeft", "a", "ArrowRight", "d", "ArrowUp", "w", "ArrowDown", "s"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 5);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }
    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();

    expect(errors, "操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で距離も高度も完全に止まり、再開すると進む。連打しても状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const distanceWhilePaused = await readDistance(page);
    const altitudeWhilePaused = await readAltitude(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readDistance(page), "一時停止中は距離が進まない").toBe(distanceWhilePaused);
    expect(await readAltitude(page), "一時停止中は高度も変化しない").toBe(altitudeWhilePaused);

    // 一時停止中にドラッグ操作をしても、時間・見た目は止まったまま
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
      await page.mouse.down();
      await waitForFrames(page, 15);
      await page.mouse.up();
    }
    expect(await readAltitude(page), "一時停止中の操作でも高度は止まったまま").toBe(
      altitudeWhilePaused,
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
    await expect(page.getByTestId("thermal-glider-distance")).toBeVisible();

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

  test("何もしなければ重力でいずれ墜落してゲームオーバーになり、リスタートで遊び直せる", async ({
    page,
  }) => {
    // 沈降(高度3/秒)だけで墜落しきるまで理論上23秒前後かかり、サーマルを偶然拾って
    // わずかに延びることもあるため、既定の60秒より大きく延長する。
    test.setTimeout(120_000);

    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await expect(page.getByTestId("thermal-glider-gameover")).toBeHidden();

    // 何も操作しない(ドラッグもキー入力もしない)まま放置する
    await expect(
      page.getByTestId("thermal-glider-gameover"),
      "無操作を続けると重力による沈降だけで必ず墜落してゲームオーバーになる",
    ).toBeVisible({ timeout: 100_000 });
    await expect(page.getByTestId("thermal-glider-restart")).toBeVisible();

    const altitudeAtGameOver = await readAltitude(page);
    expect(altitudeAtGameOver, "ゲームオーバー時の高度は0").toBe(0);

    await page.getByTestId("thermal-glider-restart").click();
    await expect(
      page.getByTestId("thermal-glider-gameover"),
      "リスタートでオーバーレイが消える",
    ).toBeHidden();
    await expect
      .poll(() => readAltitude(page), { message: "リスタートで高度が初期値付近まで戻る" })
      .toBeGreaterThan(50);

    expect(errors, "墜落とリスタートの間にエラーが出ていない").toEqual([]);
  });
});
