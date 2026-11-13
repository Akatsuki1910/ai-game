import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectPageErrors, waitForFrames } from "./support/gameStory";

const GAME_PATH = "/games/mobile-poise";

interface HookInfo {
  index: number;
  offset: number;
  filled: boolean;
}

interface TrayCharmInfo {
  index: number;
  mass: number;
}

async function readLevel(page: Page): Promise<number> {
  const text = await page.getByTestId("mobile-poise-level").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `レベル表示から数値を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readTimerSeconds(page: Page): Promise<number> {
  const text = await page.getByTestId("mobile-poise-timer").innerText();
  const matched = text.match(/(\d+)/);
  expect(matched, `タイマー表示から秒数を読み取れる: "${text}"`).not.toBeNull();
  return Number(matched?.[1] ?? Number.NaN);
}

async function readScore(page: Page): Promise<number> {
  const text = await page.getByTestId("game-shell-score").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** 現在のフック一覧(オフセット・充填状態)を1回のラウンドトリップでまとめて読む。 */
async function readHooks(page: Page): Promise<HookInfo[]> {
  return page.evaluate(() => {
    const results: { index: number; offset: number; filled: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      const el = document.querySelector(`[data-testid="mobile-poise-hook-${i}"]`);
      if (!el) break;
      results.push({
        index: i,
        offset: Number(el.getAttribute("data-offset")),
        filled: el.getAttribute("data-filled") === "true",
      });
    }
    return results;
  });
}

/** 現在トレイにあるおもり(表示上のトレイ内インデックスと重さ)を読む。 */
async function readTrayCharms(page: Page): Promise<TrayCharmInfo[]> {
  return page.evaluate(() => {
    const results: { index: number; mass: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const el = document.querySelector(`[data-testid="mobile-poise-charm-${i}"]`);
      if (!el) break;
      const offset = el.getAttribute("data-hook-offset");
      if (offset === "") {
        results.push({ index: i, mass: Number(el.getAttribute("data-mass")) });
      }
    }
    return results;
  });
}

async function readTargetTorque(page: Page): Promise<number> {
  const value = await page.getByTestId("mobile-poise-hold").getAttribute("data-target-torque");
  expect(value, "目標トルクが属性から読み取れる").not.toBeNull();
  return Number(value);
}

/**
 * 現在のフック配置とトレイの中身から、target トルクに一致する割り当て
 * (フックindex → トレイ内で何番目のおもりを掛けるか)を全順列探索で1つ求める。
 * トレイの並びは「掛けるたびに詰まる」ため、見つけた割り当ては毎回トレイの先頭から
 * 1つずつ減っていく前提の順序(フックindex昇順)で返す。
 */
function solveAssignmentOrder(
  hooks: HookInfo[],
  tray: TrayCharmInfo[],
  target: number,
): number[] | null {
  const n = hooks.length;
  const indices = tray.map((c) => c.index);

  function permute(remaining: number[], used: number[]): number[] | null {
    if (used.length === n) {
      const torque = used.reduce((sum, charmIndex, hookIdx) => {
        const mass = tray.find((c) => c.index === charmIndex)?.mass ?? 0;
        return sum + mass * hooks[hookIdx].offset;
      }, 0);
      return torque === target ? used : null;
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
      const result = permute(next, [...used, remaining[i]]);
      if (result) return result;
    }
    return null;
  }

  return permute(indices, []);
}

async function dragCharmToHook(
  page: Page,
  stage: Locator,
  charmTestId: string,
  hookTestId: string,
): Promise<void> {
  const charmBox = await page.getByTestId(charmTestId).boundingBox();
  const hookBox = await page.getByTestId(hookTestId).boundingBox();
  expect(charmBox, `${charmTestId} の位置が取得できる`).not.toBeNull();
  expect(hookBox, `${hookTestId} の位置が取得できる`).not.toBeNull();
  if (!charmBox || !hookBox) return;

  const from = { x: charmBox.x + charmBox.width / 2, y: charmBox.y + charmBox.height / 2 };
  const to = { x: hookBox.x + hookBox.width / 2, y: hookBox.y + hookBox.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  void stage;
}

test.describe("Mobile Poise のストーリー", () => {
  test("フックに正しく掛け続けるとラウンドをクリアしてレベルが進み、一時停止もできる", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const stage = page.getByTestId("mobile-poise-stage");
    await expect(stage).toBeVisible();
    expect(await readLevel(page), "開始時はレベル1").toBe(1);
    expect(await readScore(page), "開始時のスコアは0").toBe(0);
    const startedAt = await readTimerSeconds(page);
    expect(startedAt, "制限時間が表示されている").toBeGreaterThan(0);

    const hooks = await readHooks(page);
    const tray = await readTrayCharms(page);
    const target = await readTargetTorque(page);
    expect(hooks.length, "フックが3つ以上ある").toBeGreaterThanOrEqual(3);
    expect(tray.length, "おもりがフックと同じ数だけトレイにある").toBe(hooks.length);

    const order = solveAssignmentOrder(hooks, tray, target);
    expect(order, "解ける割り当てが見つかる").not.toBeNull();
    if (!order) return;

    // order[hookIndex] は、そのフックに掛けるべきおもりの安定した(ラウンド内で不変の)
    // charm番号。おもりのDOM上の位置は毎フレーム更新されるので、都度 boundingBox を読めば
    // トレイ内の見た目の並びが変わっていても正しくドラッグできる。
    for (let hookIndex = 0; hookIndex < order.length; hookIndex++) {
      await dragCharmToHook(
        page,
        stage,
        `mobile-poise-charm-${order[hookIndex]}`,
        `mobile-poise-hook-${hookIndex}`,
      );
      await waitForFrames(page, 5);
    }

    await expect
      .poll(() => readLevel(page), { message: "正しく配置し続けるとレベルが進む", timeout: 10000 })
      .toBeGreaterThan(1);
    expect(await readScore(page), "レベルアップでスコアが入る").toBeGreaterThan(0);

    // 一時停止すると時間が止まる
    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeVisible();
    const pausedScore = await readScore(page);
    const pausedTimer = await readTimerSeconds(page);
    await waitForFrames(page, 60);
    expect(await readScore(page), "一時停止中はスコアが変化しない").toBe(pausedScore);
    expect(await readTimerSeconds(page), "一時停止中は残り時間が減らない").toBe(pausedTimer);

    await page.getByTestId("game-shell-pause").click();
    await expect(page.getByTestId("game-shell-pause-overlay")).toBeHidden();
    await expect
      .poll(() => readTimerSeconds(page), { message: "再開後は残り時間がまた減る" })
      .toBeLessThan(pausedTimer);

    expect(errors, "操作中にエラーが出ていない").toEqual([]);
  });

  test("キーボードでおもりを掛け外しできる。連打や画面リサイズをしても壊れない", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(GAME_PATH);

    const hookCountBefore = (await readHooks(page)).length;

    // 矢印キーで最初のフックを選び、数字キーでトレイ先頭のおもりを掛ける
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("1");
    await expect
      .poll(async () => (await readHooks(page))[0]?.filled, { message: "フック0が充填される" })
      .toBe(true);

    // Backspaceで外せる
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await readHooks(page))[0]?.filled, { message: "フック0が空に戻る" })
      .toBe(false);

    // 矢印キーを連打してもフック数を超えて壊れない(ラップアラウンドする)
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(i % 2 === 0 ? "ArrowRight" : "ArrowLeft");
    }
    // 選択が何であれ、フックが空いていればまだ掛けられる
    await page.keyboard.press("1");
    await expect
      .poll(async () => (await readHooks(page)).some((h) => h.filled), {
        message: "連打後もキー操作でおもりを掛けられる",
      })
      .toBe(true);

    // 何も選択していない状態での数字キー/Backspaceは無視されて壊れない
    await page.keyboard.press("r");
    await expect
      .poll(async () => (await readHooks(page)).every((h) => !h.filled), {
        message: "リセットで全フックが空になる",
      })
      .toBe(true);
    await page.keyboard.press("5");
    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("mobile-poise-stage")).toBeVisible();

    // スマホ縦持ち相当 → 横向き相当へ
    await page.setViewportSize({ width: 390, height: 780 });
    await waitForFrames(page, 20);
    await expect(page.getByTestId("mobile-poise-stage"), "縦長でも表示が生きている").toBeVisible();

    await page.setViewportSize({ width: 780, height: 390 });
    await waitForFrames(page, 20);
    await expect(page.getByTestId("mobile-poise-stage"), "横長でも表示が生きている").toBeVisible();

    // リサイズ後もフック数は変わらず操作を受け付ける
    expect((await readHooks(page)).length, "リサイズ後もフック数は変わらない").toBe(
      hookCountBefore,
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("1");
    await expect
      .poll(async () => (await readHooks(page)).some((h) => h.filled), {
        message: "リサイズ後もキー操作でおもりを掛けられる",
      })
      .toBe(true);

    expect(errors, "キー操作・リサイズ中にエラーが出ていない").toEqual([]);
  });
});
