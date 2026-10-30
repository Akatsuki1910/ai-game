import { expect, type Page, test } from "@playwright/test";
import {
  type GridCoord,
  getPorts,
  pathEntryExitPorts,
  shapeForPorts,
} from "../src/app/games/flow-tap/engine/grid";
import {
  GRID_COLS,
  GRID_ROWS,
  SINK,
  SINK_DIR,
  SOURCE,
  SOURCE_DIR,
} from "../src/app/games/flow-tap/engine/world";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/flow-tap";

async function readLives(page: Page): Promise<number> {
  const text = await page.getByTestId("flow-tap-lives").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ライフ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readWave(page: Page): Promise<number> {
  const text = await page.getByTestId("flow-tap-wave").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `ウェーブ表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** 画面上の各マスの shape/rotation を一括で読み取る。 */
async function readGrid(page: Page): Promise<{ shape: string; rotation: number }[][]> {
  return page.evaluate(
    ({ rows, cols }) => {
      const grid: { shape: string; rotation: number }[][] = [];
      for (let row = 0; row < rows; row++) {
        const line: { shape: string; rotation: number }[] = [];
        for (let col = 0; col < cols; col++) {
          const el = document.querySelector(`[data-testid="flow-tap-cell-${row}-${col}"]`);
          line.push({
            shape: el?.getAttribute("data-shape") ?? "",
            rotation: Number(el?.getAttribute("data-rotation") ?? "0"),
          });
        }
        grid.push(line);
      }
      return grid;
    },
    { rows: GRID_ROWS, cols: GRID_COLS },
  );
}

/** source から sink まで、東/南だけで進みうる経路をすべて列挙する(高々 C(9,4)=126本)。 */
function enumerateMonotonicPaths(): GridCoord[][] {
  const results: GridCoord[][] = [];
  function build(path: GridCoord[]): void {
    const coord = path[path.length - 1];
    if (coord.col === SINK.col && coord.row === SINK.row) {
      results.push(path);
      return;
    }
    if (coord.col < SINK.col) build([...path, { col: coord.col + 1, row: coord.row }]);
    if (coord.row < SINK.row) build([...path, { col: coord.col, row: coord.row + 1 }]);
  }
  build([SOURCE]);
  return results;
}

/**
 * 盤面の現在の shape（直線/曲がり）から、実際に繋がりうる source→sink の経路を探す。
 * 見つかった経路について、各マスが「あと何回タップすれば正解の向きになるか」を返す。
 * Flow Tap の経路生成は常に東/南だけで単調に進むため、候補をすべて試せば必ず見つかる。
 */
function findPathFixes(
  grid: { shape: string; rotation: number }[][],
): { coord: GridCoord; tapsNeeded: number }[] | null {
  for (const path of enumerateMonotonicPaths()) {
    const fixes: { coord: GridCoord; tapsNeeded: number }[] = [];
    let valid = true;

    for (let index = 0; index < path.length; index++) {
      const coord = path[index];
      const [entry, exit] = pathEntryExitPorts(path, index, SOURCE_DIR, SINK_DIR);
      const requiredShape = shapeForPorts(entry, exit);
      const cell = grid[coord.row][coord.col];
      if (cell.shape !== requiredShape) {
        valid = false;
        break;
      }

      let tapsNeeded = 0;
      for (; tapsNeeded < 4; tapsNeeded++) {
        const rotation = ((cell.rotation + tapsNeeded) % 4) as 0 | 1 | 2 | 3;
        const actual = getPorts({ shape: requiredShape, rotation });
        const matches =
          (actual[0] === entry && actual[1] === exit) ||
          (actual[0] === exit && actual[1] === entry);
        if (matches) break;
      }
      fixes.push({ coord, tapsNeeded });
    }

    if (valid) return fixes;
  }
  return null;
}

/**
 * セルの中心座標を生のマウスクリックで叩く。一時停止オーバーレイがセルの上に
 * 重なっている間は Playwright の通常の `.click()`（要素が隠れていないかを待つ）が
 * ハングしてしまうため、座標ベースのクリックで代用する
 * （一時停止オーバーレイがクリックを奪うこと自体が「操作が無視される」ことの検証になる）。
 */
async function tapCell(page: Page, coord: GridCoord, times: number): Promise<void> {
  const cell = page.getByTestId(`flow-tap-cell-${coord.row}-${coord.col}`);
  const box = await cell.boundingBox();
  expect(box, `セル(${coord.row},${coord.col})の位置が取得できる`).not.toBeNull();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let i = 0; i < times; i++) await page.mouse.click(x, y);
}

/** 現在の盤面を読み、見つかった経路を正しい向きに修正する。見つからなければ何もしない。 */
async function solveCurrentPath(page: Page): Promise<boolean> {
  const grid = await readGrid(page);
  const fixes = findPathFixes(grid);
  if (!fixes) return false;
  for (const fix of fixes) {
    if (fix.tapsNeeded > 0) await tapCell(page, fix.coord, fix.tapsNeeded);
  }
  return true;
}

test.describe("Flow Tap のストーリー", () => {
  test("パイプを揃えると水が届いてスコアが増え、一時停止中はライフも進行も止まる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("game-shell-score")).toBeVisible();
    await expect(page.getByTestId("flow-tap-board")).toBeVisible();
    await expect(page.getByTestId("flow-tap-cell-0-0")).toBeVisible();

    expect(await readWave(page), "開始時のウェーブは1").toBe(1);
    expect(await readLives(page), "開始時のライフは3").toBe(3);

    // 経路を解いて正しい向きに揃える。水が source から sink まで届くには数秒かかり、
    // 途中でジャムが起きることもあるので、届くまで繰り返し揃え直しながら待つ。
    await solveCurrentPath(page);
    await expect
      .poll(
        async () => {
          await solveCurrentPath(page);
          return readScore(page);
        },
        {
          message: "経路を揃え続けると水が届いてスコアが増える",
          timeout: 25_000,
          intervals: [400],
        },
      )
      .toBeGreaterThan(0);

    // 一時停止: オーバーレイが出て、ライフとスコアが変化しなくなる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const livesAtPause = await readLives(page);
    const scoreAtPause = await readScore(page);
    await waitForFrames(page, 90);
    expect(await readLives(page), "一時停止中はライフが変化しない").toBe(livesAtPause);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(scoreAtPause);

    // 一時停止中にセルをクリックしても盤面は変わらない。
    const gridBeforePauseClick = await readGrid(page);
    await tapCell(page, { col: 0, row: 0 }, 1);
    const gridAfterPauseClick = await readGrid(page);
    expect(gridAfterPauseClick, "一時停止中の操作は無視される").toEqual(gridBeforePauseClick);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボードでカーソル移動とEnterでパイプを回転できる", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("flow-tap-cell-0-0")).toBeVisible();

    const target = page.getByTestId("flow-tap-cell-1-2");
    const rotationBefore = await target.getAttribute("data-rotation");

    // カーソルは中央 (row: Math.floor(GRID_ROWS/2), col: Math.floor(GRID_COLS/2)) = (row:2, col:3)
    // から開始するので、(row:1, col:2) まで矢印キーで1マスずつ移動する。
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");

    await expect(target).toHaveAttribute("data-cursor", "true");
    const rotationAfter = await target.getAttribute("data-rotation");
    expect(rotationAfter, "Enterでカーソル位置のパイプが回転する").not.toBe(rotationBefore);

    expect(errors, "キーボード操作中にエラーが出ていない").toEqual([]);
  });

  test("何もしないまま放置するとライフが尽きてゲームオーバーになり、リスタートで最初から遊び直せる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("flow-tap-cell-0-0")).toBeVisible();

    // 盤面を一切操作しなければ、ランダムな経路が正解である確率は極めて低く、
    // ライフが尽きてゲームオーバーになる。
    await expect(page.getByTestId("flow-tap-gameover")).toBeVisible({ timeout: 45_000 });
    expect(await readLives(page), "ゲームオーバー時はライフ0").toBe(0);

    await page.getByTestId("flow-tap-restart").click();
    await expect(page.getByTestId("flow-tap-gameover")).toBeHidden();
    expect(await readLives(page), "リスタートでライフが3に戻る").toBe(3);
    expect(await readWave(page), "リスタートでウェーブが1に戻る").toBe(1);
    expect(await readScore(page), "リスタートでスコアが0に戻る").toBe(0);

    expect(errors, "ゲームオーバー・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("連打しても一時停止ボタンの表示と状態がずれず、画面サイズが変わっても遊べる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await expect(page.getByTestId("flow-tap-cell-0-0")).toBeVisible();

    const pauseButton = page.getByTestId("game-shell-pause");
    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    // 同じセルを連打しても壊れない(4回で元の向きに戻る)。
    const cell = page.getByTestId("flow-tap-cell-0-0");
    const rotationBefore = await cell.getAttribute("data-rotation");
    for (let i = 0; i < 4; i++) await cell.click();
    await expect(cell).toHaveAttribute("data-rotation", rotationBefore ?? "0");

    const stage = page.getByTestId("flow-tap-stage");
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("flow-tap-board")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける。
    const rotationBeforeResize = await cell.getAttribute("data-rotation");
    await cell.click();
    await expect(cell, "リサイズ後も回転操作を受け付ける").not.toHaveAttribute(
      "data-rotation",
      rotationBeforeResize ?? "0",
    );

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
