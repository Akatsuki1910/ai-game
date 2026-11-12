import { expect, type Page, test } from "@playwright/test";
import { INITIAL_LIVES } from "../src/app/games/mirror-garden/engine/gardenWorld";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/mirror-garden";

interface AnchorRect {
  testId: string;
  x: number;
  y: number;
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readRound(page: Page): Promise<number> {
  const text = await page.getByTestId("mirror-garden-round").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `見比べ(ラウンド)表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("mirror-garden-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** 「みつけた X / Y」の表示からXとYを両方読み取る。 */
async function readRemaining(page: Page): Promise<{ found: number; total: number }> {
  const text = await page.getByTestId("mirror-garden-remaining").innerText();
  const matched = text.match(/(\d+)\s*\/\s*(\d+)/);
  expect(matched, `差分の発見数表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return { found: Number(matched?.[1] ?? Number.NaN), total: Number(matched?.[2] ?? Number.NaN) };
}

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("mirror-garden-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** まだ見つかっていない差分の目印(DOMアンカー)を1つ、画面上の座標付きで返す。 */
async function getAnyDiffAnchor(page: Page): Promise<AnchorRect | null> {
  return await page.evaluate(() => {
    const anchor = document.querySelector('[data-testid^="mirror-garden-diff-"]');
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    return { testId: anchor.getAttribute("data-testid") ?? "", x: rect.x, y: rect.y };
  });
}

/** ステージの四隅のうち、現在の差分の目印からどれも十分離れている点を探す(ハズレを確実にクリックするため)。 */
async function findSafeMissPoint(page: Page): Promise<{ x: number; y: number } | null> {
  return await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="mirror-garden-stage"]');
    if (!stage) return null;
    const stageRect = stage.getBoundingClientRect();
    const anchorRects = Array.from(
      document.querySelectorAll('[data-testid^="mirror-garden-diff-"]'),
    ).map((el) => el.getBoundingClientRect());

    const margin = 8;
    const candidates = [
      { x: stageRect.x + margin, y: stageRect.y + margin },
      { x: stageRect.x + stageRect.width - margin, y: stageRect.y + margin },
      { x: stageRect.x + margin, y: stageRect.y + stageRect.height - margin },
      { x: stageRect.x + stageRect.width - margin, y: stageRect.y + stageRect.height - margin },
    ];
    const MIN_DISTANCE = 90;
    for (const candidate of candidates) {
      const isSafe = anchorRects.every(
        (rect) => Math.hypot(rect.x - candidate.x, rect.y - candidate.y) > MIN_DISTANCE,
      );
      if (isSafe) return candidate;
    }
    return null;
  });
}

/** 未発見の差分の目印を本物のマウスクリックで当てる。 */
async function clickAnyDiff(page: Page): Promise<string | null> {
  const anchor = await getAnyDiffAnchor(page);
  if (!anchor) return null;
  await page.mouse.click(anchor.x, anchor.y);
  return anchor.testId;
}

async function waitUntilReady(page: Page): Promise<void> {
  await expect(page.getByTestId("game-shell-score")).toBeVisible();
  await expect
    .poll(async () => (await getAnyDiffAnchor(page)) !== null, {
      message: "最初の盤面(差分の目印)が生成されるまで待つ",
    })
    .toBe(true);
}

test.describe("Mirror Garden のストーリー", () => {
  test("起動直後はラウンド1・スコア0・ライフ満タンで、差分の目印が盤面に存在する", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readRound(page), "開始時は見比べ1").toBe(1);
    expect(await readLives(page), "開始時はライフが満タン").toBe(INITIAL_LIVES);

    const remaining = await readRemaining(page);
    expect(remaining.found, "開始時はまだ何も見つけていない").toBe(0);
    expect(remaining.total, "差分が1つ以上ある").toBeGreaterThan(0);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("差分をクリックすると見つかってスコアが入り、発見数が増える", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    const before = await readRemaining(page);
    const clicked = await clickAnyDiff(page);
    expect(clicked, "差分の目印をクリックできる").not.toBeNull();

    await expect
      .poll(() => readScore(page), { message: "差分を見つけると得点が入る" })
      .toBeGreaterThan(0);
    const after = await readRemaining(page);
    // ラウンドがクリアされていれば盤面(total)自体が変わるので、継続中かクリアかの両方を許容する
    expect(
      after.found === before.found + 1 || (after.found === 0 && after.total !== before.total),
      "発見数が増えるか、クリアして新しい盤面に進んでいる",
    ).toBe(true);

    expect(errors, "差分を見つける操作中にエラーが出ていない").toEqual([]);
  });

  test("差分のない場所を連打してもクラッシュせず、得点は増えずに残り時間だけ減る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    const stage = page.getByTestId("mirror-garden-stage");
    const missPoint = await findSafeMissPoint(page);
    expect(missPoint, "どの差分からも十分離れた安全なハズレ地点が見つかる").not.toBeNull();
    if (!missPoint) return;

    const scoreBefore = await readScore(page);
    const timeBefore = await readTimerSeconds(page);

    for (let i = 0; i < 5; i++) {
      await page.mouse.click(missPoint.x, missPoint.y);
    }
    await waitForFrames(page, 10);

    expect(await readScore(page), "ハズレの連打では得点が増えない").toBe(scoreBefore);
    await expect
      .poll(() => readTimerSeconds(page), { message: "ハズレのペナルティで残り時間が減る" })
      .toBeLessThan(timeBefore);

    const stageCanvas = stage.locator("canvas");
    await expect(stageCanvas, "連打してもキャンバスが生きている").toBeVisible();
    expect(errors, "連打操作中にエラーが出ていない").toEqual([]);
  });

  test("全差分を見つけ切ると見比べ(ラウンド)が進み、新しい盤面になる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    expect(await readRound(page)).toBe(1);

    // 同じ盤面の差分を見つけ尽くすまでクリックし続ける(クリックごとに目印は1つ減っていく)。
    for (let i = 0; i < 20; i++) {
      if ((await readRound(page)) >= 2) break;
      const clicked = await clickAnyDiff(page);
      if (!clicked) break;
      await waitForFrames(page, 4);
    }

    await expect.poll(() => readRound(page), { message: "全差分発見でラウンドが進む" }).toBe(2);
    const remainingAfterClear = await readRemaining(page);
    expect(remainingAfterClear.found, "新しい盤面はまだ未発見").toBe(0);
    expect(remainingAfterClear.total, "新しい盤面にも差分がある").toBeGreaterThan(0);

    expect(errors, "見比べクリアまでの操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中は操作してもスコア・残り時間が変わらない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const scoreWhilePaused = await readScore(page);
    const timeWhilePaused = await readTimerSeconds(page);

    await clickAnyDiff(page);
    await waitForFrames(page, 20);

    expect(await readScore(page), "一時停止中はスコアが変わらない").toBe(scoreWhilePaused);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が変わらない").toBe(timeWhilePaused);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    await expect
      .poll(() => readTimerSeconds(page), { message: "再開すれば残り時間が減っていく" })
      .toBeLessThan(timeWhilePaused + 1);

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

    const timeWhilePaused = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "連打後の一時停止でも時間が変わらない").toBe(
      timeWhilePaused,
    );

    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "連打でエラーが出ていない").toEqual([]);
  });

  test("キーボードの矢印キーとEnterでも差分を見つけられる", async ({ page }) => {
    test.setTimeout(60000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);

    const scoreBefore = await readScore(page);
    const TOLERANCE_PX = 24;
    const deadline = Date.now() + 40000;

    // 目印自体は動かないが、放置していると制限時間切れで盤面が差し替わることがあるため、
    // 狙う対象(最初に見つかる未発見の目印)とセレクター座標を毎回まとめて取り直す。
    const INITIAL_HOLD_FRAMES = 10;
    let holdFrames = INITIAL_HOLD_FRAMES;
    let prevDx: number | null = null;
    let prevDy: number | null = null;

    while (Date.now() < deadline) {
      if (await page.getByTestId("mirror-garden-gameover").isVisible()) {
        await page.getByTestId("mirror-garden-restart").click();
        holdFrames = INITIAL_HOLD_FRAMES;
        prevDx = null;
        prevDy = null;
        continue;
      }

      const positions = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="mirror-garden-stage"]');
        const debugEl = document.querySelector('[data-testid="mirror-garden-debug"]');
        const anchor = document.querySelector('[data-testid^="mirror-garden-diff-"]');
        if (!stage || !debugEl || !anchor) return null;
        const stageRect = stage.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        return {
          selector: {
            x: Number(debugEl.getAttribute("data-selector-x")),
            y: Number(debugEl.getAttribute("data-selector-y")),
          },
          target: { x: anchorRect.x - stageRect.x, y: anchorRect.y - stageRect.y },
        };
      });
      if (!positions) continue;

      const dx = positions.target.x - positions.selector.x;
      const dy = positions.target.y - positions.selector.y;

      if (Math.abs(dx) <= TOLERANCE_PX && Math.abs(dy) <= TOLERANCE_PX) {
        await page.keyboard.press("Enter");
        await waitForFrames(page, 4);
        if ((await readScore(page)) > scoreBefore) break;
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

    expect(await readScore(page), "キーボード操作でも差分を見つけて得点が入る").toBeGreaterThan(
      scoreBefore,
    );

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く(横長↔縦長)", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);
    const stage = page.getByTestId("mirror-garden-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当(上下にパネルが重なるレイアウトに切り替わる)
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    const scoreBeforePortrait = await readScore(page);
    const clickedInPortrait = await clickAnyDiff(page);
    expect(clickedInPortrait, "縦長レイアウトでも差分をクリックできる").not.toBeNull();
    await expect
      .poll(() => readScore(page), { message: "縦長でも差分を見つけられる" })
      .toBeGreaterThan(scoreBeforePortrait);

    // 横長相当に戻す(左右にパネルが並ぶレイアウトに戻る)
    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    const scoreBeforeLandscape = await readScore(page);
    const clickedInLandscape = await clickAnyDiff(page);
    expect(clickedInLandscape, "横長レイアウトでも差分をクリックできる").not.toBeNull();
    await expect
      .poll(() => readScore(page), { message: "横長でも差分を見つけられる" })
      .toBeGreaterThan(scoreBeforeLandscape);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("時間切れが続くとライフが減り、尽きるとゲームオーバーになってリスタートできる", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitUntilReady(page);
    const gameOver = page.getByTestId("mirror-garden-gameover");

    // 何も操作せずに放置し、制限時間切れを繰り返させてライフを削る。
    await expect
      .poll(() => readLives(page), {
        message: "操作しないと時間切れでライフが減っていく",
        timeout: 100000,
        intervals: [2000],
      })
      .toBe(0);

    await expect(gameOver, "ライフが尽きてゲームオーバーになる").toBeVisible();
    const gameOverText = await gameOver.innerText();
    expect(gameOverText.length, "ゲームオーバー画面に結果が表示されている").toBeGreaterThan(0);

    await page.getByTestId("mirror-garden-restart").click();
    await expect(gameOver).toBeHidden();
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);
    expect(await readLives(page), "リスタートでライフが満タンに戻る").toBe(INITIAL_LIVES);
    expect(await readRound(page), "リスタートで見比べが1に戻る").toBe(1);

    expect(errors, "ゲームオーバーまでの操作でエラーが出ていない").toEqual([]);
  });
});
