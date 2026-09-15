import { expect, type Page, test } from "@playwright/test";
import {
  collectPageErrors,
  dragOnStage,
  expectStageToAnimate,
  waitForFrames,
} from "./support/gameStory";

const GAME_PATH = "/games/frost-curl";

async function readStonesLeft(page: Page): Promise<string> {
  return page.getByTestId("frost-curl-stones-left").innerText();
}

async function readEnd(page: Page): Promise<string> {
  return page.getByTestId("frost-curl-end").innerText();
}

/** ハックから引いて離す投球ドラッグ(下方向へ引くと逆方向=ハウス側へ発射される)。 */
async function throwByDrag(page: Page): Promise<void> {
  const stage = page.getByTestId("game-shell-stage");
  await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.32 }, { xRatio: 0.5, yRatio: 0.7 });
}

/** 準備が整うまで待たずに Enter を連打し、投球できるタイミングで自然に投げさせる。 */
async function throwWhenReady(page: Page, expectedStonesLeft: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Enter");
        return readStonesLeft(page);
      },
      { message: `投球できるようになったら残り石が ${expectedStonesLeft} になる`, timeout: 15_000 },
    )
    .toBe(expectedStonesLeft);
}

/** ゲームオーバーになるまで Enter を連打し続ける(投球できないタイミングでの押下は無視される)。 */
async function throwUntilGameOver(page: Page): Promise<void> {
  const gameOver = page.getByTestId("frost-curl-game-over");
  for (let i = 0; i < 500; i++) {
    if (await gameOver.isVisible()) return;
    await page.keyboard.press("Enter");
    await waitForFrames(page, 6);
  }
}

test.describe("Frost Curl のストーリー", () => {
  test("投球してエンドが進み、一時停止・再開も効く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("frost-curl-end")).toHaveText("END 1 / 5");
    await expect(page.getByTestId("frost-curl-stones-left")).toHaveText("残り石 2");

    // 1投目: ドラッグして引っ張り離す(PCのドラッグ/スマホのスワイプ相当)
    await throwByDrag(page);
    await expect
      .poll(() => readStonesLeft(page), { message: "1投目で残り石が減る" })
      .toBe("残り石 1");

    // 一時停止中は投球が反映されない
    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    // フォーカスが一時停止ボタンに残ったままだと Enter がボタン自体を再度クリックしてしまうため外す
    await pauseButton.evaluate((el) => el.blur());
    await page.keyboard.press("Enter");
    await waitForFrames(page, 30);
    expect(await readStonesLeft(page), "一時停止中は投球が進まない").toBe("残り石 1");

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // 2投目: 準備が整い次第 Enter で投球し、エンドが確定して次のエンドへ進む
    await throwWhenReady(page, "残り石 0");
    await expect
      .poll(() => readEnd(page), { message: "エンド確定後は次のエンドへ進む", timeout: 15_000 })
      .toBe("END 2 / 5");
    await expect(page.getByTestId("frost-curl-stones-left")).toHaveText("残り石 2");

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("カール方向の切り替えとスイープ操作ができる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const spinToggle = page.getByTestId("frost-curl-spin-toggle");
    const initialLabel = await spinToggle.innerText();
    await spinToggle.click(); // 1回目: 切り替わる
    await expect(spinToggle).not.toHaveText(initialLabel);
    // 連打しても表示と状態がずれない(奇数回で反転、偶数回で元に戻る)
    await spinToggle.click(); // 2回目: 元に戻る
    await expect(spinToggle).toHaveText(initialLabel);
    await spinToggle.click(); // 3回目: 切り替わる
    await spinToggle.click(); // 4回目: 元に戻る
    await expect(spinToggle).toHaveText(initialLabel);

    await expect(page.getByTestId("frost-curl-sweep-indicator")).toHaveText("スイープ待機");

    // 強めに投げて飛行時間を確保し、飛行中に長押ししてスイープさせる
    const stage = page.getByTestId("game-shell-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await dragOnStage(page, stage, { xRatio: 0.5, yRatio: 0.3 }, { xRatio: 0.5, yRatio: 0.8 });

    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await expect
      .poll(() => page.getByTestId("frost-curl-sweep-indicator").innerText(), {
        message: "長押し中はスイープ状態になる",
      })
      .toBe("スイープ中");
    await page.mouse.up();
    await expect
      .poll(() => page.getByTestId("frost-curl-sweep-indicator").innerText(), {
        message: "離すとスイープが止まる",
      })
      .toBe("スイープ待機");

    expect(errors, "カール切替・スイープ操作でエラーが出ていない").toEqual([]);
  });

  test("全エンドを終えるとゲームオーバーになり、リスタートで最初から遊べる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await throwUntilGameOver(page);
    await expect(page.getByTestId("frost-curl-game-over"), "5エンド終えると終了する").toBeVisible();
    await expect(page.getByTestId("frost-curl-restart")).toBeVisible();

    await page.getByTestId("frost-curl-restart").click();
    await expect(page.getByTestId("frost-curl-game-over")).toBeHidden();
    await expect(page.getByTestId("frost-curl-end")).toHaveText("END 1 / 5");
    expect(await page.getByTestId("game-shell-score").innerText()).toContain("0");

    expect(errors, "ゲームオーバーとリスタートでエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await expectStageToAnimate(page, stage);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も投球操作が効く
    await throwByDrag(page);
    await expect
      .poll(() => readStonesLeft(page), { message: "リサイズ後も投球が反映される" })
      .toBe("残り石 1");

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
