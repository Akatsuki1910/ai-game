import { expect, type Locator, type Page, test } from "@playwright/test";
import { isAdjacent, type TileCoord } from "../src/app/games/kana-trail/engine/grid";
import { WORD_LIST } from "../src/app/games/kana-trail/engine/wordList";
import { GRID_COLS, GRID_ROWS, scoreForWord } from "../src/app/games/kana-trail/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/kana-trail";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("kana-trail-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readFoundCount(page: Page): Promise<number> {
  const text = await page.getByTestId("kana-trail-found-count").innerText();
  const matched = text.match(/(\d+)/);
  return Number(matched?.[1] ?? 0);
}

/** 盤面を1回のラウンドトリップでまとめて読む(各タイルの data-letter 属性から)。 */
async function readGrid(page: Page): Promise<string[][]> {
  return page.evaluate(
    ({ rows, cols }) => {
      const grid: string[][] = [];
      for (let row = 0; row < rows; row++) {
        const line: string[] = [];
        for (let col = 0; col < cols; col++) {
          const el = document.querySelector(`[data-testid="kana-trail-tile-${row}-${col}"]`);
          line.push(el?.getAttribute("data-letter") ?? "");
        }
        grid.push(line);
      }
      return grid;
    },
    { rows: GRID_ROWS, cols: GRID_COLS },
  );
}

/** 実際の盤面を隣接マスだけを辿って探索し、辞書にある単語の経路を1つ見つける(バックトラッキング)。 */
function findWordPath(grid: string[][]): TileCoord[] | null {
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = new Set<string>();

  function search(word: string, tile: TileCoord, index: number, path: TileCoord[]): boolean {
    if (grid[tile.row][tile.col] !== word[index]) return false;
    path.push(tile);
    if (index === word.length - 1) return true;

    const key = `${tile.row},${tile.col}`;
    visited.add(key);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (visited.has(`${row},${col}`)) continue;
        const next = { row, col };
        if (!isAdjacent(tile, next)) continue;
        if (search(word, next, index + 1, path)) return true;
      }
    }
    visited.delete(key);
    path.pop();
    return false;
  }

  for (const word of WORD_LIST) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const path: TileCoord[] = [];
        visited.clear();
        if (search(word, { row, col }, 0, path)) return path;
      }
    }
  }
  return null;
}

function tileLocator(page: Page, tile: TileCoord): Locator {
  return page.getByTestId(`kana-trail-tile-${tile.row}-${tile.col}`);
}

/** 盤面(タイルの文字)がクライアント側で実際に生成されるのを待つ。 */
async function waitForBoardReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () => (await tileLocator(page, { row: 0, col: 0 }).getAttribute("data-letter")) ?? "",
      { message: "盤面のタイルに文字が入る" },
    )
    .not.toBe("");
}

async function dragThroughPath(page: Page, path: TileCoord[]): Promise<void> {
  const boxes = await Promise.all(path.map((tile) => tileLocator(page, tile).boundingBox()));
  for (const box of boxes) expect(box, "タイルの位置が取得できる").not.toBeNull();
  const centers = boxes.map((box) => ({
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  }));

  await page.mouse.move(centers[0].x, centers[0].y);
  await page.mouse.down();
  for (let i = 1; i < centers.length; i++) {
    await page.mouse.move(centers[i].x, centers[i].y, { steps: 4 });
  }
  await page.mouse.up();
}

/** カーソルを矢印キーで移動させ、Enterでそのタイルを鎖に追加する。 */
async function keyboardAddTile(page: Page, from: TileCoord, to: TileCoord): Promise<void> {
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;
  for (let i = 0; i < Math.abs(dRow); i++) {
    await page.keyboard.press(dRow > 0 ? "ArrowDown" : "ArrowUp");
  }
  for (let i = 0; i < Math.abs(dCol); i++) {
    await page.keyboard.press(dCol > 0 ? "ArrowRight" : "ArrowLeft");
  }
  await page.keyboard.press("Enter");
}

test.describe("Kana Trail のストーリー", () => {
  test("辞書の単語をなぞると加点され、同じ単語は2回数えられない。一時停止で時間も操作も止まる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForBoardReady(page);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    expect(await readFoundCount(page), "開始時の発見数は0").toBe(0);

    const grid = await readGrid(page);
    const path = findWordPath(grid);
    expect(path, "盤面は必ず1つ以上の単語を作れるよう仕込まれている").not.toBeNull();
    if (!path) return;
    const word = path.map((tile) => grid[tile.row][tile.col]).join("");
    const expectedPoints = scoreForWord(word);

    await dragThroughPath(page, path);

    await expect
      .poll(() => readScore(page), { message: "正しい単語をなぞるとスコアが増える" })
      .toBe(expectedPoints);
    expect(await readFoundCount(page), "見つけた言葉の数が増える").toBe(1);
    await expect(page.getByTestId("kana-trail-feedback")).toContainText(word);

    // 同じ単語をもう一度なぞっても加点されない。
    await dragThroughPath(page, path);
    await waitForFrames(page, 10);
    expect(await readScore(page), "同じ単語の2回目は加点されない").toBe(expectedPoints);
    expect(await readFoundCount(page), "発見数も増えない").toBe(1);

    // 一時停止: オーバーレイが出て、時間も操作も止まる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    const scoreBeforePause = await readScore(page);
    await dragThroughPath(page, path);
    expect(await readScore(page), "一時停止中の操作は無視される").toBe(scoreBeforePause);

    // 再開すると続きから進む。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも単語を作って確定できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForBoardReady(page);

    const grid = await readGrid(page);
    const path = findWordPath(grid);
    expect(path).not.toBeNull();
    if (!path) return;
    const word = path.map((tile) => grid[tile.row][tile.col]).join("");
    const expectedPoints = scoreForWord(word);

    const center: TileCoord = { row: Math.floor(GRID_ROWS / 2), col: Math.floor(GRID_COLS / 2) };
    let cursor = center;
    for (const tile of path) {
      await keyboardAddTile(page, cursor, tile);
      cursor = tile;
    }
    await page.keyboard.press("f");

    await expect
      .poll(() => readScore(page), { message: "キーボードで作った単語でもスコアが増える" })
      .toBe(expectedPoints);
    await expect(page.getByTestId("kana-trail-feedback")).toContainText(word);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("短すぎる確定や辞書にない組み合わせは加点されず、Rキーでリセットできる。リサイズしても壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForBoardReady(page);

    // 1マスだけ選んでF確定 → 短すぎるので加点なし。
    await page.keyboard.press("Enter");
    await page.keyboard.press("f");
    expect(await readScore(page), "1文字だけの確定は加点されない").toBe(0);

    // 適当にタイルを連打しても壊れない。
    for (let i = 0; i < 8; i++) {
      await tileLocator(page, { row: i % GRID_ROWS, col: (i + 2) % GRID_COLS }).click();
    }
    await waitForFrames(page, 10);
    await expect(page.getByTestId("kana-trail-board")).toBeVisible();

    // Rキーでいつでもリセットできる。
    const grid = await readGrid(page);
    const path = findWordPath(grid);
    expect(path).not.toBeNull();
    if (path) {
      await dragThroughPath(page, path);
      await expect
        .poll(() => readScore(page), { message: "リセット前に一旦加点させておく" })
        .toBeGreaterThan(0);
    }

    await page.keyboard.press("r");
    expect(await readScore(page), "Rキーでスコアが0に戻る").toBe(0);
    expect(await readFoundCount(page), "Rキーで発見数も0に戻る").toBe(0);

    // スマホ縦持ち相当 → 横向き相当へ。
    const stage = page.getByTestId("game-shell-stage");
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("kana-trail-board")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も実際に遊べる。
    const resizedGrid = await readGrid(page);
    const resizedPath = findWordPath(resizedGrid);
    expect(resizedPath).not.toBeNull();
    if (resizedPath) {
      const resizedWord = resizedPath.map((tile) => resizedGrid[tile.row][tile.col]).join("");
      await dragThroughPath(page, resizedPath);
      await expect
        .poll(() => readScore(page), { message: "リサイズ後も単語をなぞって加点できる" })
        .toBe(scoreForWord(resizedWord));
    }

    expect(errors, "連打・リセット・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
