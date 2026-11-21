import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/shaft-dispatch";

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("shaft-dispatch-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCount(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `件数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

function callButton(page: Page, floorNumber: number) {
  return page.getByTestId(`shaft-dispatch-call-${floorNumber}`);
}

test.describe("Shaft Dispatch のストーリー", () => {
  test("1Fで乗客を乗せ、別の階へ届けてスコアを得てから一時停止・再開できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCount(page, "shaft-dispatch-delivered"), "開始時は輸送0人").toBe(0);

    // 1Fには起動直後から必ず乗客が待っているので、呼べば必ず乗せられる。
    await callButton(page, 1).click();
    await expect(page.getByTestId("shaft-dispatch-doors"), "1Fで扉が開く").toHaveText("扉:開", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("shaft-dispatch-car-floor")).toHaveText("1F");
    await expect(page.getByTestId("shaft-dispatch-doors"), "乗せ終えて扉が閉まる").toHaveText(
      "扉:閉",
      { timeout: 5_000 },
    );

    // 行き先はランダムなので、残りの階を順番に呼んで必ずどこかで届ける。
    for (const floor of [2, 3, 4, 5, 6]) {
      if ((await readCount(page, "shaft-dispatch-delivered")) > 0) break;
      await callButton(page, floor).click();
      await expect(page.getByTestId("shaft-dispatch-doors")).toHaveText("扉:開", {
        timeout: 8_000,
      });
      await expect(page.getByTestId("shaft-dispatch-doors")).toHaveText("扉:閉", {
        timeout: 5_000,
      });
    }

    // 待っている間に別の乗客も相乗りし、同じ停車でまとめて届くこともあるため、
    // 「ちょうど1人」ではなく「少なくとも1人」で検証する。
    expect(
      await readCount(page, "shaft-dispatch-delivered"),
      "1人以上は必ず届けられる",
    ).toBeGreaterThanOrEqual(1);
    expect(await readScore(page), "届けると得点が入る").toBeGreaterThan(0);

    // 一時停止するとオーバーレイが出て、時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中は一時停止オーバーレイがステージを覆うため、
    // ボタンの位置を実際にタップしてもオーバーレイに吸収され、見た目には何も起きない。
    const button3Box = await callButton(page, 3).boundingBox();
    expect(button3Box, "ボタンの領域が取得できる").not.toBeNull();
    if (button3Box) {
      await page.mouse.click(
        button3Box.x + button3Box.width / 2,
        button3Box.y + button3Box.height / 2,
      );
    }
    await waitForFrames(page, 30);
    expect(await readTimerSeconds(page), "一時停止中の操作で時間が動かない").toBe(pausedAt);

    // 再開すると続きから進む
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("呼び出しボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("game-shell-score")).toBeVisible();

    // 扉が開いている間は呼び出しを無視する設計なので、連打しても壊れない。
    for (let i = 0; i < 15; i++) {
      await callButton(page, (i % 6) + 1).click();
    }
    await waitForFrames(page, 30);

    const runningAt = await readTimerSeconds(page);
    await expect
      .poll(() => readTimerSeconds(page), { message: "連打後も進行している" })
      .toBeLessThan(runningAt);

    // 一時停止ボタンの連打でも最終状態がずれない
    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "連打後の一時停止も効いている").toBe(pausedAt);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("待たせすぎた乗客は見送られてしまい、ミスとして記録される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 1Fの乗客をあえて迎えに行かず放置する。忍耐が尽きるまで待つ。
    expect(await readCount(page, "shaft-dispatch-missed"), "開始時はミス0件").toBe(0);

    await expect
      .poll(() => readCount(page, "shaft-dispatch-missed"), {
        message: "放置された乗客がやがて見送りになる",
        timeout: 25_000,
      })
      .toBeGreaterThan(0);

    expect(errors, "放置中にエラーが出ていない").toEqual([]);
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

    // リサイズ後もドラッグなどの操作で壊れない(このゲームはボタン操作が主だが、キャンバスを触っても問題ないこと)
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.35 });

    // リサイズ後もボタンでの呼び出しが機能する(1Fまで実際に車が動く)
    await callButton(page, 1).click();
    await expect(
      page.getByTestId("shaft-dispatch-car-floor"),
      "リサイズ後も呼び出しで車が動く",
    ).toHaveText("1F", { timeout: 8_000 });
    await expect
      .poll(() => readTimerSeconds(page), { message: "リサイズ後もラウンドが進む" })
      .toBeLessThan(90);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
