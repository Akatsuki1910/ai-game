import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/domino-reach";
// DominoReachGame.tsx の TRACK_INSET_RATIO / トラック座標変換と一致させておくこと。
const TRACK_INSET_RATIO = 0.08;
// trackLengthForStage(1) (engine/track.ts) はピット無しのチュートリアル段。
const STAGE1_LENGTH = 600;
// 標準ドミノの射程(DOMINO_REACH.standard = 88)よりわずかに狭い間隔で隙間なく並べる。
const STANDARD_SPACING = 84;

function worldXToStageRatio(worldX: number, trackLength: number): number {
  return TRACK_INSET_RATIO + (worldX / trackLength) * (1 - TRACK_INSET_RATIO * 2);
}

async function tapWorldX(stage: Locator, worldX: number, trackLength: number): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;
  const ratio = worldXToStageRatio(worldX, trackLength);
  await stage.click({ position: { x: box.width * ratio, y: box.height * 0.5 } });
}

async function readPlacedCount(page: Page): Promise<number> {
  const text = await page.getByTestId("domino-reach-placed-count").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `設置数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("domino-reach-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマーの表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

/** ステージ1(ピット無し)を標準ドミノだけで隙間なく橋渡しする。 */
async function bridgeTutorialStage(page: Page, stage: Locator): Promise<void> {
  await page.getByTestId("domino-reach-palette-standard").click();
  for (let x = 20; x < STAGE1_LENGTH; x += STANDARD_SPACING) {
    await tapWorldX(stage, x, STAGE1_LENGTH);
  }
}

test.describe("Domino Reach のストーリー", () => {
  test("ドミノを橋渡ししてGOすると連鎖がゴールまで届き、次のステージへ進める", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("domino-reach-stage-label")).toHaveText("ステージ 1");
    expect(await readPlacedCount(page), "開始時は未配置").toBe(0);

    const stage = page.getByTestId("domino-reach-stage");
    await bridgeTutorialStage(page, stage);

    await expect
      .poll(() => readPlacedCount(page), { message: "橋渡し分のドミノが置けている" })
      .toBeGreaterThanOrEqual(7);

    await page.getByTestId("domino-reach-go").click();
    await expect(page.getByTestId("domino-reach-phase")).toHaveText("連鎖中…");

    await expect(page.getByTestId("domino-reach-success")).toBeVisible();
    await expect(page.getByTestId("game-shell-score")).toContainText("100");

    // 成功後は次のステージへ進め、配置がリセットされる
    await page.getByTestId("domino-reach-next").click();
    await expect(page.getByTestId("domino-reach-stage-label")).toHaveText("ステージ 2");
    expect(await readPlacedCount(page), "新しいステージは未配置から始まる").toBe(0);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("ドミノが足りず連鎖が途切れると失敗し、同じステージに再挑戦できてライフが減る", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const livesBefore = await page.getByTestId("domino-reach-lives").innerText();

    const stage = page.getByTestId("domino-reach-stage");
    await page.getByTestId("domino-reach-palette-standard").click();
    // コース序盤に1本だけ置いても、ゴール(600)までの射程には遠く届かない
    await tapWorldX(stage, 20, STAGE1_LENGTH);
    await expect.poll(() => readPlacedCount(page)).toBe(1);

    await page.getByTestId("domino-reach-go").click();
    await expect(page.getByTestId("domino-reach-failed")).toBeVisible();

    await page.getByTestId("domino-reach-retry").click();
    await expect(page.getByTestId("domino-reach-go")).toBeVisible();
    await expect(page.getByTestId("domino-reach-stage-label")).toHaveText("ステージ 1");
    expect(await readPlacedCount(page), "再挑戦では配置がリセットされる").toBe(0);

    const livesAfter = await page.getByTestId("domino-reach-lives").innerText();
    expect(livesAfter, "失敗するとライフが減る").not.toBe(livesBefore);

    expect(errors, "失敗〜再挑戦の操作中にエラーが出ていない").toEqual([]);
  });

  test("一時停止中はタイマーが進まず、操作しても状態が壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const startedAt = await readTimerSeconds(page);
    await expect
      .poll(() => readTimerSeconds(page), { message: "配置フェーズのタイマーが進む" })
      .toBeLessThan(startedAt);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const pausedAt = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedAt);

    // 一時停止中はオーバーレイがポインタを受け止めるため、生のマウス座標で
    // クリックしてもクラッシュしないことだけを確認する(Locator.click()は
    // オーバーレイに遮られて待ち続けてしまうため使わない)。
    const stage = page.getByTestId("domino-reach-stage");
    const pausedStageBox = await stage.boundingBox();
    expect(pausedStageBox, "一時停止中もステージの領域が取得できる").not.toBeNull();
    if (pausedStageBox) {
      const ratio = worldXToStageRatio(20, STAGE1_LENGTH);
      await page.mouse.click(
        pausedStageBox.x + pausedStageBox.width * ratio,
        pausedStageBox.y + pausedStageBox.height * 0.5,
      );
    }

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedAt);

    expect(errors, "一時停止の操作中にエラーが出ていない").toEqual([]);
  });

  test("パレットの選択連打・同じ場所への連続タップをしても表示と状態がずれない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const standardButton = page.getByTestId("domino-reach-palette-standard");
    for (let i = 0; i < 6; i++) await standardButton.click();
    // 偶数回連打 → 選択解除されているはず
    await expect(standardButton).toHaveAttribute("data-armed", "false");

    for (let i = 0; i < 5; i++) await standardButton.click();
    // 奇数回連打 → 選択中のはず
    await expect(standardButton).toHaveAttribute("data-armed", "true");

    const stage = page.getByTestId("domino-reach-stage");
    // 同じ場所への連続タップは1本しか置けない(近すぎる座標は設置を拒否するため)
    for (let i = 0; i < 5; i++) await tapWorldX(stage, 100, STAGE1_LENGTH);
    await expect.poll(() => readPlacedCount(page)).toBe(1);

    // 武装解除してから同じ場所を連打 → 最初の1回だけ回収され、
    // 残りは回収対象が無いので安全に空振りする(クラッシュしない)
    await standardButton.click();
    await expect(standardButton).toHaveAttribute("data-armed", "false");
    for (let i = 0; i < 5; i++) await tapWorldX(stage, 100, STAGE1_LENGTH);
    await expect.poll(() => readPlacedCount(page)).toBe(0);

    expect(errors, "連打中にエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても設置やGOが機能し続ける", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("domino-reach-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当に変えてから配置する
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();

    await bridgeTutorialStage(page, stage);
    await expect
      .poll(() => readPlacedCount(page), { message: "リサイズ後も設置できる" })
      .toBeGreaterThanOrEqual(7);

    // さらに横長(PC相当)へ変えてからGOしても、ワールド座標は画面サイズに依存しないので崩れない
    await page.setViewportSize({ width: 1024, height: 700 });
    await waitForFrames(page, 20);

    await page.getByTestId("domino-reach-go").click();
    await expect(page.getByTestId("domino-reach-success")).toBeVisible();

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
