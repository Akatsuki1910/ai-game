import { expect, test } from "@playwright/test";
import { games } from "../src/games-registry/games";
import {
  collectPageErrors,
  dragOnStage,
  expectStageToAnimate,
  waitForFrames,
} from "./support/gameStory";

/**
 * 全ゲーム共通のストーリーテスト。
 * レジストリに登録されたゲームは自動的にこのテストの対象になるので、
 * 新しいゲームを追加したら「一覧から入って遊べる」ことが必ず検証される。
 */

test("一覧ページに登録済みのゲームがすべて並ぶ", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");

  // データ0件の状態を「正常」として素通りさせない
  expect(games.length, "レジストリにゲームが登録されている").toBeGreaterThan(0);

  for (const game of games) {
    const card = page.getByTestId(`game-card-${game.slug}`);
    await expect(card, `${game.slug} のカードが一覧にある`).toBeVisible();
    await expect(card).toContainText(game.title);
  }

  expect(errors, "一覧ページでエラーが出ていない").toEqual([]);
});

for (const game of games) {
  test(`${game.title}: 一覧から入って遊んで戻れる`, async ({ page }) => {
    const errors = collectPageErrors(page);

    // 1. 一覧から目的のゲームを開く（ユーザーと同じ導線を通す）
    await page.goto("/");
    await page.getByTestId(`game-card-${game.slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/games/${game.slug}$`));

    // 2. ゲーム画面が立ち上がる
    await expect(page.getByTestId("game-shell-title")).toHaveText(game.title);
    const stage = page.getByTestId("game-shell-stage");
    await expect(stage).toBeVisible();
    await expect(stage.locator("canvas"), "描画キャンバスが生成される").toBeVisible();

    // 3. 実際に動いている（止まった絵ではない）
    await expectStageToAnimate(page, stage);

    // 4. 触っても壊れない（PC のドラッグ / スマホのスワイプ相当）
    await dragOnStage(page, stage, { xRatio: 0.3, yRatio: 0.5 }, { xRatio: 0.6, yRatio: 0.35 });
    await waitForFrames(page, 20);
    await expect(stage.locator("canvas"), "操作後もキャンバスが生きている").toBeVisible();

    // 5. 一覧に戻れる
    await page.getByTestId("game-shell-back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId(`game-card-${game.slug}`)).toBeVisible();

    expect(errors, `${game.slug} の操作中にエラーが出ていない`).toEqual([]);
  });
}
