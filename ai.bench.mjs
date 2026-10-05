// 強さと正しさの確認（node のみ、ビルド不要）。実行: node ai.bench.mjs
// 数十秒で終わる想定（最強の持ち時間を短めにして試合数をこなす）。
import assert from 'node:assert/strict';
import rules from './rules.js';
import ai from './ai.js';

function other(p) { return p === 'a' ? 'b' : 'a'; }

// --- 1. ランダム局面で、ai.js の高速な指し手/戻しが rules.applyMove と一致するか ---
{
  let state = rules.createInitialState();
  let checked = 0;
  for (let i = 0; i < 4000 && !state.winner; i++) {
    const moves = rules.legalMoves(state);
    const lane = moves[Math.floor(Math.random() * moves.length)];

    const fs = ai.toFast(state);
    const undo = ai.doMove(fs, lane);
    const expected = rules.applyMove(state, lane);

    assert.deepEqual(Array.from(fs.a), expected.a, `a 不一致 (手${i})`);
    assert.deepEqual(Array.from(fs.b), expected.b, `b 不一致 (手${i})`);
    assert.equal(fs.turn, expected.turn === 'a' ? 0 : 1, `turn 不一致 (手${i})`);
    assert.equal(fs.winner, expected.winner == null ? -1 : (expected.winner === 'a' ? 0 : 1), `winner 不一致 (手${i})`);
    checked++;

    // 戻して、元の局面に戻ることも確かめる
    const before = ai.toFast(state);
    ai.undoMove(fs, undo);
    assert.deepEqual(fs, before, `undo が元に戻らない (手${i})`);

    state = expected;
    if (state.winner) state = rules.createInitialState(); // 勝負がついたら最初から（局面のバリエーションを増やす）
  }
  console.log(`一致チェック: ${checked} 手すべて rules.applyMove と一致`);
}

// --- 2. 対局させて勝敗を数える ---
function playGame(levelA, levelB, firstMover) {
  let state = rules.createInitialState();
  state.turn = firstMover;
  const levelOf = { a: levelA, b: levelB };
  let moves = 0;
  while (!state.winner && moves < 300) {
    const level = levelOf[state.turn];
    const lane = level === 'weak' ? rules.chooseMove(state) : ai.search(state, level === 'normal' ? { depth: 3 } : { timeMs: 50 });
    state = rules.applyMove(state, lane);
    moves++;
  }
  return state.winner; // 'a' | 'b' | null(引き分け扱い=到達せず)
}

function matchup(name, levelMax, levelOther, games) {
  let maxWins = 0, otherWins = 0;
  for (let i = 0; i < games; i++) {
    // 先手を交互に: 最強が a のとき levelMax=a、交互に入れ替える
    const maxIsA = i % 2 === 0;
    const winner = maxIsA ? playGame(levelMax, levelOther, 'a') : playGame(levelOther, levelMax, 'a');
    const maxWon = maxIsA ? winner === 'a' : winner === 'b';
    if (maxWon) maxWins++; else otherWins++;
  }
  console.log(`${name}: 最強 ${maxWins} 勝 / ${otherWins} 敗 (全 ${games} 局、先後交互)`);
  return { maxWins, otherWins, games };
}

// 最強(短い持ち時間) 対 よわい・ふつう。ほぼ全勝することを確かめる。
const r1 = matchup('最強 vs よわい', 'max', 'weak', 14);
assert.ok(r1.maxWins >= 12, '最強はよわいにほぼ全勝するはず');

const r2 = matchup('最強 vs ふつう', 'max', 'normal', 14);
assert.ok(r2.maxWins >= 10, '最強はふつうに大きく勝ち越すはず');

console.log('ai.bench.mjs: OK');
