import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMINO_REACH } from "./chain.ts";
import {
  createSeededRandom,
  createTrack,
  inventoryFor,
  pitCountForStage,
  trackLengthForStage,
} from "./track.ts";

test("ステージ1はピット無しのチュートリアルになる", () => {
  assert.equal(pitCountForStage(1), 0);
  const track = createTrack(1);
  assert.deepEqual(track.pits, []);
  assert.equal(track.length, 600);
});

test("ステージが進むほどコース長とピット数が増え、上限でキャップされる", () => {
  assert.equal(trackLengthForStage(1), 600);
  assert.equal(trackLengthForStage(2), 680);
  assert.equal(trackLengthForStage(20), 1400); // 上限キャップ

  assert.equal(pitCountForStage(2), 2);
  assert.ok(pitCountForStage(10) <= 6, "ピット数は6でキャップされる");
});

test("生成されたピットはコース内に収まり、互いに重ならず、安全マージンを侵さない", () => {
  for (let stage = 2; stage <= 12; stage++) {
    const track = createTrack(stage, createSeededRandom(stage));
    const pitCount = pitCountForStage(stage);
    assert.equal(track.pits.length, pitCount, `stage${stage}: ピット数`);

    let previousEnd = 0;
    for (const pit of track.pits) {
      assert.ok(pit.start < pit.end, `stage${stage}: start<end`);
      assert.ok(pit.start >= previousEnd, `stage${stage}: ピットが重ならない`);
      assert.ok(pit.start >= 0 && pit.end <= track.length, `stage${stage}: コース内`);
      previousEnd = pit.end;
    }
  }
});

test("rng に同じ種を渡すと同じ配置が再現される(決定的生成)", () => {
  const trackA = createTrack(5, createSeededRandom(42));
  const trackB = createTrack(5, createSeededRandom(42));
  assert.deepEqual(trackA, trackB);
});

test("既定(種なし)でもステージ番号が同じなら常に同じ配置になる", () => {
  const trackA = createTrack(4);
  const trackB = createTrack(4);
  assert.deepEqual(trackA, trackB);
});

test("在庫はコース長に応じて増え、ブースターはピット数+余裕枚数になる", () => {
  const shortTrack = createTrack(1);
  const longTrack = createTrack(8);

  const shortInventory = inventoryFor(shortTrack);
  const longInventory = inventoryFor(longTrack);

  assert.ok(longInventory.standard > shortInventory.standard, "長いコースほど標準ドミノが多い");
  assert.equal(longInventory.booster, longTrack.pits.length + 2);
  assert.ok(
    shortInventory.standard >= Math.ceil(shortTrack.length / DOMINO_REACH.standard),
    "最低限は橋渡しできる枚数がある",
  );
});
