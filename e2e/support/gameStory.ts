import { expect, type Locator, type Page } from "@playwright/test";

/** 指定フレーム数ぶん実際に画面が更新されるのを待つ（固定時間の sleep は使わない）。 */
export async function waitForFrames(page: Page, frames = 30): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  }, frames);
}

/** 描画が実際に動いている（＝ゲームループが回っている）ことを、見た目の変化で確認する。 */
export async function expectStageToAnimate(page: Page, stage: Locator): Promise<void> {
  const before = await stage.screenshot();
  await waitForFrames(page, 40);
  const after = await stage.screenshot();
  expect(before.equals(after), "画面が時間経過で変化している（ゲームループが動いている）").toBe(
    false,
  );
}

/**
 * キャンバス上でポインタを引きずる。マウスとタッチのどちらでも同じ
 * PointerEvent 経路を通るため、PC / スマホ双方の操作確認になる。
 */
export async function dragOnStage(
  page: Page,
  stage: Locator,
  from: { xRatio: number; yRatio: number },
  to: { xRatio: number; yRatio: number },
): Promise<void> {
  const box = await stage.boundingBox();
  expect(box, "ステージの領域が取得できる").not.toBeNull();
  if (!box) return;

  const start = { x: box.x + box.width * from.xRatio, y: box.y + box.height * from.yRatio };
  const end = { x: box.x + box.width * to.xRatio, y: box.y + box.height * to.yRatio };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

/** ページ内で起きた JS エラーとコンソールエラーを集める。 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
