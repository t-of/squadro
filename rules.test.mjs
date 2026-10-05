// 自己チェック（ブラウザもビルドも使わない）。実行: node rules.test.mjs
import assert from 'node:assert/strict';
import rules from './rules.js';

const { createInitialState, legalMoves, applyMove, cellOf } = rules;

// 初期状態: A の手番、5 駒とも未発進
{
  const s = createInitialState();
  assert.equal(s.turn, 'a');
  assert.deepEqual(legalMoves(s), [0, 1, 2, 3, 4]);
}

// 速さどおりに進む（lane1 は行き速さ3）
{
  const s = createInitialState();
  const s1 = applyMove(s, 1);
  assert.equal(s1.a[1], 3);
  assert.equal(s1.turn, 'b');
}

// 向こうの縁に着いたら、歩数が残っていても止まる
{
  let s = createInitialState();
  s = applyMove(s, 1); // a lane1: 0->3
  s.turn = 'a';
  s = applyMove(s, 1); // 3->6（速さ3で届くのでちょうど）
  assert.equal(s.a[1], 6);
  s.turn = 'a';
  s = applyMove(s, 1); // 帰り: 6 からさらに進む（速さ1） -> 7
  assert.equal(s.a[1], 7);
}

// 跳び越え: B の駒を A の lane 上に置いてぶつける
{
  let s = createInitialState();
  // B lane0 を進めて、A lane0 の行き先(row1,col1) に来るようにする。
  // B lane0 は col1 固定。row1 になるのは p=5 のとき（row=6-p）。
  s.turn = 'b';
  // b lane0 の速さ: FWD[0]=1 なので 5 回動かす
  for (let i = 0; i < 5; i++) { s = applyMove(s, 0); s.turn = 'b'; }
  assert.deepEqual(cellOf('b', 0, s.b[0]), { row: 1, col: 1 });

  s.turn = 'a';
  // a lane0 の速さ: FWD[0]=1。0 -> 1 で (row1,col1) にいる b とぶつかる。
  const before = s.b[0];
  assert.equal(before, 5); // 行きの途中（出発の縁へ戻される）
  const after = applyMove(s, 0);
  // a は b を跳び越えて、その次の空きマス(col2)に止まる
  assert.equal(after.a[0], 2);
  // 跳び越えられた b は出発の縁(0)へ戻る
  assert.equal(after.b[0], 0);
}

// 勝ち判定: 4 駒を上がらせたら勝ち
{
  let s = createInitialState();
  s.a = [12, 12, 12, 0, 0];
  s.turn = 'a';
  // lane3 を上がりまで進める（0->1(fwd1)->...面倒なので直接 p=6 にして帰りを 1 手で進める想定ではなく、
  // 実際に applyMove を使って最後の 1 手で 12 に届くことだけ確かめる）
  s.a[3] = 11; // 帰りの終わり手前（lane3 の RET 速さは3なので 11->12 まで届く）
  const r = applyMove(s, 3);
  assert.equal(r.a[3], 12);
  assert.equal(r.winner, 'a');
}

console.log('rules.test.mjs: OK');
