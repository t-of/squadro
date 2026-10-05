'use strict';

// Squadro のルールだけを持つ純粋な関数群。DOM に触らない。state はいつもコピーして返す。
//
// 盤は 7x7（行 0..6・列 0..6）。内側 5x5（1..5）が交差点。
// A（黄）は 5 つの行（lane 0..4 → row lane+1）を左 → 右 → 左へ往復する。
// B（赤）は 5 つの列（lane 0..4 → col lane+1）を下 → 上 → 下へ往復する。
//
// 各駒の進み具合は p で持つ（0..12）。
//   0      : 出発の縁（まだ動いていない）
//   1..5   : 行きの途中（交差点の位置そのもの）
//   6      : 折り返しの縁
//   7..11  : 帰りの途中（交差点の位置は 12-p）
//   12     : 上がり（盤から外れる）
const FWD = [1, 3, 2, 3, 1]; // 行きの速さ（lane 0..4）
const RET = [3, 1, 2, 1, 3]; // 帰りの速さ（lane 0..4）

function other(player) { return player === 'a' ? 'b' : 'a'; }

function cloneState(state) {
  return { a: state.a.slice(), b: state.b.slice(), turn: state.turn, winner: state.winner };
}

// p から見た盤の位置（行・列）。上がった駒（p===12）は null。
function cellOf(player, lane, p) {
  if (player === 'a') {
    const row = lane + 1;
    let col;
    if (p === 0) col = 0;
    else if (p >= 1 && p <= 5) col = p;
    else if (p === 6) col = 6;
    else if (p >= 7 && p <= 11) col = 12 - p;
    else return null; // p === 12
    return { row, col };
  }
  const col = lane + 1;
  let row;
  if (p === 0) row = 6;
  else if (p >= 1 && p <= 5) row = 6 - p;
  else if (p === 6) row = 0;
  else if (p >= 7 && p <= 11) row = p - 6;
  else return null; // p === 12
  return { row, col };
}

function createInitialState() {
  return { a: [0, 0, 0, 0, 0], b: [0, 0, 0, 0, 0], turn: 'a', winner: null };
}

// 今の手番で動かせる駒（上がっていないもの）の lane 一覧。
function legalMoves(state) {
  if (state.winner) return [];
  const arr = state[state.turn];
  const out = [];
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 12) out.push(i);
  return out;
}

function speedFor(lane, p) { return p < 6 ? FWD[lane] : RET[lane]; }

// 駒 lane を 1 手進める。跳び越え・縁で止まる・上がり判定をすべて行い、新しい state を返す。
function applyMove(state, lane) {
  if (state.winner) return cloneState(state);
  const player = state.turn;
  const opp = other(player);
  const ns = cloneState(state);
  const p = ns[player][lane];
  const boundary = p < 6 ? 6 : 12;
  const speed = speedFor(lane, p);

  let cur = p;
  let stepsLeft = speed;
  let jumped = false; // 一度でも跳び越えたら、次の空きマスで即停止する
  const bumped = [];

  while (cur < boundary) {
    const next = cur + 1;
    const nextCell = cellOf(player, lane, next);
    let hit = -1;
    for (let j = 0; j < ns[opp].length; j++) {
      const oc = cellOf(opp, j, ns[opp][j]);
      if (oc && nextCell && oc.row === nextCell.row && oc.col === nextCell.col) { hit = j; break; }
    }
    if (hit >= 0) {
      bumped.push(hit);
      cur = next;
      jumped = true;
      continue;
    }
    cur = next;
    if (jumped) break; // 跳び越え直後の空きマスに止まる（残り歩数は捨てる）
    stepsLeft -= 1;
    if (stepsLeft <= 0 || cur >= boundary) break;
  }

  ns[player][lane] = cur;
  for (const j of bumped) {
    ns[opp][j] = ns[opp][j] < 6 ? 0 : 6; // 行きの途中なら出発の縁へ、帰りの途中なら折り返しの縁へ
  }

  if (ns[player].filter((v) => v === 12).length >= 4) ns.winner = player;
  ns.turn = opp;
  return ns;
}

// 1 手読みの簡単な CPU。自分の進み具合の合計から相手の進み具合の合計を引いた値が
// 一番大きくなる手を選ぶ（跳び越えで相手を戻す手は自然に高く評価される）。
function evaluate(state, player) {
  const sum = (arr) => arr.reduce((s, p) => s + p / 12, 0);
  return sum(state[player]) - sum(state[other(player)]);
}

function chooseMove(state) {
  const player = state.turn;
  const moves = legalMoves(state);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const lane of moves) {
    const score = evaluate(applyMove(state, lane), player);
    if (score > bestScore) { bestScore = score; best = lane; }
  }
  return best;
}

const api = { FWD, RET, createInitialState, legalMoves, applyMove, chooseMove, cellOf, other };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.SquadroRules = api;
