import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
// ルール（進める・跳び越える・勝敗判定）は rules.js にまとめてある。ここは盤の表示（three.js の木の盤）と入力だけ。

const startEl = document.getElementById('start');
const gameEl = document.getElementById('game');
const resultEl = document.getElementById('result');
const board3dEl = document.getElementById('board3d');
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
  board3dEl.appendChild(canvas);
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

// ---- 3D の木の盤（three.js）。ドラッグで回す、ピンチで寄る ----
// 盤は 7x7。内側 5x5 が交差点（溝）、外周の縁に速さの数字を刻む。四隅は無地。
const CELL = 0.686; // 7 マス で合計 4.8（quarto と同じ大きさ）
const cellPos = (row, col) => ({ x: (col - 3) * CELL, z: (row - 3) * CELL });

const canvas = document.createElement('canvas');
canvas.className = 'board3d__canvas';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 6, 5.6);
const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // 盤の下にはもぐらない
controls.target.set(0, 0.3, 0);
controls.update();
controls.addEventListener('change', draw);

// 影は付けない。環境光（RoomEnvironment）と弱い向きの光で質感を出す
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2e24, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 8, 4);
scene.add(sun);

// 木目（灰色の濃淡）。色はマテリアルの color で付ける。上下・左右につながるように周期を整数にする
function woodTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = (y + 9 * Math.sin((2 * Math.PI * x) / S * 2) + 3 * Math.sin((2 * Math.PI * x) / S * 7)) / S;
      const ring = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * t * 14), 6);
      const v = 255 * (0.9 - 0.16 * ring + (Math.random() - 0.5) * 0.05);
      const p = (y * S + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
const GRAIN = woodTexture();
const wood = (color, o = {}) => new THREE.MeshPhysicalMaterial({
  color, map: GRAIN, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.7, side: THREE.DoubleSide, ...o,
});

const board = new THREE.Mesh(new RoundedBoxGeometry(CELL * 7 + 0.3, 0.36, CELL * 7 + 0.3, 4, 0.14), wood(0x6a4329, { clearcoat: 0.5 }));
board.position.y = -0.18;
scene.add(board);

// 速さの数字を刻んだ円盤（縁の 20 マス）。背景は木の色に合わせ、数字はクリーム色で焼く
function numberTexture(n) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4a2e1c';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#e8d9bb';
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), S / 2, S / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 盤のマスの飾り：内側 25 マスは交差点の溝、縁 20 マスは数字の円盤、四隅 4 マスは無地のまま
const discGeo = new THREE.CircleGeometry(CELL * 0.42, 40);
const grooveGeo = new THREE.RingGeometry(CELL * 0.42, CELL * 0.47, 40);
const GROOVE = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.9 });
function edgeNumber(row, col) {
  if (col === 0 && row >= 1 && row <= 5) return SquadroRules.FWD[row - 1];
  if (col === 6 && row >= 1 && row <= 5) return SquadroRules.RET[row - 1];
  if (row === 6 && col >= 1 && col <= 5) return SquadroRules.FWD[col - 1];
  if (row === 0 && col >= 1 && col <= 5) return SquadroRules.RET[col - 1];
  return null;
}
for (let row = 0; row < 7; row++) {
  for (let col = 0; col < 7; col++) {
    const isCorner = (row === 0 || row === 6) && (col === 0 || col === 6);
    if (isCorner) continue;
    const n = edgeNumber(row, col);
    const mat = n != null ? wood(0xffffff, { map: numberTexture(n), roughness: 0.6, clearcoat: 0 }) : wood(0x4a2e1c, { roughness: 0.7, clearcoat: 0 });
    const disc = new THREE.Mesh(discGeo, mat);
    disc.rotation.x = -Math.PI / 2;
    const { x, z } = cellPos(row, col);
    disc.position.set(x, 0.004, z);
    scene.add(disc);
    const ring = new THREE.Mesh(grooveGeo, GROOVE);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.003, z);
    scene.add(ring);
  }
}

// コマ：木でできた円盤型。黄は明るい木、赤は赤く染めた木。
// 帰り（折り返したあと）は天面がくぼんで見分けられる
const WOOD = { a: wood(0xead3a8), b: wood(0x8a2e1e) };
const WOOD_IN = { a: wood(0x9c8461, { clearcoat: 0 }), b: wood(0x5a1c12, { clearcoat: 0 }) };
const HOLE_D = 0.1;
const PIECE_H = 0.46;
function pieceGeo(returning) {
  const R = 0.26, b = 0.035, rh = 0.12, e = 0.015, h = PIECE_H;
  const pts = [new THREE.Vector2(0, 0)];
  const arc = (cx, cy, r, a0, a1) => { for (let k = 0; k <= 4; k++) { const a = a0 + ((a1 - a0) * k) / 4; pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } };
  arc(R - b, b, b, -Math.PI / 2, 0);
  arc(R - b, h - b, b, 0, Math.PI / 2);
  if (returning) { arc(rh + e, h - e, e, Math.PI / 2, Math.PI); pts.push(new THREE.Vector2(rh, h - HOLE_D)); }
  else pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, 48);
}
const PIECE_GEO = { fwd: pieceGeo(false), ret: pieceGeo(true) };

function pieceMesh(player, returning) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(returning ? PIECE_GEO.ret : PIECE_GEO.fwd, WOOD[player]));
  if (returning) {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), WOOD_IN[player]);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = PIECE_H - HOLE_D;
    g.add(floor);
  }
  return g;
}

// 動かせるコマの下に出す、薄い金色のリング
const highlightGeo = new THREE.RingGeometry(0.28, 0.34, 40);
const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffd35c, transparent: true, opacity: 0.85 });
function highlightRing() {
  const m = new THREE.Mesh(highlightGeo, highlightMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  return m;
}

let pieceGroup = new THREE.Group();
scene.add(pieceGroup);
function syncScene() {
  scene.remove(pieceGroup);
  pieceGroup = new THREE.Group();
  const legal = isHumanTurn() ? SquadroRules.legalMoves(state) : [];
  for (const player of ['a', 'b']) {
    for (let lane = 0; lane < 5; lane++) {
      const p = state[player][lane];
      const pos = SquadroRules.cellOf(player, lane, p);
      if (!pos) continue; // 上がった駒は盤に出さない
      const { x, z } = cellPos(pos.row, pos.col);
      const m = pieceMesh(player, p >= 6);
      m.position.set(x, 0, z);
      m.traverse((o) => { o.userData.player = player; o.userData.lane = lane; });
      pieceGroup.add(m);
      if (player === state.turn && legal.includes(lane)) {
        const ring = highlightRing();
        ring.position.x = x; ring.position.z = z;
        pieceGroup.add(ring);
      }
    }
  }
  scene.add(pieceGroup);
  draw();
}

function draw() { renderer.render(scene, camera); }
new ResizeObserver(() => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面でも盤の横が切れないように、縦の画角を広げる
  camera.fov = w < h ? (2 * Math.atan(Math.tan((19 * Math.PI) / 180) * (h / w)) * 180) / Math.PI : 38;
  camera.updateProjectionMatrix();
  draw();
}).observe(canvas);

// 動かさずに離したらタップ（ドラッグは回転）
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  downAt = null;
  if (!state || state.winner) return;
  const r = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(pieceGroup.children, true).find((h) => h.object.userData.player != null);
  if (hit) tryMove(hit.object.userData.player, hit.object.userData.lane);
});

// ---- 画面 ----
function render() {
  syncScene();
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

// 遊び方
const helpEl = document.getElementById('help');
document.getElementById('helpBtn').addEventListener('click', () => helpEl.showModal());
document.getElementById('helpClose').addEventListener('click', () => helpEl.close());
