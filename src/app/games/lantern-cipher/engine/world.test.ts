import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorCountForLevel,
  evaluateGuess,
  LanternCipherWorld,
  maxAttemptsForLevel,
  roundTimeSecondsForLevel,
  slotCountForLevel,
} from "./world.ts";

// 観点のうち以下は対象外とする(理由を明記):
// - 権限拒否: このゲームはログインや権限を持たないため該当しない。
// - キャッシュの陳腐化: サーバーからのデータ取得を行わないため該当しない。
// - 非同期の競合: 非同期通信を行わず、GameLoopの単一スレッド更新のみのため該当しない。

function wrongGuessFor(secret: readonly number[], colorCount: number): number[] {
  return secret.map((color) => (color + 1) % colorCount);
}

test("初期状態はレベル1の難易度で、ライフ3・スコア0から始まる", () => {
  const world = new LanternCipherWorld();

  assert.equal(world.level, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, 3);
  assert.equal(world.isOver, false);
  assert.equal(world.attemptsUsed, 0);
  assert.deepEqual(world.history, []);
  assert.equal(world.slotCount, slotCountForLevel(1));
  assert.equal(world.colorCount, colorCountForLevel(1));
  assert.equal(world.maxAttempts, maxAttemptsForLevel(1));
  assert.equal(world.roundTimeRemaining, roundTimeSecondsForLevel(1));
  assert.equal(world.secretCode.length, world.slotCount);
  assert.ok(
    world.secretCode.every((color) => color >= 0 && color < world.colorCount),
    "秘密の色はすべて有効な範囲に収まっている",
  );
});

test("evaluateGuess: 完全一致と色だけ一致を正しく区別する(重複色を含む)", () => {
  assert.deepEqual(evaluateGuess([0, 1, 2, 3], [0, 2, 1, 3]), {
    exactMatches: 2,
    colorMatches: 2,
  });
  assert.deepEqual(evaluateGuess([0, 0, 1], [0, 1, 0]), {
    exactMatches: 1,
    colorMatches: 2,
  });
  assert.deepEqual(evaluateGuess([0, 1, 2], [3, 3, 3]), {
    exactMatches: 0,
    colorMatches: 0,
  });
  assert.deepEqual(evaluateGuess([1, 1, 1], [1, 1, 1]), {
    exactMatches: 3,
    colorMatches: 0,
  });
});

test("難易度境界値: レベルが上がるほどスロット数・色数は増え、試行時間・試行回数は減っていく(下限でクランプされる)", () => {
  for (let level = 1; level <= 40; level++) {
    const slots = slotCountForLevel(level);
    const colors = colorCountForLevel(level);
    const attempts = maxAttemptsForLevel(level);
    const time = roundTimeSecondsForLevel(level);

    assert.ok(slots >= 3 && slots <= 6, `level${level}: スロット数が範囲内`);
    assert.ok(colors >= 4 && colors <= 8, `level${level}: 色数が範囲内`);
    assert.ok(attempts >= 6 && attempts <= 10, `level${level}: 試行回数が範囲内`);
    assert.ok(time >= 15 && time <= 30, `level${level}: 制限時間が範囲内`);

    if (level > 1) {
      assert.ok(slots >= slotCountForLevel(level - 1), "スロット数は減らない");
      assert.ok(colors >= colorCountForLevel(level - 1), "色数は減らない");
      assert.ok(attempts <= maxAttemptsForLevel(level - 1), "試行回数は増えない");
      assert.ok(time <= roundTimeSecondsForLevel(level - 1), "制限時間は増えない");
    }
  }
});

test("正しい暗号を解読するとラウンドがクリアされ、得点が入って次のラウンドへ進む", () => {
  const world = new LanternCipherWorld();
  const cleared: { level: number; points: number }[] = [];
  world.onRoundCleared = (event) => cleared.push(event);

  const slotCountBefore = world.slotCount;
  const result = world.submitGuess(world.secretCode);

  assert.ok(result, "結果が返る");
  assert.equal(
    result?.exactMatches,
    slotCountBefore,
    "完全一致した秘密のコードを送ると全スロットが一致する",
  );
  assert.equal(cleared.length, 1, "クリアイベントが1回発火する");
  assert.equal(cleared[0].level, 1);
  assert.ok(cleared[0].points > 0, "得点が入っている");
  assert.equal(world.score, cleared[0].points);
  assert.equal(world.level, 2, "レベルが進む");
  assert.equal(world.lives, 3, "クリアではライフは減らない");
  assert.equal(world.attemptsUsed, 0, "新ラウンドでは試行回数がリセットされる");
  assert.deepEqual(world.history, [], "新ラウンドでは履歴がリセットされる");
  assert.equal(world.slotCount, slotCountForLevel(2));
});

test("間違え続けて試行回数を使い切るとライフが減り、同じレベルで再挑戦になる", () => {
  const world = new LanternCipherWorld();
  const failed: { level: number; reason: string; livesRemaining: number }[] = [];
  world.onRoundFailed = (event) => failed.push(event);

  const levelBefore = world.level;
  const maxAttemptsBefore = world.maxAttempts;
  const wrongGuess = wrongGuessFor(world.secretCode, world.colorCount);

  for (let i = 0; i < maxAttemptsBefore; i++) {
    const result = world.submitGuess(wrongGuess);
    assert.ok(result, `${i + 1}回目の結果が返る`);
    assert.equal(result?.exactMatches, 0, "ずらした誤答は完全一致しない");
  }

  assert.equal(failed.length, 1, "失敗イベントが1回発火する");
  assert.equal(failed[0].reason, "attempts");
  assert.equal(failed[0].livesRemaining, 2);
  assert.equal(world.lives, 2, "ライフが1減る");
  assert.equal(world.level, levelBefore, "レベルは進まない");
  assert.equal(world.attemptsUsed, 0, "再挑戦ラウンドでは試行回数がリセットされる");
  assert.deepEqual(world.history, [], "再挑戦ラウンドでは履歴がリセットされる");
  assert.equal(world.isOver, false);
});

test("ライフが0になるとゲームオーバーになり、以降の入力は無視される", () => {
  const world = new LanternCipherWorld();

  while (!world.isOver) {
    const wrongGuess = wrongGuessFor(world.secretCode, world.colorCount);
    for (let i = 0; i < world.maxAttempts && !world.isOver; i++) {
      world.submitGuess(wrongGuess);
    }
  }

  assert.equal(world.lives, 0);
  assert.equal(world.isOver, true);

  const historyBefore = world.history;
  const attemptsBefore = world.attemptsUsed;
  const ignored = world.submitGuess(world.secretCode);
  assert.equal(ignored, null, "ゲームオーバー後はsubmitGuessが無視される");
  assert.equal(world.history, historyBefore);
  assert.equal(world.attemptsUsed, attemptsBefore);
});

test("制限時間切れもライフを減らし、再挑戦ラウンドを生成する(試行回数切れと同じ扱い)", () => {
  const world = new LanternCipherWorld();
  const failed: { level: number; reason: string; livesRemaining: number }[] = [];
  world.onRoundFailed = (event) => failed.push(event);

  const roundTimeBefore = world.roundTimeRemaining;
  world.step(roundTimeBefore + 1);

  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason, "time");
  assert.equal(world.lives, 2);
  assert.equal(world.roundTimeRemaining, roundTimeSecondsForLevel(world.level));
  assert.equal(world.attemptsUsed, 0);
});

test("一時停止中に相当するstep(0)や、ラウンドクリア後のstepは状態を破壊しない", () => {
  const world = new LanternCipherWorld();
  world.step(0);
  assert.equal(world.roundTimeRemaining, roundTimeSecondsForLevel(1));

  world.submitGuess(world.secretCode);
  const remainingAfterClear = world.roundTimeRemaining;
  world.step(0);
  assert.equal(world.roundTimeRemaining, remainingAfterClear);
});

test("スロット数に合わないguessや範囲外の色は無視される(壊れない)", () => {
  const world = new LanternCipherWorld();
  const historyBefore = world.history;
  const attemptsBefore = world.attemptsUsed;

  assert.equal(world.submitGuess(world.secretCode.slice(0, -1)), null, "長さ不足は無視される");
  assert.equal(world.submitGuess([...world.secretCode, 0]), null, "長さ過多は無視される");
  assert.equal(
    world.submitGuess(world.secretCode.map(() => world.colorCount)),
    null,
    "範囲外の色は無視される",
  );
  assert.equal(world.history, historyBefore);
  assert.equal(world.attemptsUsed, attemptsBefore);
});

test("roundIdはラウンドが切り替わるたび(クリア/失敗/リセット)に増える", () => {
  const world = new LanternCipherWorld();
  const initialRoundId = world.roundId;

  world.submitGuess(world.secretCode);
  assert.ok(world.roundId > initialRoundId, "クリアでroundIdが増える");
  const afterClearRoundId = world.roundId;

  const wrongGuess = wrongGuessFor(world.secretCode, world.colorCount);
  for (let i = 0; i < world.maxAttempts; i++) world.submitGuess(wrongGuess);
  assert.ok(world.roundId > afterClearRoundId, "失敗でもroundIdが増える");
  const afterFailRoundId = world.roundId;

  world.reset();
  assert.ok(world.roundId > afterFailRoundId, "resetでもroundIdが増える");
});

test("reset()で進行状況をすべて初期化できる", () => {
  const world = new LanternCipherWorld();
  world.submitGuess(world.secretCode);
  world.submitGuess(world.secretCode);
  assert.ok(world.level > 1);
  assert.ok(world.score > 0);

  world.reset();

  assert.equal(world.level, 1);
  assert.equal(world.score, 0);
  assert.equal(world.lives, 3);
  assert.equal(world.isOver, false);
  assert.equal(world.attemptsUsed, 0);
  assert.deepEqual(world.history, []);
  assert.equal(world.slotCount, slotCountForLevel(1));
});
