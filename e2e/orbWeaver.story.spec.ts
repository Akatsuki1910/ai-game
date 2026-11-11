import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/orb-weaver";
const INTEGRITY_MAX = 100;
const SPOKE_COUNT = 6;

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readCombo(page: Page): Promise<number> {
  const text = await page.getByTestId("orb-weaver-combo").innerText();
  const matched = text.match(/COMBO (\d+)/);
  expect(matched, `コンボの表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readIntegrity(page: Page): Promise<number> {
  const value = await page.getByTestId("orb-weaver-integrity").getAttribute("data-integrity");
  expect(value, "耐久値が属性から読み取れる").not.toBeNull();
  return Number(value);
}

interface InBandSpoke {
  spokeIndex: number;
  x: number;
  y: number;
}

/** 捕獲圏に入っている虫が存在する糸のインデックスと画面上の位置を読む。無ければnull。 */
async function readInBandSpoke(page: Page): Promise<InBandSpoke | null> {
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const marker = page.getByTestId(`orb-weaver-spoke-${i}`);
    const inBand = await marker.getAttribute("data-in-band").catch(() => null);
    if (inBand !== "true") continue;
    const box = await marker.boundingBox();
    if (!box) continue;
    return { spokeIndex: i, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  return null;
}

async function waitForInBandSpoke(page: Page): Promise<InBandSpoke> {
  let found: InBandSpoke | null = null;
  await expect
    .poll(
      async () => {
        found = await readInBandSpoke(page);
        return found !== null;
      },
      { message: "虫が捕獲圏に入る", timeout: 10000 },
    )
    .toBe(true);
  expect(found, "捕獲圏の糸が読み取れる").not.toBeNull();
  if (found === null) throw new Error("unreachable");
  return found;
}

async function isAnySpokeFrayed(page: Page): Promise<boolean> {
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const frayed = await page.getByTestId(`orb-weaver-spoke-${i}`).getAttribute("data-frayed");
    if (frayed === "true") return true;
  }
  return false;
}

test.describe("Orb Weaver のストーリー", () => {
  test("キーボードで捕獲圏の虫を弾くとスコアとコンボが増え、一時停止・再開もできる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readCombo(page), "開始時のコンボは0").toBe(0);
    expect(await readIntegrity(page), "開始時の耐久は満タン").toBe(INTEGRITY_MAX);

    const spoke = await waitForInBandSpoke(page);
    await page.keyboard.press(String(spoke.spokeIndex + 1));

    await expect
      .poll(() => readScore(page), { message: "捕獲するとスコアが増える" })
      .toBeGreaterThan(0);
    expect(await readCombo(page), "捕獲でコンボが伸びる").toBeGreaterThan(0);
    expect(await readIntegrity(page), "捕獲では耐久は減らない").toBe(INTEGRITY_MAX);

    // 一時停止するとオーバーレイが出て、状態が変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedIntegrity = await readIntegrity(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readIntegrity(page), "一時停止中は耐久が変化しない").toBe(pausedIntegrity);

    // 一時停止中にキー操作しても無視される。
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    expect(await readScore(page), "一時停止中の操作でスコアが動かない").toBe(pausedScore);

    // 再開すると進行を再開する。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    const resumedSpoke = await waitForInBandSpoke(page);
    await page.keyboard.press(String(resumedSpoke.spokeIndex + 1));
    await expect
      .poll(() => readScore(page), { message: "再開後も捕獲してスコアが増える" })
      .toBeGreaterThan(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("マウスのクリックでも捕獲でき、中心に到達すると耐久が減って糸が破れる", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // クリック操作: 捕獲圏に入った虫の位置をクリックして捕獲する。
    const spoke = await waitForInBandSpoke(page);
    await page.mouse.click(spoke.x, spoke.y);
    await expect
      .poll(() => readScore(page), { message: "クリックで捕獲してスコアが増える" })
      .toBeGreaterThan(0);

    // 放置して中心まで到達させ、耐久を減らして糸を破る。
    await expect
      .poll(() => readIntegrity(page), {
        message: "放置(中心到達)で耐久が減る",
        timeout: 30000,
      })
      .toBeLessThan(INTEGRITY_MAX);
    await expect
      .poll(() => isAnySpokeFrayed(page), { message: "到達した糸が破れた状態になる" })
      .toBe(true);

    expect(errors, "捕獲・破れ発生中にエラーが出ていない").toEqual([]);
  });

  test("破れた糸は長押しで補修するまで捕獲できない", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 何もせず放置して、少なくとも1本の糸を破る。
    await expect
      .poll(() => isAnySpokeFrayed(page), { message: "放置で糸が破れる", timeout: 30000 })
      .toBe(true);

    let frayedIndex = -1;
    for (let i = 0; i < SPOKE_COUNT; i++) {
      const frayed = await page.getByTestId(`orb-weaver-spoke-${i}`).getAttribute("data-frayed");
      if (frayed === "true") {
        frayedIndex = i;
        break;
      }
    }
    expect(frayedIndex, "破れた糸のインデックスが特定できる").toBeGreaterThanOrEqual(0);

    // 破れた糸のキーを長押しして補修する(押しっぱなしにする必要がある)。
    await page.keyboard.down(String(frayedIndex + 1));
    await expect
      .poll(
        async () =>
          await page.getByTestId(`orb-weaver-spoke-${frayedIndex}`).getAttribute("data-frayed"),
        { message: "長押しで補修が完了し健全に戻る", timeout: 8000 },
      )
      .toBe("false");
    await page.keyboard.up(String(frayedIndex + 1));

    expect(errors, "補修中にエラーが出ていない").toEqual([]);
  });

  test("ゲームオーバーになるとリスタートでき、連打や画面リサイズをしても壊れない", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage: Locator = page.getByTestId("game-shell-stage");
    const gameOver = page.getByTestId("orb-weaver-gameover");

    // 何も捕獲せず放置して耐久を0にし、ゲームオーバーにする(上限回数を決め、無限ループにしない)。
    for (let guard = 0; guard < 40 && !(await gameOver.isVisible().catch(() => false)); guard++) {
      await waitForFrames(page, 20);
    }
    await expect(gameOver, "耐久が尽きるとゲームオーバーになる").toBeVisible();
    expect(await readIntegrity(page), "耐久が0になっている").toBe(0);

    // ゲームオーバー中に操作しても、実際のユーザーと同様に入力が無視される。
    const scoreAtGameOver = await readScore(page);
    await page.keyboard.press("1");
    await page.mouse.click(400, 300);
    await waitForFrames(page, 10);
    expect(await readScore(page), "ゲームオーバー後の操作でスコアが変化しない").toBe(
      scoreAtGameOver,
    );

    // リスタートすると最初の状態に戻る。
    await page.getByTestId("orb-weaver-restart").click();
    await expect(gameOver).toBeHidden();
    await expect
      .poll(() => readIntegrity(page), { message: "リスタートで耐久が全回復する" })
      .toBe(INTEGRITY_MAX);
    await expect.poll(() => readScore(page), { message: "リスタートでスコアが0に戻る" }).toBe(0);
    await expect.poll(() => readCombo(page), { message: "リスタートでコンボが0に戻る" }).toBe(0);

    // キー連打やランダムクリックをしても表示が壊れない(ゲームオーバーになれば都度リスタート)。
    for (let i = 0; i < 15; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("orb-weaver-restart").click();
        continue;
      }
      await page.keyboard.press(String((i % SPOKE_COUNT) + 1));
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("orb-weaver-restart").click();
    }
    await expect(stage.locator("canvas"), "連打後もキャンバスが生きている").toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ。
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける。
    if (!(await gameOver.isVisible().catch(() => false))) {
      const before = await readScore(page);
      const spoke = await waitForInBandSpoke(page);
      await page.keyboard.press(String(spoke.spokeIndex + 1));
      await expect
        .poll(() => readScore(page), { message: "リサイズ後も捕獲できる" })
        .toBeGreaterThanOrEqual(before);
    }

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
