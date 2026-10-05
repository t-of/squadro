'use strict';

// Squadro の強い CPU。rules.js と同じルールを、コピーなしで動かせる配列の上に再実装し、
// 反復深化 + negamax + αβ + 置換表で探索する（メインスレッドまたは ai-worker.js から呼ぶ）。
// ここでの state は rules.js の state（{ a, b, turn: 'a'|'b', winner: null|'a'|'b' }）と同じ形。
//
// 速さのため、探索の内側では state をコピーせず、1 組の配列を指し手ごとに書き換えて
// 終わったら元に戻す（doMove / undoMove）。ロジックは rules.js の applyMove と完全に一致させてある
// （ai.bench.mjs でランダム局面を使って両方の結果が一致することを確かめている）。

const AI_FWD = [1, 3, 2, 3, 1];
const AI_RET = [3, 1, 2, 1, 3];
const WIN = 1000000;

function cellIndex(player, lane, p) {
  if (player === 0) {
    const row = lane + 1;
    let col;
    if (p === 0) col = 0;
    else if (p <= 5) col = p;
    else if (p === 6) col = 6;
    else if (p <= 11) col = 12 - p;
    else return -1;
    return row * 7 + col;
  }
  const col = lane + 1;
  let row;
  if (p === 0) row = 6;
  else if (p <= 5) row = 6 - p;
  else if (p === 6) row = 0;
  else if (p <= 11) row = p - 6;
  else return -1;
  return row * 7 + col;
}

function toFast(state) {
  return {
    a: state.a.slice(),
    b: state.b.slice(),
    turn: state.turn === 'a' ? 0 : 1,
    winner: state.winner == null ? -1 : (state.winner === 'a' ? 0 : 1),
  };
}

function legalMovesFast(fs) {
  const arr = fs.turn === 0 ? fs.a : fs.b;
  const out = [];
  for (let i = 0; i < 5; i++) if (arr[i] !== 12) out.push(i);
  return out;
}

// rules.js の applyMove と同じ手順。fs を直接書き換え、戻すための情報を返す。
function doMove(fs, lane) {
  const player = fs.turn;
  const opp = player ^ 1;
  const self = player === 0 ? fs.a : fs.b;
  const oppArr = opp === 0 ? fs.a : fs.b;
  const p = self[lane];
  const boundary = p < 6 ? 6 : 12;
  const speed = (p < 6 ? AI_FWD : AI_RET)[lane];

  let cur = p;
  let stepsLeft = speed;
  let jumped = false;
  const bumped = [];

  while (cur < boundary) {
    const next = cur + 1;
    const nextCell = cellIndex(player, lane, next);
    let hit = -1;
    for (let j = 0; j < 5; j++) {
      if (oppArr[j] === 12) continue;
      if (cellIndex(opp, j, oppArr[j]) === nextCell) { hit = j; break; }
    }
    if (hit >= 0) {
      bumped.push(hit);
      cur = next;
      jumped = true;
      continue;
    }
    cur = next;
    if (jumped) break;
    stepsLeft -= 1;
    if (stepsLeft <= 0 || cur >= boundary) break;
  }

  self[lane] = cur;
  const bumpedUndo = [];
  for (const j of bumped) {
    bumpedUndo.push({ idx: j, prevVal: oppArr[j] });
    oppArr[j] = oppArr[j] < 6 ? 0 : 6;
  }

  const prevWinner = fs.winner;
  const prevTurn = fs.turn;
  let finished = 0;
  for (let i = 0; i < 5; i++) if (self[i] === 12) finished++;
  fs.winner = finished >= 4 ? player : fs.winner;
  fs.turn = opp;

  return { lane, player, prevSelf: p, bumped: bumpedUndo, prevWinner, prevTurn };
}

function undoMove(fs, u) {
  const opp = u.player ^ 1;
  const self = u.player === 0 ? fs.a : fs.b;
  const oppArr = opp === 0 ? fs.a : fs.b;
  self[u.lane] = u.prevSelf;
  for (const b of u.bumped) oppArr[b.idx] = b.prevVal;
  fs.winner = u.prevWinner;
  fs.turn = u.prevTurn;
}

// 駒 1 つがゴール（p=12）まで必要な手数のおおよその見積もり（速さで割った距離）。
function estRemaining(lane, p) {
  if (p === 12) return 0;
  if (p < 6) return (6 - p) / AI_FWD[lane] + 6 / AI_RET[lane];
  return (12 - p) / AI_RET[lane];
}

// 次の一歩で相手の駒に重なる（跳び越えられる）駒の数。厳密な多重跳びは数えない簡易判定。
function threatCount(fs, who) {
  const arr = who === 0 ? fs.a : fs.b;
  const opp = who ^ 1;
  const oppArr = opp === 0 ? fs.a : fs.b;
  let n = 0;
  for (let lane = 0; lane < 5; lane++) {
    const p = arr[lane];
    if (p === 12) continue;
    const boundary = p < 6 ? 6 : 12;
    if (p >= boundary) continue;
    const nextCell = cellIndex(who, lane, p + 1);
    for (let j = 0; j < 5; j++) {
      if (oppArr[j] !== 12 && cellIndex(opp, j, oppArr[j]) === nextCell) { n++; break; }
    }
  }
  return n;
}

// player から見た静的な評価。進み具合・上がり数・テンポ・跳び越えの脅威を合わせる。
function evaluate(fs, player) {
  const opp = player ^ 1;
  const self = player === 0 ? fs.a : fs.b;
  const oppArr = opp === 0 ? fs.a : fs.b;
  let score = 0;
  let selfFinished = 0;
  let oppFinished = 0;
  for (let i = 0; i < 5; i++) {
    if (self[i] === 12) selfFinished++; else score -= estRemaining(i, self[i]) * 10;
  }
  for (let i = 0; i < 5; i++) {
    if (oppArr[i] === 12) oppFinished++; else score += estRemaining(i, oppArr[i]) * 10;
  }
  score += (selfFinished - oppFinished) * 150;
  if (fs.turn === player) score += 3;
  score += (threatCount(fs, player) - threatCount(fs, opp)) * 8;
  return score;
}

function encodeKey(fs) {
  let k = 0;
  for (let i = 0; i < 5; i++) k = k * 13 + fs.a[i];
  for (let i = 0; i < 5; i++) k = k * 13 + fs.b[i];
  return k * 2 + fs.turn;
}

function orderMoves(fs, moves, ttMove) {
  const player = fs.turn;
  const opp = player ^ 1;
  const arr = player === 0 ? fs.a : fs.b;
  const oppArr = opp === 0 ? fs.a : fs.b;
  const score = (mv) => {
    if (mv === ttMove) return 1000;
    const p = arr[mv];
    const boundary = p < 6 ? 6 : 12;
    if (p >= boundary) return 0;
    const nextCell = cellIndex(player, mv, p + 1);
    for (let j = 0; j < 5; j++) {
      if (oppArr[j] !== 12 && cellIndex(opp, j, oppArr[j]) === nextCell) return 100;
    }
    return 0;
  };
  moves.sort((x, y) => score(y) - score(x));
}

const EXACT = 0, LOWER = 1, UPPER = 2;

function negamax(fs, depthLeft, alpha, beta, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.timeUp = true;
  if (ctx.timeUp) return 0;

  if (fs.winner !== -1) return -(WIN - ctx.ply);

  const origAlpha = alpha;
  const key = encodeKey(fs);
  const tt = ctx.table.get(key);
  if (tt && tt.depth >= depthLeft) {
    if (tt.flag === EXACT) return tt.score;
    if (tt.flag === LOWER && tt.score > alpha) alpha = tt.score;
    else if (tt.flag === UPPER && tt.score < beta) beta = tt.score;
    if (alpha >= beta) return tt.score;
  }

  if (depthLeft === 0) return evaluate(fs, fs.turn);

  const moves = legalMovesFast(fs);
  orderMoves(fs, moves, tt && tt.move);

  let best = -Infinity;
  let bestMove = moves[0];
  ctx.ply++;
  for (const mv of moves) {
    const undo = doMove(fs, mv);
    const score = -negamax(fs, depthLeft - 1, -beta, -alpha, ctx);
    undoMove(fs, undo);
    if (ctx.timeUp) { ctx.ply--; return 0; }
    if (score > best) { best = score; bestMove = mv; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  ctx.ply--;

  const flag = best <= origAlpha ? UPPER : (best >= beta ? LOWER : EXACT);
  ctx.table.set(key, { depth: depthLeft, score: best, flag, move: bestMove });
  return best;
}

// opts.depth: 固定の深さまで（置換表は使うが時間制限はゆるい後ろ盾）。
// opts.timeMs: 時間いっぱい反復深化（既定 1500ms）。どちらも指定がなければ時間制限を使う。
function search(state, opts) {
  opts = opts || {};
  const fs = toFast(state);
  const moves = legalMovesFast(fs);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const timeMs = opts.timeMs || (opts.depth ? 5000 : 1500);
  const maxDepth = opts.depth || 64;
  const deadline = Date.now() + timeMs;
  const table = new Map();

  let bestMove = moves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const ctx = { nodes: 0, deadline, timeUp: false, table, ply: 0 };
    let alpha = -Infinity;
    const beta = Infinity;
    const ms = moves.slice();
    orderMoves(fs, ms, bestMove);
    let localBest = null;
    let localScore = -Infinity;
    for (const mv of ms) {
      const undo = doMove(fs, mv);
      const score = -negamax(fs, depth - 1, -beta, -alpha, ctx);
      undoMove(fs, undo);
      if (ctx.timeUp) break;
      if (score > localScore) { localScore = score; localBest = mv; }
      if (score > alpha) alpha = score;
    }
    if (localBest !== null) bestMove = localBest;
    if (ctx.timeUp) break;
    if (Date.now() >= deadline) break;
  }
  return bestMove;
}

const aiApi = { FWD: AI_FWD, RET: AI_RET, search, cellIndex, toFast, doMove, undoMove, legalMovesFast, evaluate, encodeKey };

if (typeof module !== 'undefined' && module.exports) module.exports = aiApi;
else if (typeof self !== 'undefined') self.SquadroAI = aiApi;
