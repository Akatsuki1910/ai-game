import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, dragOnStage, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/satellite-uplink";

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readStaticLevel(page: Page): Promise<number> {
  const value = await page.getByTestId("satellite-uplink-static").getAttribute("data-level");
  expect(value, "ノイズ量が属性から読み取れる").not.toBeNull();
  return Number(value);
}

async function readIsLocked(page: Page): Promise<boolean> {
  const value = await page.getByTestId("satellite-uplink-lock").getAttribute("data-locked");
  return value === "true";
}

/**
 * ゲームループが最初の1フレームを描画し、各マーカーに実際の座標・角度が
 * 入るまで待つ。マウント直後はステージがまだ計測されておらず(width/height = 0)、
 * マーカーの data-az/data-el 属性が未設定のままになるため、これを待たずに読むと
 * 「存在しない」のではなく「まだ描かれていない」だけのタイミングを誤検知する。
 */
async function waitForStageReady(page: Page): Promise<void> {
  await expect(page.getByTestId("satellite-uplink-stage").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("satellite-uplink-dish-marker")).toHaveAttribute("data-az", /^\d/);
  await expect(page.getByTestId("satellite-uplink-satellite-marker")).toHaveAttribute(
    "data-az",
    /^\d/,
  );
}

async function readMarkerCenter(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} の座標が取得できる`).not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * 衛星の現在位置を狙って一瞬だけアンテナを向ける(押して動かして離す、1パルス分)。
 * 衛星は常時動き続けるため、連続ドラッグではなく「狙い直し→短く掴む」を繰り返す方が
 * 実際の操作(狙点を見ながら細かく当て直す)に近く、expect.poll との組み合わせで安定する。
 */
async function pulseAimAtSatelliteOnce(page: Page): Promise<void> {
  const satellite = await readMarkerCenter(page, "satellite-uplink-satellite-marker");
  await page.mouse.move(satellite.x, satellite.y);
  await page.mouse.down();
  await waitForFrames(page, 3);
  await page.mouse.up();
}

interface AimState {
  dishAz: number;
  dishEl: number;
  satAz: number;
  satEl: number;
  score: number;
}

/**
 * アンテナと衛星の向き、データ量を1回のラウンドトリップでまとめて読む。遅い環境では1回の
 * 読み取りに100ms以上かかり、別々に読むと読み終わるまでにアンテナが大きく回り過ぎる。
 */
async function readAimState(page: Page): Promise<AimState> {
  return page.evaluate(() => {
    const readAttr = (testId: string, attr: string) =>
      Number(document.querySelector(`[data-testid="${testId}"]`)?.getAttribute(attr) ?? Number.NaN);
    const scoreText = document.querySelector('[data-testid="game-shell-score"]')?.textContent ?? "";
    return {
      dishAz: readAttr("satellite-uplink-dish-marker", "data-az"),
      dishEl: readAttr("satellite-uplink-dish-marker", "data-el"),
      satAz: readAttr("satellite-uplink-satellite-marker", "data-az"),
      satEl: readAttr("satellite-uplink-satellite-marker", "data-el"),
      score: Number(scoreText.replace(/[^\d]/g, "")),
    };
  });
}

// 照準が合う範囲(LOCK_TOLERANCE_DEG)より十分内側で止め、細かな行き来でキーを押し直さない。
const AIM_DEADBAND_DEG = 3;

/** 方位角の最短方向(-180〜180)。正なら右(増やす)方向、負なら左(減らす)方向。 */
function shortestAzDiff(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/**
 * キーボードで衛星の方向へアンテナを向ける。押す向きが変わるまでキーは押したままにする
 * (毎回押して離すと、角度を読み取っている間は回らないため、遅い環境では押している時間の
 * 割合が2割ほどに落ち、動き続ける衛星に追いつけないまま回線切断になる)。
 */
async function keyboardSteerTowardSatellite(
  page: Page,
  heldKeys: Set<string>,
  aim: AimState,
): Promise<void> {
  const azDiff = shortestAzDiff(aim.dishAz, aim.satAz);
  const elDiff = aim.satEl - aim.dishEl;
  const wantedKeys = new Set<string>();
  if (Math.abs(azDiff) > AIM_DEADBAND_DEG) wantedKeys.add(azDiff > 0 ? "ArrowRight" : "ArrowLeft");
  if (Math.abs(elDiff) > AIM_DEADBAND_DEG) wantedKeys.add(elDiff > 0 ? "ArrowUp" : "ArrowDown");

  for (const key of [...heldKeys]) {
    if (wantedKeys.has(key)) continue;
    await page.keyboard.up(key);
    heldKeys.delete(key);
  }
  for (const key of wantedKeys) {
    if (heldKeys.has(key)) continue;
    await page.keyboard.down(key);
    heldKeys.add(key);
  }
  await waitForFrames(page, 1);
}

test.describe("Satellite Uplink のストーリー", () => {
  test("衛星に照準を合わせ続けるとロックしてデータが増え、一時停止・再開もできる", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForStageReady(page);

    expect(await readScore(page), "開始時のデータは0").toBe(0);
    expect(await readIsLocked(page), "開始時はロックしていない").toBe(false);

    await expect
      .poll(
        async () => {
          await pulseAimAtSatelliteOnce(page);
          return readScore(page);
        },
        { message: "衛星を追尾し続けるとデータが増える", timeout: 25_000, intervals: [50] },
      )
      .toBeGreaterThan(0);

    // 一時停止すると状態が完全に止まる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedStatic = await readStaticLevel(page);
    await waitForFrames(page, 40);
    expect(await readScore(page), "一時停止中はデータが変化しない").toBe(pausedScore);
    expect(await readStaticLevel(page), "一時停止中はノイズも変化しない").toBe(pausedStatic);

    // 一時停止中にアンテナを操作しても無視される。
    await pulseAimAtSatelliteOnce(page);
    expect(await readScore(page), "一時停止中の操作でデータが動かない").toBe(pausedScore);

    // 再開すると追尾を再開できる。
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(
        async () => {
          await pulseAimAtSatelliteOnce(page);
          return readScore(page);
        },
        { message: "再開後も追尾してデータが増える", timeout: 20_000, intervals: [50] },
      )
      .toBeGreaterThan(pausedScore);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("照準を外したまま放置するとノイズが蓄積し回線切断になる。リスタートで最初からやり直せる", async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForStageReady(page);

    // 初期配置ではアンテナと衛星が離れているため、何もしなくてもノイズが増え続ける。
    await expect
      .poll(() => readStaticLevel(page), { message: "何もしないとノイズが増える", timeout: 5_000 })
      .toBeGreaterThan(0);

    await expect(page.getByTestId("satellite-uplink-gameover")).toBeVisible({ timeout: 20_000 });
    expect(await readStaticLevel(page), "ノイズが上限に達している").toBe(100);

    // ゲームオーバー後にステージを操作しても状態は変化しない。回線切断の表示はステージ全体を覆い
    // 中央にリスタートボタンがあるため、衛星の位置を押すとたまたまボタンと重なってやり直してしまう。
    // ボタンから離れた隅を操作する。
    const scoreAtGameOver = await readScore(page);
    const stageBox = await page.getByTestId("satellite-uplink-stage").boundingBox();
    expect(stageBox, "ステージの領域が取得できる").not.toBeNull();
    if (stageBox) {
      await page.mouse.move(stageBox.x + stageBox.width * 0.1, stageBox.y + stageBox.height * 0.1);
      await page.mouse.down();
      await waitForFrames(page, 3);
      await page.mouse.up();
    }
    await waitForFrames(page, 10);
    expect(await readScore(page), "回線切断後の操作でデータが変化しない").toBe(scoreAtGameOver);
    expect(await readStaticLevel(page), "回線切断後の操作でノイズが変化しない").toBe(100);

    await page.getByTestId("satellite-uplink-restart").click();
    await expect(page.getByTestId("satellite-uplink-gameover")).toBeHidden();
    await expect.poll(() => readScore(page), { message: "リスタートでデータが0に戻る" }).toBe(0);
    // ノイズはリセット直後も無操作なら時間経過で増え続けるため、クリックからこの読み取りまでの
    // わずかな経過フレーム分だけはゼロを超える可能性がある。「ほぼゼロに戻った」ことを許容幅つきで確認する。
    await expect
      .poll(() => readStaticLevel(page), { message: "リスタートでノイズがほぼ0に戻る" })
      .toBeLessThanOrEqual(5);

    expect(errors, "ノイズ蓄積・リスタート中にエラーが出ていない").toEqual([]);
  });

  test("キーボード操作でも追尾でき、連打や画面リサイズをしても壊れない", async ({ page }) => {
    test.setTimeout(40_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    await waitForStageReady(page);

    const stage = page.getByTestId("game-shell-stage");

    const heldKeys = new Set<string>();
    await expect
      .poll(
        async () => {
          const aim = await readAimState(page);
          if (aim.score === 0) await keyboardSteerTowardSatellite(page, heldKeys, aim);
          return aim.score;
        },
        { message: "キーボードでも追尾してデータが増える", timeout: 25_000, intervals: [50] },
      )
      .toBeGreaterThan(0);
    for (const key of heldKeys) await page.keyboard.up(key);

    // 連打(ランダムな位置への一瞬のドラッグ)をしても画面が壊れない。回線切断ならその都度リスタートする。
    const gameOver = page.getByTestId("satellite-uplink-gameover");
    for (let i = 0; i < 10; i++) {
      if (await gameOver.isVisible().catch(() => false)) {
        await page.getByTestId("satellite-uplink-restart").click();
        continue;
      }
      await dragOnStage(
        page,
        stage,
        { xRatio: (i * 0.13) % 1, yRatio: 0.5 },
        { xRatio: (i * 0.13 + 0.2) % 1, yRatio: 0.3 },
      );
      await waitForFrames(page, 5);
    }
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("satellite-uplink-restart").click();
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
    if (await gameOver.isVisible().catch(() => false)) {
      await page.getByTestId("satellite-uplink-restart").click();
    }
    const beforeResize = await readScore(page);
    await expect
      .poll(
        async () => {
          await pulseAimAtSatelliteOnce(page);
          return readScore(page);
        },
        { message: "リサイズ後も追尾できる", timeout: 20_000, intervals: [50] },
      )
      .toBeGreaterThanOrEqual(beforeResize);

    expect(errors, "連打・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
