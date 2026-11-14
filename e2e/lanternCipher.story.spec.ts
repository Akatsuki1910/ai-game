import { expect, type Page, test } from "@playwright/test";
import { evaluateGuess } from "../src/app/games/lantern-cipher/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/lantern-cipher";

async function readFirstNumber(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `"${testId}" の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readLevel(page: Page): Promise<number> {
  return readFirstNumber(page, "lantern-cipher-level");
}

async function readLives(page: Page): Promise<number> {
  return readFirstNumber(page, "lantern-cipher-lives");
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** "{attemptsUsed}/{maxAttempts}" の表示から両方の数値を読み取る。 */
async function readAttempts(page: Page): Promise<{ used: number; max: number }> {
  const text = await page.getByTestId("lantern-cipher-attempts").innerText();
  const matched = text.match(/(\d+)\/(\d+)/);
  expect(matched, `試行回数の表示から読み取れる: "${text}"`).not.toBeNull();
  return { used: Number(matched?.[1] ?? Number.NaN), max: Number(matched?.[2] ?? Number.NaN) };
}

async function readSlotCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="lantern-cipher-slot-"]').count();
}

async function readColorCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="lantern-cipher-color-"]').count();
}

/** 色スロット(スロット0から順)をクリックし、クリアされた状態の推測行を1つの推測で埋める。 */
async function fillGuess(page: Page, guess: readonly number[]): Promise<void> {
  for (const color of guess) {
    await page.getByTestId(`lantern-cipher-color-${color}`).click();
  }
}

/** 長さslotCount・色数colorCountの全組み合わせを列挙する。 */
function allCandidates(slotCount: number, colorCount: number): number[][] {
  let result: number[][] = [[]];
  for (let s = 0; s < slotCount; s++) {
    const next: number[][] = [];
    for (const prefix of result) {
      for (let c = 0; c < colorCount; c++) next.push([...prefix, c]);
    }
    result = next;
  }
  return result;
}

/**
 * Mastermind式の「一致した手がかりと矛盾しない候補」だけに絞り込みながら解く、
 * 実際のプレイヤーと同じ情報(フィードバック)だけを使うソルバー。
 * 内部状態(secretCode)は直接読まず、画面に表示されるフィードバックのみで解く。
 */
async function solveCurrentRound(
  page: Page,
  slotCount: number,
  colorCount: number,
  maxAttempts: number,
): Promise<boolean> {
  let candidates = allCandidates(slotCount, colorCount);

  for (let attempt = 0; attempt < maxAttempts && candidates.length > 0; attempt++) {
    const guess = candidates[0];
    const levelBefore = await readLevel(page);
    const attemptsBefore = (await readAttempts(page)).used;

    await fillGuess(page, guess);
    await page.getByTestId("lantern-cipher-submit").click();

    await expect
      .poll(
        async () => {
          const levelNow = await readLevel(page);
          const attemptsNow = (await readAttempts(page)).used;
          return levelNow !== levelBefore || attemptsNow !== attemptsBefore;
        },
        { message: "推測の判定が反映される" },
      )
      .toBe(true);

    if ((await readLevel(page)) !== levelBefore) return true;

    const row = page.getByTestId(`lantern-cipher-history-${attemptsBefore}`);
    const exactMatches = Number(await row.getAttribute("data-exact"));
    const colorMatches = Number(await row.getAttribute("data-color"));

    candidates = candidates.filter((candidate) => {
      const result = evaluateGuess(candidate, guess);
      return result.exactMatches === exactMatches && result.colorMatches === colorMatches;
    });
  }

  return false;
}

test.describe("Lantern Cipher のストーリー", () => {
  test("手がかりから暗号を解読するとラウンドをクリアしてレベルが進み、一時停止もできる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    expect(await readLevel(page), "開始時はレベル1").toBe(1);
    expect(await readLives(page), "開始時のライフは3").toBe(3);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);

    const slotCount = await readSlotCount(page);
    const colorCount = await readColorCount(page);
    const { max: maxAttempts } = await readAttempts(page);
    expect(slotCount, "スロット数が3以上ある").toBeGreaterThanOrEqual(3);
    expect(colorCount, "色数が4以上ある").toBeGreaterThanOrEqual(4);

    const solved = await solveCurrentRound(page, slotCount, colorCount, maxAttempts);
    expect(solved, "フィードバックだけを手がかりに解読できる").toBe(true);

    expect(await readLevel(page), "レベルが進む").toBeGreaterThan(1);
    expect(await readScore(page), "クリアで得点が入る").toBeGreaterThan(0);
    expect(await readLives(page), "クリアではライフは減らない").toBe(3);

    // 一時停止すると時間とスコアが止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボードで色を置ける。試行回数を使い切るとライフが減り、連打やリサイズをしても壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    // 数字キーでスロット0に色0を置く
    await page.keyboard.press("1");
    await expect
      .poll(async () => page.getByTestId("lantern-cipher-slot-0").getAttribute("data-color"), {
        message: "数字キーでスロット0に色が置かれる",
      })
      .toBe("0");

    // Backspaceで消せる
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => page.getByTestId("lantern-cipher-slot-0").getAttribute("data-color"), {
        message: "Backspaceでスロット0が空に戻る",
      })
      .toBe("");

    // 矢印キーでスロット選択を連打しても壊れない(ラップアラウンドする)
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(i % 2 === 0 ? "ArrowRight" : "ArrowLeft");
    }
    await expect(page.getByTestId("lantern-cipher-stage")).toBeVisible();

    const livesBefore = await readLives(page);

    // 間違いなく誤答になるキーボード入力(色を1つずらした並び)で試行回数を使い切る。
    // 稀に偶然当たってラウンドがクリアされても、スロット数・色数を毎回読み直して追従する。
    for (
      let attemptIndex = 0;
      attemptIndex < 20 && (await readLives(page)) === livesBefore;
      attemptIndex++
    ) {
      const slotCount = await readSlotCount(page);
      const roundColorCount = await readColorCount(page);
      const attemptsBefore = (await readAttempts(page)).used;
      for (let slot = 0; slot < slotCount; slot++) {
        const digit = ((slot + attemptIndex) % roundColorCount) + 1;
        await page.keyboard.press(String(digit));
      }
      await page.keyboard.press("Enter");
      await expect
        .poll(
          async () =>
            (await readAttempts(page)).used !== attemptsBefore ||
            (await readLives(page)) !== livesBefore,
          { message: "Enterで判定が反映される" },
        )
        .toBe(true);
    }

    expect(await readLives(page), "試行回数切れでライフが減る").toBeLessThan(livesBefore);

    // 連打しても壊れない: 常に押せる色ボタン・消すボタンを高速に叩く
    // (送信ボタンはスロットが埋まっていない間は無効化されているのが正しい挙動なので、
    //  ここでは「無効化されたボタンを押しても例外にならない」ことまでは問わない)
    for (let i = 0; i < 15; i++) {
      await page.getByTestId("lantern-cipher-color-0").click();
      await page.getByTestId("lantern-cipher-clear").click();
    }
    await expect(page.getByTestId("lantern-cipher-stage")).toBeVisible();

    // 連打後も通常の送信操作ができる
    const slotCountAfterMash = await readSlotCount(page);
    await fillGuess(
      page,
      Array.from({ length: slotCountAfterMash }, () => 0),
    );
    await expect(page.getByTestId("lantern-cipher-submit")).toBeEnabled();
    await page.getByTestId("lantern-cipher-submit").click();
    await waitForFrames(page, 5);

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(
      page.getByTestId("lantern-cipher-stage"),
      "縦長でも表示が生きている",
    ).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(
      page.getByTestId("lantern-cipher-stage"),
      "横長でも表示が生きている",
    ).toBeVisible();

    // リサイズ後も操作を受け付ける
    const slotCountAfterResize = await readSlotCount(page);
    await fillGuess(
      page,
      Array.from({ length: slotCountAfterResize }, () => 0),
    );
    await expect
      .poll(async () => page.getByTestId("lantern-cipher-submit").isEnabled(), {
        message: "リサイズ後もスロットを埋めて送信できる状態になる",
      })
      .toBe(true);

    expect(errors, "キー操作・リサイズ中にエラーが出ていない").toEqual([]);
  });

  test("ライフを使い切るとゲームオーバーになり、もう一度あそぶで最初から再開できる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    async function readStateSignature(): Promise<string> {
      const isOver = await page.getByTestId("lantern-cipher-gameover").isVisible();
      if (isOver) return "over";
      const level = await readLevel(page);
      const lives = await readLives(page);
      const { used } = await readAttempts(page);
      return `${level}:${lives}:${used}`;
    }

    // わざと(ずらした)誤答になりやすい推測を送り続け、試行回数切れでライフを使い切らせる。
    // 稀に偶然当たってラウンドをクリアしても、次のラウンドでも同様に送り続ければ
    // いずれ3ライフとも試行回数切れで失われ、ゲームオーバーに到達する。
    for (let attemptIndex = 0; attemptIndex < 60; attemptIndex++) {
      if (await page.getByTestId("lantern-cipher-gameover").isVisible()) break;

      const slotCount = await readSlotCount(page);
      const colorCount = await readColorCount(page);
      const guess = Array.from(
        { length: slotCount },
        (_, slot) => (slot + attemptIndex) % colorCount,
      );

      const before = await readStateSignature();
      await fillGuess(page, guess);
      await page.getByTestId("lantern-cipher-submit").click();
      await expect.poll(readStateSignature, { message: "送信後に状態が変わる" }).not.toBe(before);
    }

    await expect(
      page.getByTestId("lantern-cipher-gameover"),
      "ライフを使い切るとゲームオーバーになる",
    ).toBeVisible();

    await page.getByTestId("lantern-cipher-restart").click();
    await expect(page.getByTestId("lantern-cipher-gameover")).toBeHidden();
    expect(await readLevel(page), "再開でレベル1に戻る").toBe(1);
    expect(await readLives(page), "再開でライフが3に戻る").toBe(3);
    expect(await readScore(page), "再開でスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバーまでの操作中にエラーが出ていない").toEqual([]);
  });
});
