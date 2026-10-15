import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/koi-climb";

async function readStaminaPercent(page: Page): Promise<number> {
  const text = await page.getByTestId("koi-climb-stamina").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `体力の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readDistance(page: Page): Promise<number> {
  const text = await page.getByTestId("koi-climb-distance").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `距離の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

test.describe("Koi Climb のストーリー", () => {
  test("遊び始めてから一時停止・再開までを通しで操作できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 立ち上がり: 体力満タン付近・距離ほぼ0から始まる
    await expect(page.getByTestId("koi-climb-stamina")).toBeVisible();
    expect(await readStaminaPercent(page), "開始時の体力は満タン付近").toBeGreaterThan(90);
    const startedAt = await readDistance(page);
    expect(startedAt, "開始時の距離はほぼ0").toBeLessThan(3);

    // ラウンドが実際に進む(流されるだけでも距離は伸びる)
    await expect
      .poll(() => readDistance(page), { message: "遡上距離が伸びていく" })
      .toBeGreaterThan(startedAt);

    // 鯉を動かす(このゲームの中心操作)
    const stage = page.getByTestId("game-shell-stage");
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.82 }, { xRatio: 0.2, yRatio: 0.4 });
    await waitForFrames(page, 20);

    // 一時停止するとオーバーレイが出て、進行が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const distanceAtPause = await readDistance(page);
    await waitForFrames(page, 60);
    expect(await readDistance(page), "一時停止中は距離が進まない").toBe(distanceAtPause);

    // 一時停止中に操作しても壊れない
    await dragOnStage(page, stage, { xRatio: 0.2, yRatio: 0.4 }, { xRatio: 0.7, yRatio: 0.6 });
    expect(await readDistance(page), "一時停止中の操作で距離が動かない").toBe(distanceAtPause);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readDistance(page), { message: "再開後は距離がまた伸びる" })
      .toBeGreaterThan(distanceAtPause);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("koi-climb-stamina")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");

    // 偶数回連打 → 最終的に「再開中」に戻っているはず
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    const distanceRunning = await readDistance(page);
    await expect
      .poll(() => readDistance(page), { message: "連打後も進行している" })
      .toBeGreaterThan(distanceRunning);

    // 奇数回連打 → 「一時停止中」で止まっているはず
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const distanceAtPause = await readDistance(page);
    await waitForFrames(page, 60);
    expect(await readDistance(page), "連打後の一時停止も効いている").toBe(distanceAtPause);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("放置していると体力が尽きてゲームオーバーになり、やり直せる", async ({ page }) => {
    test.setTimeout(90000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("koi-climb-stamina")).toBeVisible();

    // 何も操作せず放置すると、流れに逆らえず体力が尽きてゲームオーバーになる。
    // 素の流速だけでも約25秒で体力0に達する設計だが、通りがかりの真珠を偶然拾って
    // 多少延びることもあるため、十分な余裕を持ったタイムアウトで待つ。
    await expect
      .poll(() => page.getByTestId("koi-climb-gameover").isVisible(), {
        message: "放置しているとゲームオーバーになる",
        timeout: 75000,
      })
      .toBe(true);

    expect(await readStaminaPercent(page), "ゲームオーバー時は体力0付近").toBeLessThanOrEqual(1);

    // リスタートすると最初からやり直せる
    await page.getByTestId("koi-climb-restart").click();
    await expect(page.getByTestId("koi-climb-gameover")).toBeHidden();
    expect(await readDistance(page), "リスタートで距離が0に戻る").toBe(0);
    expect(await readStaminaPercent(page), "リスタートで体力が満タンに戻る").toBeGreaterThan(90);

    expect(errors, "ゲームオーバー〜リスタート中にエラーが出ていない").toEqual([]);
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

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.8 }, { xRatio: 0.3, yRatio: 0.4 });
    await expect
      .poll(() => readDistance(page), { message: "リサイズ後も遡上が進む" })
      .toBeGreaterThan(0);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
