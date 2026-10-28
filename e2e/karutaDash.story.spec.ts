import { expect, type Locator, type Page, test } from "@playwright/test";
import { START_LIVES } from "../src/app/games/karuta-dash/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/karuta-dash";

interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("karuta-dash-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("karuta-dash-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ラウンド表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("karuta-dash-combo").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `コンボ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readTargetLabel(page: Page): Promise<string> {
  return await page.getByTestId("karuta-dash-target-label").innerText();
}

/**
 * ライバルが実時間で目標の札を奪っていく(＝盤面が常に動き続ける)ゲームのため、
 * 「ラベルを読む→一覧から探す→座標を取る」を複数回のPlaywright往復に分けると、
 * その間に目標が切り替わってしまい競合しやすい。目標の文字の読み取りから一致する
 * 札の矩形特定までを1回のpage.evaluateでDOMからまとめて読むことで、往復のたびに
 * 生まれる時間差(＝競合の窓)を無くす。
 */
async function getTargetCardRect(page: Page): Promise<CardRect | null> {
  return await page.evaluate(() => {
    const labelEl = document.querySelector('[data-testid="karuta-dash-target-label"]');
    const label = labelEl?.textContent ?? "";
    if (!label) return null;
    const anchors = document.querySelectorAll('[data-testid^="karuta-dash-card-"]');
    for (const anchor of anchors) {
      if (anchor.getAttribute("data-label") === label) {
        const rect = anchor.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  });
}

/** 目標ではない(ハズレの)札のうち最初に見つかったものの画面上の矩形を返す。目標の読み取りと検索を1回のevaluateで行う。 */
async function getWrongCardRect(page: Page): Promise<CardRect | null> {
  return await page.evaluate(() => {
    const labelEl = document.querySelector('[data-testid="karuta-dash-target-label"]');
    const excludeLabel = labelEl?.textContent ?? "";
    const anchors = document.querySelectorAll('[data-testid^="karuta-dash-card-"]');
    for (const anchor of anchors) {
      const label = anchor.getAttribute("data-label");
      if (label && label !== excludeLabel) {
        const rect = anchor.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  });
}

/** 盤面に目標の札が現れる(＝遊び始められる)のを待つ。起動直後は1フレーム目が描画されるまで空文字。 */
async function waitUntilReady(page: Page): Promise<void> {
  await expect(page.getByTestId("game-shell-score")).toBeVisible();
  await expect
    .poll(async () => (await readTargetLabel(page)).length > 0, {
      message: "目標の札が表示されるまで待つ",
    })
    .toBe(true);
}

/** 現在の目標の札を本物のマウスクリックで取る。 */
async function clickTargetCard(page: Page): Promise<void> {
  const rect = await getTargetCardRect(page);
  expect(rect, "目標の札が盤面に見つかる").not.toBeNull();
  if (!rect) return;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** 目標ではない(ハズレの)札を本物のマウスクリックで取る。 */
async function clickWrongCard(page: Page): Promise<void> {
  const rect = await getWrongCardRect(page);
  expect(rect, "ハズレの札が盤面に見つかる").not.toBeNull();
  if (!rect) return;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** キーボードの選択カーソル座標と、目標の札のワールド座標(ステージ基準)を1回のevaluateでまとめて読む。 */
async function getSelectorAndTargetWorldPositions(
  page: Page,
  stage: Locator,
): Promise<{
  selector: { x: number; y: number };
  target: { x: number; y: number };
  label: string;
} | null> {
  const stageBox = await stage.boundingBox();
  if (!stageBox) return null;
  return await page.evaluate((stageOrigin) => {
    const debugEl = document.querySelector('[data-testid="karuta-dash-debug"]');
    const selectorX = Number(debugEl?.getAttribute("data-selector-x"));
    const selectorY = Number(debugEl?.getAttribute("data-selector-y"));

    const labelEl = document.querySelector('[data-testid="karuta-dash-target-label"]');
    const label = labelEl?.textContent ?? "";
    if (!label) return null;
    const anchors = document.querySelectorAll('[data-testid^="karuta-dash-card-"]');
    for (const anchor of anchors) {
      if (anchor.getAttribute("data-label") === label) {
        const rect = anchor.getBoundingClientRect();
        return {
          selector: { x: selectorX, y: selectorY },
          target: {
            x: rect.x + rect.width / 2 - stageOrigin.x,
            y: rect.y + rect.height / 2 - stageOrigin.y,
          },
          label,
        };
      }
    }
    return null;
  }, stageBox);
}

/**
 * キーボードの矢印キーで選択カーソルを目標の札へ寄せ、近づいたらEnterで取る。
 * ライバルが実時間で目標を奪うため、移動中に目標が切り替わることがある。
 * その場合は新しい目標に対して寄せ直す(＝取れるまでリトライする)。
 */
async function grabTargetWithKeyboard(
  page: Page,
  stage: Locator,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const scoreBefore = await readScore(page);
  const TOLERANCE_PX = 30;

  // サンドボックスの負荷でフレーム供給が遅くなると、同じ「Nフレーム分」の押下でも
  // 実時間での移動距離が伸びて目標を飛び越えやすくなる。符号が反転(行き過ぎ)したら
  // 押下フレーム数を半分に縮めて、二分探索的に収束させる。ただし目標の札自体が
  // ライバルの横取り等で切り替わった場合は距離感がリセットされるので、
  // 前回値との比較は同じ目標が続いているときだけに限定する。
  const INITIAL_HOLD_FRAMES = 12;
  let holdFrames = INITIAL_HOLD_FRAMES;
  let prevDx: number | null = null;
  let prevDy: number | null = null;
  let prevLabel: string | null = null;

  while (Date.now() < deadline) {
    // 寄せている間にライフが尽きてゲームオーバーになることがある(特に遠い目標)。
    // その場合は無限に成功できなくなるため、リスタートして取り直す。
    if (await page.getByTestId("karuta-dash-gameover").isVisible()) {
      await page.getByTestId("karuta-dash-restart").click();
      holdFrames = INITIAL_HOLD_FRAMES;
      prevDx = null;
      prevDy = null;
      prevLabel = null;
      continue;
    }

    const positions = await getSelectorAndTargetWorldPositions(page, stage);
    if (!positions) continue;
    const dx = positions.target.x - positions.selector.x;
    const dy = positions.target.y - positions.selector.y;

    if (positions.label !== prevLabel) {
      holdFrames = INITIAL_HOLD_FRAMES;
      prevDx = null;
      prevDy = null;
      prevLabel = positions.label;
    }

    if (Math.abs(dx) <= TOLERANCE_PX && Math.abs(dy) <= TOLERANCE_PX) {
      await page.keyboard.press("Enter");
      await waitForFrames(page, 4);
      if ((await readScore(page)) > scoreBefore) return true;
      prevDx = null;
      prevDy = null;
      continue;
    }

    if (prevDx !== null && Math.sign(dx) !== Math.sign(prevDx) && dx !== 0) {
      holdFrames = Math.max(2, Math.floor(holdFrames / 2));
    }
    if (prevDy !== null && Math.sign(dy) !== Math.sign(prevDy) && dy !== 0) {
      holdFrames = Math.max(2, Math.floor(holdFrames / 2));
    }
    prevDx = dx;
    prevDy = dy;

    const keys: string[] = [];
    if (Math.abs(dx) > TOLERANCE_PX) keys.push(dx > 0 ? "ArrowRight" : "ArrowLeft");
    if (Math.abs(dy) > TOLERANCE_PX) keys.push(dy > 0 ? "ArrowDown" : "ArrowUp");
    for (const key of keys) await page.keyboard.down(key);
    await waitForFrames(page, holdFrames);
    for (const key of keys) await page.keyboard.up(key);
  }

  return (await readScore(page)) > scoreBefore;
}

test.describe("Karuta Dash のストーリー", () => {
  test("起動直後はラウンド1・ライフ満タン・スコア0で始まり、目標の札が盤面に存在する", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時はラウンド1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(START_LIVES);
    expect(await readCombo(page), "開始時はコンボ0").toBe(0);

    const rect = await getTargetCardRect(page);
    expect(rect, "目標の文字を持つ札が盤面に存在する").not.toBeNull();

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("正しい札を取り続けるとスコアとコンボが伸びる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    await clickTargetCard(page);
    await expect.poll(() => readScore(page), { message: "1枚目で得点が入る" }).toBeGreaterThan(0);
    expect(await readCombo(page), "1枚目でコンボが1になる").toBe(1);
    const scoreAfterFirst = await readScore(page);

    await clickTargetCard(page);
    await expect
      .poll(() => readScore(page), { message: "2枚目でさらに得点が伸びる" })
      .toBeGreaterThan(scoreAfterFirst);
    expect(await readCombo(page), "2枚目でコンボが2になる").toBe(2);

    expect(errors, "正しい札を取り続ける間にエラーが出ていない").toEqual([]);
  });

  test("ハズレの札を取るとライフが減りコンボが0に戻るが、ゲームは続けられる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    await clickTargetCard(page); // コンボを1にしておく
    await expect.poll(() => readCombo(page)).toBe(1);

    await clickWrongCard(page);
    await expect
      .poll(() => readLives(page), { message: "ハズレを取るとライフが減る" })
      .toBe(START_LIVES - 1);
    expect(await readCombo(page), "ハズレでコンボが0に戻る").toBe(0);
    await expect(
      page.getByTestId("karuta-dash-gameover"),
      "1回のミスではゲームオーバーにならない",
    ).toBeHidden();

    // ハズレの後も続けて正しい札を取れる
    await clickTargetCard(page);
    await expect
      .poll(() => readCombo(page), { message: "ハズレ後も続けて取れる" })
      .toBeGreaterThan(0);

    expect(errors, "ハズレ操作の間にエラーが出ていない").toEqual([]);
  });

  test("ライバルに時間切れで横取りされるとライフが減り、次の目標に切り替わる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    const labelBefore = await readTargetLabel(page);
    expect(await readLives(page)).toBe(START_LIVES);

    // 何も操作せずに待つと、ライバルの手が目標の札に届いて横取りされる
    await expect
      .poll(() => readLives(page), {
        message: "操作しないとライバルに横取りされてライフが減る",
        timeout: 15000,
      })
      .toBe(START_LIVES - 1);

    await expect
      .poll(() => readTargetLabel(page), { message: "横取りされると目標が切り替わる" })
      .not.toBe(labelBefore);
    await expect(
      page.getByTestId("karuta-dash-gameover"),
      "1回の横取りではゲームオーバーにならない",
    ).toBeHidden();

    expect(errors, "放置している間にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は操作してもスコア・ライフ・ライバルの進行度が変わらない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const livesWhilePaused = await readLives(page);
    const rivalProgressWhilePaused = await page
      .getByTestId("karuta-dash-debug")
      .getAttribute("data-rival-progress");

    await clickTargetCard(page);
    await waitForFrames(page, 20);

    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(scoreWhilePaused);
    expect(await readLives(page), "一時停止中はライフが変わらない").toBe(livesWhilePaused);
    expect(
      await page.getByTestId("karuta-dash-debug").getAttribute("data-rival-progress"),
      "一時停止中はライバルの進行度も変わらない",
    ).toBe(rivalProgressWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await clickTargetCard(page);
    await expect
      .poll(() => readScore(page), { message: "再開すればまた進行できる" })
      .toBeGreaterThan(scoreWhilePaused);

    expect(errors, "一時停止の操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止ボタンを連打しても表示と状態がずれない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    const pauseButton = page.getByTestId("game-shell-pause");

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    const livesWhilePaused = await readLives(page);
    await waitForFrames(page, 60);
    expect(await readLives(page), "連打後の一時停止でもライフが変わらない").toBe(livesWhilePaused);

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("ライフが尽きるとゲームオーバーになり、リスタートで最初からやり直せる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);
    const gameOver = page.getByTestId("karuta-dash-gameover");

    for (let i = 0; i < START_LIVES; i++) {
      await clickWrongCard(page);
      await expect
        .poll(() => readLives(page), { message: `${i + 1}回目のミス` })
        .toBe(START_LIVES - 1 - i);
    }

    await expect(gameOver, "ライフが尽きてゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("karuta-dash-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(START_LIVES);
    expect(await readRound(page), "リスタートでラウンドが1に戻る").toBe(1);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });

  test("キーボードでも手を動かして目標の札を取ることができる", async ({ page }) => {
    test.setTimeout(60000);
    const errors = collectPageErrors(page);
    // 盤面を小さくして移動距離を抑え、サンドボックスの負荷でフレーム供給が遅れても
    // ライバルの横取り(約3.2秒)より十分速く寄せきれるようにする。
    await page.setViewportSize({ width: 400, height: 400 });
    await page.goto(GAME_PATH);
    await waitUntilReady(page);
    const stage = page.getByTestId("karuta-dash-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    const captured = await grabTargetWithKeyboard(page, stage, 30000);
    expect(captured, "キーボードの矢印キー+Enterで目標の札を取れる").toBe(true);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);
    const stage = page.getByTestId("karuta-dash-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も正しい札をクリックで取れる
    const scoreBefore = await readScore(page);
    await clickTargetCard(page);
    await expect
      .poll(() => readScore(page), { message: "リサイズ後も札を取れる" })
      .toBeGreaterThan(scoreBefore);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
