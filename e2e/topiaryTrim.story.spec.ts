import { expect, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/topiary-trim";

interface Ratio {
  x: number;
  y: number;
}

async function readCoveragePercent(page: Page): Promise<number> {
  const text = await page.getByTestId("topiary-trim-coverage").innerText();
  const matched = text.match(/充填率 (\d+)%/);
  expect(matched, `充填率の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readPrunes(page: Page): Promise<number> {
  const text = await page.getByTestId("topiary-trim-prunes").innerText();
  const matched = text.match(/剪定 (\d+)回/);
  expect(matched, `剪定回数の表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readHealthPercent(page: Page): Promise<number> {
  const fill = page.getByTestId("topiary-trim-health").locator("div");
  const style = await fill.getAttribute("style");
  const matched = style?.match(/width:\s*(\d+)%/);
  expect(matched, `体力ゲージの幅から数値を読み取れる: "${style}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

async function readTargetMarker(page: Page): Promise<{ hasEscaped: boolean } & Ratio> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="topiary-trim-target"]');
    return {
      hasEscaped: el?.dataset.hasEscaped === "true",
      x: Number(el?.dataset.xRatio ?? Number.NaN),
      y: Number(el?.dataset.yRatio ?? Number.NaN),
    };
  });
}

/** はみ出した枝が現れるまで待ち、その先端の位置(ステージ比率)を返す。 */
async function waitForEscapedTarget(page: Page, timeout = 20_000): Promise<Ratio> {
  await expect
    .poll(async () => (await readTargetMarker(page)).hasEscaped, {
      message: "境界からはみ出す枝が現れる",
      timeout,
    })
    .toBe(true);
  const marker = await readTargetMarker(page);
  return { x: marker.x, y: marker.y };
}

test.describe("Topiary Trim のストーリー", () => {
  test("起動直後はHUDが揃い、操作しなくても画面は生きている", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    await expect(page.getByTestId("topiary-trim-coverage")).toHaveText("充填率 0%");
    await expect(page.getByTestId("topiary-trim-prunes")).toHaveText("剪定 0回");
    expect(await readHealthPercent(page), "開始時の体力は満タン").toBe(100);
    await expect(page.getByTestId("topiary-trim-gameover")).toBeHidden();

    const stage = page.getByTestId("game-shell-stage");
    const canvas = stage.locator("canvas");
    await expect(canvas).toBeVisible();

    // 操作しなくても枝が育ち続け、充填率が上がっていく(=ゲームループが回っている)
    await expect
      .poll(() => readCoveragePercent(page), { message: "無操作でも枝が育ち充填率が上がる" })
      .toBeGreaterThan(0);

    expect(errors, "起動直後にエラーが出ていない").toEqual([]);
  });

  test("はみ出した枝をタップ/クリックすると剪定でき、得点と剪定回数が増える", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    await waitForEscapedTarget(page);
    const box = await stage.boundingBox();
    expect(box, "ステージの領域が取得できる").not.toBeNull();
    if (!box) return;

    const scoreBefore = await readScore(page);
    const prunesBefore = await readPrunes(page);

    // 狙った枝が折れて消える前にタップが間に合わないことがあるため、
    // 「その時点ではみ出している枝」を都度タップし直しながら剪定成功を待つ。
    await expect
      .poll(
        async () => {
          const marker = await readTargetMarker(page);
          if (marker.hasEscaped) {
            await page.mouse.click(box.x + box.width * marker.x, box.y + box.height * marker.y);
          }
          return readPrunes(page);
        },
        { message: "はみ出した枝をタップすると剪定回数が増える", timeout: 30_000 },
      )
      .toBeGreaterThan(prunesBefore);
    expect(await readScore(page), "剪定するとスコアが増える").toBeGreaterThan(scoreBefore);

    expect(errors, "剪定操作でエラーが出ていない").toEqual([]);
  });

  test("枝をはみ出したまま放置し続けると体力が尽きて終了し、やり直せる", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // 一切剪定せずに放置し続けると、はみ出した枝が折れて体力が尽きる
    await expect
      .poll(() => readHealthPercent(page), {
        message: "はみ出した枝を放置し続けると体力が尽きる",
        timeout: 40_000,
      })
      .toBe(0);

    await expect(page.getByTestId("topiary-trim-gameover"), "終了画面が出る").toBeVisible();

    const scoreAtOver = await readScore(page);
    await waitForFrames(page, 30);
    expect(await readScore(page), "終了後はスコアが変化しない").toBe(scoreAtOver);

    // 終了後にタップしても状態が変化しない(連続操作でも壊れない)
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await waitForFrames(page, 10);
    }
    expect(await readHealthPercent(page), "終了後は体力ゲージも変化しない").toBe(0);

    await page.getByTestId("topiary-trim-restart").click();
    await expect(page.getByTestId("topiary-trim-gameover")).toBeHidden();
    // 枝は再開後すぐに育ち始めるため、充填率は「低い値に戻っている」ことだけを確かめる
    // (ちょうど0%になる一瞬を狙うのはタイミング依存になり不安定なため)。
    expect(await readCoveragePercent(page), "やり直すと充填率が低い値に戻る").toBeLessThan(40);
    expect(await readHealthPercent(page), "やり直すと体力が満タンに戻る").toBe(100);
    await expect(page.getByTestId("topiary-trim-prunes")).toHaveText("剪定 0回");

    expect(errors, "一連の操作でエラーが出ていない").toEqual([]);
  });

  test("一時停止で完全に止まり、連打しても状態がずれない", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // はみ出した枝が現れてから一時停止する(一時停止中は剪定もできないことを確かめるため)
    const target = await waitForEscapedTarget(page);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();

    const healthWhilePaused = await readHealthPercent(page);
    const before = await stage.screenshot();
    await waitForFrames(page, 40);
    const after = await stage.screenshot();
    expect(before.equals(after), "一時停止中は画面が完全に止まる").toBe(true);
    expect(await readHealthPercent(page), "一時停止中は体力が変化しない").toBe(healthWhilePaused);

    // 一時停止中にはみ出した枝をタップしても剪定は成立しない
    await page.mouse.click(box.x + box.width * target.x, box.y + box.height * target.y);
    await waitForFrames(page, 10);
    expect(await readPrunes(page), "一時停止中のタップでは剪定できない").toBe(0);

    const pauseButton = page.getByTestId("game-shell-pause");
    await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();

    for (let i = 0; i < 6; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect(pauseButton).toHaveText("一時停止");

    for (let i = 0; i < 5; i++) await pauseButton.click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    await expect(pauseButton).toHaveText("再開");

    expect(errors, "一時停止の連打でエラーが出ていない").toEqual([]);
  });

  test("矢印キー/Enterでのシアー操作でも壊れない", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();
    await stage.click({ position: { x: 5, y: 5 } });

    for (const key of ["ArrowLeft", "a", "ArrowRight", "d", "Enter"]) {
      await page.keyboard.down(key);
      await waitForFrames(page, 5);
      await page.keyboard.up(key);
      await waitForFrames(page, 5);
    }

    await expect(stage.locator("canvas"), "キーボード操作後もキャンバスが生きている").toBeVisible();
    expect(errors, "キーボード操作でエラーが出ていない").toEqual([]);
  });

  test("画面サイズが変わっても遊べる状態が続く", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage.locator("canvas")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "縦長でもキャンバスが生きている").toBeVisible();
    await expect(page.getByTestId("topiary-trim-health")).toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "横長でもキャンバスが生きている").toBeVisible();

    // リサイズ後も操作を受け付ける(タップで剪定が成立しうる)
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await waitForFrames(page, 10);
    }
    const healthAfterResize = await readHealthPercent(page);
    expect(healthAfterResize).toBeGreaterThanOrEqual(0);
    expect(healthAfterResize).toBeLessThanOrEqual(100);

    expect(errors, "リサイズ中にエラーが出ていない").toEqual([]);
  });
});
