import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/longbow-breeze";
const START_LIVES = 3;
// 低スペック環境でのフレーム供給遅延を見込んだ、1射の結果が出るまでの待ち時間
// (AGENTS.mdの既知のハマりどころ参照)。
const SHOT_RESOLVE_TIMEOUT_MS = 20_000;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("longbow-breeze-lives").innerText();
  return [...text].filter((char) => char === "♥").length;
}

async function readShotNumber(page: Page): Promise<number> {
  const text = await page.getByTestId("longbow-breeze-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `射目の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function waitForCanvas(page: Page): Promise<Locator> {
  const stage = page.getByTestId("game-shell-stage");
  await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();
  return stage;
}

/**
 * ステージ上でマウスをドラッグして引っ張り、離す(=矢を放つ操作)。
 * dx/dyPixels は「引っ張った方向」で、矢は常にその逆方向(右上)へ飛ぶ。
 */
async function pullAndRelease(
  page: Page,
  stage: Locator,
  origin: { xRatio: number; yRatio: number },
  dxPixels: number,
  dyPixels: number,
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;

  const startX = box.x + box.width * origin.xRatio;
  const startY = box.y + box.height * origin.yRatio;
  const endX = startX + dxPixels;
  const endY = startY + dyPixels;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();
}

/**
 * ほぼ水平(仰角はエンジン側の下限である6°にクランプされる)・最小パワー近辺の
 * 弱いドラッグで矢を放つ。的の最小距離(画面幅の50%弱 - 弓の位置12%)は、この強さ・
 * 角度で届く最大距離(画面の短辺の3割未満)を常に上回るため、的の位置や風(乱数)に
 * 関係なく毎回「届かず地面に落ちるミス」になる。
 */
async function fireGuaranteedShortShot(page: Page, stage: Locator): Promise<void> {
  await pullAndRelease(page, stage, { xRatio: 0.4, yRatio: 0.6 }, -23, 2);
}

/** 中程度の力・斜め45°付近で矢を放つ(的に当たるか外れるかは乱数次第)。 */
async function fireMediumShot(page: Page, stage: Locator): Promise<void> {
  await pullAndRelease(page, stage, { xRatio: 0.5, yRatio: 0.55 }, -70, 70);
}

test.describe("Longbow Breeze のストーリー", () => {
  test("起動直後はHUDが揃った状態で的が表示される", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("longbow-breeze-lives")).toBeVisible();
    await expect(page.getByTestId("longbow-breeze-wind")).toBeVisible();
    await expect(page.getByTestId("longbow-breeze-round")).toBeVisible();
    await expect(page.getByTestId("longbow-breeze-game-over")).toHaveCount(0);

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readLives(page), "開始時はライフが満タン").toBe(START_LIVES);
    expect(await readShotNumber(page), "開始時は1射目").toBe(1);

    await waitForCanvas(page);
    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("矢を放つと的に当たるか外れるかのいずれかの結果が出る", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    const scoreBefore = await readScore(page);
    const livesBefore = await readLives(page);
    const shotBefore = await readShotNumber(page);

    await fireMediumShot(page, stage);

    // 命中すれば得点して射目が進み、外れればライフが減る。どちらかは必ず起こる
    // (engine/world.ts の飛行タイムアウトにより、最悪でも一定時間内に結果が出る)。
    await expect
      .poll(
        async () => {
          const score = await readScore(page);
          const lives = await readLives(page);
          const shot = await readShotNumber(page);
          return score > scoreBefore || lives < livesBefore || shot > shotBefore;
        },
        { message: "矢を放った結果(命中/ミス)が反映される", timeout: SHOT_RESOLVE_TIMEOUT_MS },
      )
      .toBe(true);

    expect(errors, "発射操作中にエラーが出ていない").toEqual([]);
  });

  test("的に届かない弱い矢を放ち続けるとライフが尽きてゲームオーバーになり、リスタートできる", async ({
    page,
  }) => {
    test.slow();
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);
    const gameOver = page.getByTestId("longbow-breeze-game-over");

    for (let i = 0; i < START_LIVES; i++) {
      const livesBefore = await readLives(page);
      await fireGuaranteedShortShot(page, stage);
      await expect
        .poll(() => readLives(page), {
          message: "届かない矢は必ずミスになりライフが減る",
          timeout: SHOT_RESOLVE_TIMEOUT_MS,
        })
        .toBeLessThan(livesBefore);
    }

    await expect(gameOver, "ライフが尽きるとゲームオーバー表示になる").toBeVisible();
    expect(await readLives(page), "ゲームオーバー時はライフが0").toBe(0);

    await page.getByTestId("longbow-breeze-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(START_LIVES);
    expect(await readShotNumber(page), "リスタートで1射目に戻る").toBe(1);

    expect(errors, "ゲームオーバーからリスタートまででエラーが出ていない").toEqual([]);
  });

  test("一時停止中は矢を放っても状態が変わらず、再開すると操作を受け付ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const livesBefore = await readLives(page);
    const scoreBefore = await readScore(page);
    const shotBefore = await readShotNumber(page);

    // 一時停止中にドラッグ操作・Enterキーで放とうとしても発射されない
    await fireGuaranteedShortShot(page, stage);
    await fireMediumShot(page, stage);
    await page.keyboard.press("Enter");
    await waitForFrames(page, 30);

    expect(await readLives(page), "一時停止中はライフが変わらない").toBe(livesBefore);
    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(scoreBefore);
    expect(await readShotNumber(page), "一時停止中は射目が変わらない").toBe(shotBefore);

    // 連打しても表示と状態がずれない(一時停止中が起点なので、奇数回で再開状態に戻る)
    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    // 再開後は矢を放つと結果が反映される
    await fireGuaranteedShortShot(page, stage);
    await expect
      .poll(() => readLives(page), {
        message: "再開後は操作が反映される",
        timeout: SHOT_RESOLVE_TIMEOUT_MS,
      })
      .toBeLessThan(livesBefore);

    expect(errors, "一時停止・再開中にエラーが出ていない").toEqual([]);
  });

  test("しきい値未満の小さなドラッグを連打しても発射されない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    const livesBefore = await readLives(page);
    const scoreBefore = await readScore(page);
    const shotBefore = await readShotNumber(page);

    // MIN_LAUNCH_DRAG(14px)未満の小さなドラッグを何度も繰り出す。
    // どれだけ連打しても「引っ張った」とは判定されず、矢は飛ばないはず。
    for (let i = 0; i < 10; i++) {
      await pullAndRelease(page, stage, { xRatio: 0.5, yRatio: 0.5 }, -4, 1);
    }

    expect(await readLives(page), "しきい値未満の連打ではライフが変わらない").toBe(livesBefore);
    expect(await readScore(page), "しきい値未満の連打では得点しない").toBe(scoreBefore);
    expect(await readShotNumber(page), "しきい値未満の連打では射目が進まない").toBe(shotBefore);

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作(矢印キー+Enter)でも矢を放てる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForCanvas(page);
    // キーボード操作はキャンバス自体にフォーカスがなくてもウィンドウ単位で拾われるため、
    // ページ本体にフォーカスしておく。
    await page.getByTestId("game-shell-stage").click({ position: { x: 5, y: 5 } });

    const livesBefore = await readLives(page);
    const scoreBefore = await readScore(page);
    const shotBefore = await readShotNumber(page);

    // 仰角を最も浅く、パワーを最小付近まで下げてから放つ → 的に届かず確実にミスになる
    // (fireGuaranteedShortShot のドラッグ版と同じ理屈)。キーを押し続けている間に
    // ゲームループ側が角度/パワーを変化させるため、固定sleepではなく実際のフレーム経過
    // (waitForFrames)を挟んで押し続ける。
    await page.keyboard.down("ArrowRight");
    await waitForFrames(page, 60);
    await page.keyboard.up("ArrowRight");

    await page.keyboard.down("ArrowDown");
    await waitForFrames(page, 60);
    await page.keyboard.up("ArrowDown");

    await page.keyboard.press("Enter");

    await expect
      .poll(() => readLives(page), {
        message: "キーボードでの発射結果が反映される",
        timeout: SHOT_RESOLVE_TIMEOUT_MS,
      })
      .toBeLessThan(livesBefore);

    expect(await readScore(page), "届かない矢では得点しない").toBe(scoreBefore);
    expect(await readShotNumber(page), "ミスでは射目が進まない").toBe(shotBefore);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = await waitForCanvas(page);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const livesBefore = await readLives(page);
    await fireGuaranteedShortShot(page, stage);
    await expect
      .poll(() => readLives(page), {
        message: "リサイズ後も操作が反映される",
        timeout: SHOT_RESOLVE_TIMEOUT_MS,
      })
      .toBeLessThan(livesBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
