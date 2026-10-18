import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/kyusu-pour";

// 離したあとも急須が戻りきるまで注がれる分と、離す操作が届くまでの遅れ(モバイル相当の
// エミュレーションでは1操作あたり100ms超)を見越して、「水位+空中の分」が目標のこれだけ手前に
// 来た時点で離す。遅れが0.05〜0.28秒の範囲で高評価に収まる値。
const RELEASE_MARGIN_PERCENT = 22;

async function readNumber(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `${testId} の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

const readLives = (page: Page) => readNumber(page, "kyusu-pour-lives");
const readSpill = (page: Page) => readNumber(page, "kyusu-pour-spill");
const readServed = (page: Page) => readNumber(page, "kyusu-pour-served");

/** ポインタをステージ中央へ移動しておく(押す瞬間の操作を mouse.down の1回だけにするため)。 */
async function hoverStageCenter(page: Page, stage: Locator): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/** ステージ中央で押しっぱなしにする(マウスでもタッチでも同じ PointerEvent 経路を通る)。 */
async function pressOnStage(page: Page, stage: Locator): Promise<void> {
  await hoverStageCenter(page, stage);
  await page.mouse.down();
}

test.describe("Kyusu Pour のストーリー", () => {
  test("湯呑みが注ぎ口の下に来たら長押しで注ぎ、白い線の手前で離すと得点できる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    const gauge = page.getByTestId("kyusu-pour-gauge");

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時のライフは満タン").toBe(3);
    expect(await readSpill(page), "開始時はこぼれていない").toBe(0);
    expect(await readServed(page), "開始時は提供0杯").toBe(0);
    await expect(gauge, "最初の湯呑みはまだ流れてくる途中").toHaveAttribute(
      "data-under-spout",
      "false",
    );

    // 湯呑みが注ぎ口の下にいる時間は1秒程度しかないため、到着は毎フレーム監視し、
    // 到着したら mouse.down だけで注ぎ始められるようポインタを先に置いておく。
    await hoverStageCenter(page, stage);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="kyusu-pour-gauge"]')
          ?.getAttribute("data-under-spout") === "true",
      undefined,
      { polling: "raf", timeout: 20_000 },
    );
    await page.mouse.down();
    // 表示中の「水位%（+空中%）／目標%」を毎フレーム読み、目標に届く直前で離す(プレイヤーと同じ判断)
    await page.waitForFunction(
      (margin) => {
        const text = document.querySelector('[data-testid="kyusu-pour-gauge"]')?.textContent ?? "";
        const matched = text.match(/(\d+)%（\+(\d+)%）／目標\s*(\d+)%/);
        if (!matched) return false;
        return Number(matched[1]) + Number(matched[2]) >= Number(matched[3]) - margin;
      },
      RELEASE_MARGIN_PERCENT,
      { polling: "raf", timeout: 10_000 },
    );
    await page.mouse.up();

    await expect
      .poll(() => readServed(page), { message: "湯呑みが採点されて提供数が増える" })
      .toBe(1);
    const grade = await page.getByTestId("kyusu-pour-last-grade").getAttribute("data-grade");
    expect(["perfect", "good"], `高評価で提供できる: ${grade}`).toContain(grade);
    expect(await readScore(page), "得点が入る").toBeGreaterThan(0);
    expect(await readLives(page), "成功ならライフは減らない").toBe(3);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("湯呑みが無いところへ注ぎ続けるとこぼれが溜まり、こぼしすぎるとライフが減る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 押さずにポインタを乗せて動かすだけでは注がれない(PCのマウスホバー)
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 10 });
    }
    await hoverStageCenter(page, stage);
    await waitForFrames(page, 45);
    expect(await readSpill(page), "ホバーだけではこぼれない").toBe(0);

    await pressOnStage(page, stage);
    await expect
      .poll(() => readSpill(page), { message: "注ぎ口の下が空なのでこぼれが溜まる" })
      .toBeGreaterThan(0);
    await expect
      .poll(() => readLives(page), { message: "こぼしすぎでライフが減る" })
      .toBeLessThan(3);
    await page.mouse.up();
    expect(await readSpill(page), "ライフと引き換えにこぼれ量はリセットされる").toBeLessThan(100);

    expect(errors, "こぼしている間にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はステージを押しても注がれず、再開後はキーボードでも注げる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    // 一時停止中はオーバーレイに覆われ、長押ししても急須は傾かない
    await pressOnStage(page, stage);
    await waitForFrames(page, 60);
    await page.mouse.up();
    expect(await readSpill(page), "一時停止中の長押しでこぼれない").toBe(0);

    // 一時停止中は画面が止まっている
    const pausedShot = await stage.screenshot();
    await waitForFrames(page, 30);
    expect(pausedShot.equals(await stage.screenshot()), "一時停止中は描画が進まない").toBe(true);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await page.keyboard.down("ArrowDown");
    await expect
      .poll(() => readSpill(page), { message: "↓キー長押しでも注げる" })
      .toBeGreaterThan(0);
    await page.keyboard.up("ArrowDown");

    expect(errors, "一時停止/再開でエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と進行がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    const pauseButton = page.getByTestId("game-shell-pause");

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");
    await expect(
      page.getByTestId("kyusu-pour-gauge"),
      "連打後も進行して湯呑みが流れてくる",
    ).toHaveAttribute("data-under-spout", "true", { timeout: 20_000 });

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");
    const pausedShot = await stage.screenshot();
    await waitForFrames(page, 30);
    expect(pausedShot.equals(await stage.screenshot()), "連打後の一時停止も効いている").toBe(true);

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても注ぐ操作が効き続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("kyusu-pour-gauge")).toBeVisible();

    await pressOnStage(page, stage);
    await expect
      .poll(() => readSpill(page), { message: "リサイズ後も長押しで注げる" })
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("押しっぱなしで注ぎ続けるとライフが尽きて閉店し、リスタートで最初からやり直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await pressOnStage(page, stage);
    await expect(page.getByTestId("kyusu-pour-gameover"), "ライフが尽きて閉店する").toBeVisible({
      timeout: 30_000,
    });
    await page.mouse.up();
    expect(await readLives(page), "閉店時のライフは0").toBe(0);

    await page.getByTestId("kyusu-pour-restart").click();
    await expect(
      page.getByTestId("kyusu-pour-gameover"),
      "リスタートで閉店表示が消える",
    ).toBeHidden();
    await expect.poll(() => readLives(page), { message: "ライフが満タンに戻る" }).toBe(3);
    await expect.poll(() => readScore(page), { message: "スコアが0に戻る" }).toBe(0);
    await expect.poll(() => readServed(page), { message: "提供数が0に戻る" }).toBe(0);

    expect(errors, "閉店/リスタート中にエラーが出ていない").toEqual([]);
  });
});
