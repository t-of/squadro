'use strict';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'squadro.' で始める。
const STORE = 'squadro.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'squadro', text: '行きと帰りで速さが違う5つのコマを操り、先に4つ上がらせたら勝ちの盤ゲーム。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----
// ルール（進める・跳び越える・勝敗判定）は rules.js にまとめてある。ここは盤の表示と入力だけ。

const stageEl = document.getElementById('stage');
const startEl = document.getElementById('start');
const gameEl = document.getElementById('game');
const resultEl = document.getElementById('result');
const boardEl = document.getElementById('board');
const turnLabelEl = document.getElementById('turnLabel');
const scoreAEl = document.getElementById('scoreA');
const scoreBEl = document.getElementById('scoreB');
const resultTextEl = document.getElementById('resultText');

let state = null;
let mode = 'pvp';     // 'pvp' | 'cpu'
let cpuPlayer = null; // mode === 'cpu' のとき、CPU が持つ側 'a' | 'b'
let strength = load('strength', 'max'); // 'weak' | 'normal' | 'max'
let thinking = false;

for (const r of document.querySelectorAll('input[name="strength"]')) {
  r.checked = r.value === strength;
  r.addEventListener('change', () => { if (r.checked) { strength = r.value; save('strength', strength); } });
}

// CPU の探索は Web Worker（ai-worker.js）で行い、画面を固めない。
// Worker が使えない・応答しないときは、保険としてメインスレッドで浅い探索にする。
let aiWorker = null;
function getAiWorker() {
  if (aiWorker !== null) return aiWorker;
  try { aiWorker = new Worker('./ai-worker.js'); } catch { aiWorker = false; }
  return aiWorker;
}

function requestCpuMove(s, level) {
  if (level === 'weak') return Promise.resolve(SquadroRules.chooseMove(s));
  const opts = level === 'normal' ? { depth: 3 } : { timeMs: 1500 };
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => { if (!done) { done = true; resolve(SquadroAI.search(s, { depth: 2 })); } };
    const w = getAiWorker();
    if (!w) { fallback(); return; }
    const timer = setTimeout(fallback, (opts.timeMs || 3000) + 1500);
    w.onmessage = (e) => { if (!done) { done = true; clearTimeout(timer); resolve(e.data.lane); } };
    w.onerror = () => { clearTimeout(timer); fallback(); };
    w.postMessage({ state: s, opts });
  });
}

function startGame(kind) {
  state = SquadroRules.createInitialState();
  if (kind === 'pvp') { mode = 'pvp'; cpuPlayer = null; }
  else { mode = 'cpu'; cpuPlayer = kind === 'cpu-a' ? 'b' : 'a'; }
  startEl.hidden = true;
  gameEl.hidden = false;
  resultEl.hidden = true;
  render();
  maybeCpuTurn();
}

function isHumanTurn() { return mode === 'pvp' || state.turn !== cpuPlayer; }

async function maybeCpuTurn() {
  if (state.winner || isHumanTurn()) return;
  thinking = true;
  render();
  const lane = await requestCpuMove(state, strength);
  thinking = false;
  state = SquadroRules.applyMove(state, lane);
  render();
  if (!state.winner) maybeCpuTurn();
}

function tryMove(player, lane) {
  if (state.winner || thinking || !isHumanTurn() || player !== state.turn) return;
  if (!SquadroRules.legalMoves(state).includes(lane)) return;
  state = SquadroRules.applyMove(state, lane);
  render();
  maybeCpuTurn();
}

function render() {
  boardEl.innerHTML = '';
  const cells = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (r >= 1 && r <= 5 && c >= 1 && c <= 5) cell.classList.add('inner');
      if (c === 0 && r >= 1 && r <= 5) { cell.classList.add('edge'); cell.textContent = SquadroRules.FWD[r - 1]; }
      if (c === 6 && r >= 1 && r <= 5) { cell.classList.add('edge'); cell.textContent = SquadroRules.RET[r - 1]; }
      if (r === 6 && c >= 1 && c <= 5) { cell.classList.add('edge'); cell.textContent = SquadroRules.FWD[c - 1]; }
      if (r === 0 && c >= 1 && c <= 5) { cell.classList.add('edge'); cell.textContent = SquadroRules.RET[c - 1]; }
      boardEl.appendChild(cell);
      cells.push(cell);
    }
  }

  const legal = isHumanTurn() ? SquadroRules.legalMoves(state) : [];
  for (const player of ['a', 'b']) {
    for (let lane = 0; lane < 5; lane++) {
      const p = state[player][lane];
      const pos = SquadroRules.cellOf(player, lane, p);
      if (!pos) continue; // 上がった駒は盤に出さない
      const cell = cells[pos.row * 7 + pos.col];
      const piece = document.createElement('button');
      piece.className = `piece piece--${player}`;
      piece.type = 'button';
      if (player === state.turn && legal.includes(lane)) piece.classList.add('movable');
      piece.addEventListener('click', () => tryMove(player, lane));
      cell.appendChild(piece);
    }
  }

  scoreAEl.textContent = state.a.filter((v) => v === 12).length;
  scoreBEl.textContent = state.b.filter((v) => v === 12).length;
  turnLabelEl.textContent = thinking ? '考え中…' : (state.turn === 'a' ? '黄の番' : '赤の番');

  if (state.winner) {
    resultTextEl.textContent = state.winner === 'a' ? '黄の勝ち' : '赤の勝ち';
    resultEl.hidden = false;
  }
}

for (const btn of document.querySelectorAll('[data-start]')) {
  btn.addEventListener('click', () => startGame(btn.dataset.start));
}
document.getElementById('againBtn').addEventListener('click', () => startGame(mode === 'cpu' ? (cpuPlayer === 'a' ? 'cpu-b' : 'cpu-a') : 'pvp'));
document.getElementById('titleBtn').addEventListener('click', () => {
  resultEl.hidden = true;
  gameEl.hidden = true;
  startEl.hidden = false;
});
