// 동전 합치기 (Coin Merge) — 우성오락실
// 같은 동전끼리 닿으면 합쳐진다. 10원에서 10만 원 수표까지.
// YouTube Playables 인증 요건에 맞춤: SDK 먼저 로드, firstFrameReady/gameReady,
// onPause/onResume 로만 일시정지, 유튜브 음소거 따름, saveData/loadData 클라우드 저장,
// 모든 화면비 대응, 터치·마우스·키보드 조작, 외부 링크 없음.
"use strict";

// ───────────── 유튜브 SDK (밖에서 열면 localStorage 로 대체) ─────────────
const YT = (typeof ytgame !== "undefined") ? ytgame : null;
const IN_YT = !!(YT && YT.IN_PLAYABLES_ENV);
const SAVE_KEY = "woosung-coin-merge-v1";

const sdk = {
  firstFrameReady() { try { YT && YT.game.firstFrameReady(); } catch (e) {} },
  gameReady() { try { YT && YT.game.gameReady(); } catch (e) {} },
  async load() {
    if (IN_YT) { try { return await YT.game.loadData(); } catch (e) { return ""; } }
    try { return localStorage.getItem(SAVE_KEY) || ""; } catch (e) { return ""; }
  },
  async save(str) {
    if (IN_YT) { try { await YT.game.saveData(str); } catch (e) {} return; }
    try { localStorage.setItem(SAVE_KEY, str); } catch (e) {}
  },
  score(v) { if (IN_YT) { try { YT.engagement.sendScore({ value: Math.floor(v) }); } catch (e) {} } },
  audioOn() { if (IN_YT) { try { return YT.system.isAudioEnabled(); } catch (e) {} } return true; },
  async lang() { if (IN_YT) { try { return await YT.system.getLanguage(); } catch (e) {} } return navigator.language || "ko"; },
  interstitial() { if (IN_YT) { try { return YT.ads.requestInterstitialAd(); } catch (e) {} } return Promise.resolve(); },
};

// ───────────── 동전 단계 ─────────────
// r: 반지름(세계 단위), 화폐 느낌의 색. 지폐 단계는 둥근 '패' 로 표현.
const TIERS = [
  { v: 10,     r: 5.2,  c1: "#f0a868", c2: "#b5652a", ink: "#5a2c0c" },
  { v: 50,     r: 6.8,  c1: "#f4f6f8", c2: "#a9b1bb", ink: "#3e4650" },
  { v: 100,    r: 8.4,  c1: "#e8ecf0", c2: "#8e98a4", ink: "#323a44" },
  { v: 500,    r: 10.4, c1: "#fff3c4", c2: "#c9a43c", ink: "#5a4210" },
  { v: 1000,   r: 12.8, c1: "#a8d4ff", c2: "#3f7fc6", ink: "#10304f" },
  { v: 5000,   r: 15.4, c1: "#ffc29a", c2: "#d4683a", ink: "#5a2410" },
  { v: 10000,  r: 18.4, c1: "#b6f0b0", c2: "#3f9e4c", ink: "#123f18" },
  { v: 50000,  r: 21.6, c1: "#ffe08a", c2: "#d39a1c", ink: "#5a3c00" },
  { v: 100000, r: 25.0, c1: "#ffd6ef", c2: "#e05aa8", ink: "#5a0f3c" },
];
const MAX_TIER = TIERS.length - 1;
// 캐릭터 그림 (AI 생성). 그림 한 변 = 동전 반지름 × 2 × SPRITE_PAD (머리 장식·날개 여백)
const SPRITE_PAD = 1.8;
const IMG = TIERS.map((_, i) => { const im = new Image(); im.src = `img/coin${i}.png`; return im; });
const DROP_TIERS = 4;                         // 떨어뜨리는 건 10~500원만
const POINTS = [1, 3, 6, 10, 15, 21, 28, 36, 45];

// ───────────── 세계(좌표계) ─────────────
// 통 안쪽: x 0..100, y 0..140. 위 22 단위는 조준/HUD 공간.
const BOX_W = 100, BOX_H = 140, TOP = 26;
const DANGER_Y = 16;                          // 통 안쪽 기준 이 선 위로 넘치면 위험
const G = 260;                                // 중력 (단위/초²)

// ───────────── 문구 ─────────────
const TEXT = {
  ko: { title: "동전 합치기", best: "최고", next: "다음", over: "게임 오버", again: "다시 하기",
        score: "점수", hint: "끌어서 위치를 정하고 손을 떼면 떨어져요", top: "10만 원 수표 완성! 최고 단계예요",
        won: "원", coll: "모은 동전" },
  en: { title: "Coin Merge", best: "BEST", next: "NEXT", over: "GAME OVER", again: "Play again",
        score: "SCORE", hint: "Drag to aim, release to drop", top: "₩100,000 cheque! Top tier reached",
        won: "", coll: "Collection" },
};
let T = TEXT.ko;

// ───────────── 상태 ─────────────
const st = {
  coins: [], score: 0, best: 0, discovered: [0],
  next: 0, after: 0, aimX: 50, canDrop: true, dropTimer: 0,
  over: false, paused: false, dangerTime: 0, banner: null, bannerT: 0,
  games: 0, ready: false, lastSave: 0, dirty: false, pops: [], sparks: [], floats: [],
};
let idSeq = 1;

function randTier() { return Math.floor(Math.random() * DROP_TIERS * 0.999 * (Math.random() < 0.6 ? 0.6 : 1)); }

function newGame() {
  st.coins = []; st.score = 0; st.over = false; st.dangerTime = 0; st.pops = []; st.sparks = []; st.floats = [];
  st.next = randTier(); st.after = randTier(); st.canDrop = true;
  st.dirty = true;
}

function makeCoin(x, y, tier, vx = 0, vy = 0) {
  return { id: idSeq++, x, y, px: x - vx, py: y - vy, r: TIERS[tier].r, tier, age: 0, pop: 0, gone: false };
}

// ───────────── 저장 ─────────────
function serialize() {
  return JSON.stringify({
    v: 1, best: st.best, discovered: st.discovered, games: st.games,
    cur: st.over ? null : {
      score: st.score, next: st.next, after: st.after,
      coins: st.coins.map(c => [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, c.tier]),
    },
  });
}

async function saveNow() {
  st.dirty = false; st.lastSave = performance.now();
  await sdk.save(serialize());
}

function maybeSave(force) {
  if (!st.ready) return;                          // loadData 끝나기 전엔 저장 금지 (요건)
  if (force || (st.dirty && performance.now() - st.lastSave > 3000)) saveNow();
}

async function loadSave() {
  newGame();
  const raw = await sdk.load();
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    st.best = d.best || 0;
    st.discovered = Array.isArray(d.discovered) && d.discovered.length ? d.discovered : [0];
    st.games = d.games || 0;
    if (d.cur && Array.isArray(d.cur.coins)) {       // 하던 판 그대로 이어서
      st.score = d.cur.score || 0;
      st.next = d.cur.next || 0; st.after = d.cur.after || 0;
      st.coins = d.cur.coins
        .filter(a => Array.isArray(a) && TIERS[a[2]])
        .map(([x, y, t]) => { const c = makeCoin(x, y, t); c.age = 5; return c; });
    }
  } catch (e) { /* 깨진 저장은 새 게임으로 */ }
}

// ───────────── 소리 (칩튠 효과음 — 파일 없이 합성) ─────────────
let actx = null, master = null, audioEnabled = true;
function ensureAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = audioEnabled ? 0.35 : 0; master.connect(actx.destination);
  } catch (e) { actx = null; }
}
function setAudio(on) {
  audioEnabled = on;
  if (master) master.gain.value = on ? 0.35 : 0;
}
function beep(freq, dur = 0.08, type = "square", vol = 0.5, slide = 0) {
  if (!actx || !audioEnabled || st.paused) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  drop() { beep(520, 0.06, "square", 0.25, 0.7); },
  merge(tier) { const f = 330 * Math.pow(1.19, tier); beep(f, 0.09, "square", 0.35); setTimeout(() => beep(f * 1.5, 0.12, "triangle", 0.3), 60); },
  top() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, "square", 0.3), i * 110)); },
  over() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => beep(f, 0.18, "triangle", 0.35), i * 150)); },
};

// ───────────── 물리 (베를레 적분 + 위치 보정) ─────────────
function step(dt) {
  const cs = st.coins;
  for (const c of cs) {
    const vx = (c.x - c.px) * 0.995, vy = (c.y - c.py) * 0.995;
    c.px = c.x; c.py = c.y;
    c.x += vx; c.y += vy + G * dt * dt;
    c.age += dt;
    if (c.pop > 0) c.pop = Math.max(0, c.pop - dt * 4);
  }
  const merges = [];
  for (let it = 0; it < 6; it++) {
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]; if (a.gone) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]; if (b.gone) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        if (a.tier === b.tier && !a.gone && !b.gone) {           // 같은 동전 → 합치기
          a.gone = b.gone = true; merges.push([a, b]); break;     // a 는 이제 없다
        }
        const d = Math.sqrt(d2), over = (rr - d) / d;
        const ma = a.r * a.r, mb = b.r * b.r, k = 0.5 * over;
        const fa = mb / (ma + mb), fb = ma / (ma + mb);
        a.x -= dx * k * fa * 2; a.y -= dy * k * fa * 2;
        b.x += dx * k * fb * 2; b.y += dy * k * fb * 2;
      }
    }
    for (const c of cs) {                                         // 벽과 바닥
      if (c.x < c.r) { c.x = c.r; c.px = c.x + (c.x - c.px) * 0.2; }
      if (c.x > BOX_W - c.r) { c.x = BOX_W - c.r; c.px = c.x + (c.x - c.px) * 0.2; }
      if (c.y > BOX_H - c.r) { c.y = BOX_H - c.r; c.px += (c.x - c.px) * 0.3; }
    }
  }
  if (merges.length) {
    for (const [a, b] of merges) doMerge(a, b);
    st.coins = cs.filter(c => !c.gone);
  }
}

function doMerge(a, b) {
  const t = a.tier, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  st.pops.push({ x, y, r: TIERS[t].r * 1.6, life: 1, color: TIERS[Math.min(t + 1, MAX_TIER)].c1 });
  if (t === MAX_TIER) {                                         // 수표 두 장 → 대박 보너스, 사라짐
    st.score += 200; sfx.top(); showBanner(T.top); st.dirty = true; return;
  }
  burst(x, y, t + 1);
  const n = makeCoin(x, y, t + 1); n.pop = 1; n.age = 1;
  st.coins.push(n);
  st.score += POINTS[t + 1];
  if (!st.discovered.includes(t + 1)) {
    st.discovered.push(t + 1);
    if (t + 1 === MAX_TIER) { sfx.top(); showBanner(T.top); }
  }
  sfx.merge(t + 1);
  st.dirty = true;
}

function burst(x, y, t) {
  const n = 8 + t * 2, col = TIERS[t].c1;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 30 + t * 4;
    st.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 15, life: 1, size: 1.2 + Math.random() * 1.6, col });
  }
  st.floats.push({ x, y: y - TIERS[t].r, text: "+" + POINTS[t], life: 1, col });
}

function showBanner(text) { st.banner = text; st.bannerT = 2.6; }

// ───────────── 떨어뜨리기 ─────────────
function drop() {
  if (st.over || st.paused || !st.ready || !st.canDrop) return;
  ensureAudio();
  const r = TIERS[st.next].r;
  const x = Math.min(BOX_W - r, Math.max(r, st.aimX));
  st.coins.push(makeCoin(x, -r - 2, st.next, 0, 0.6));
  st.next = st.after; st.after = randTier();
  st.canDrop = false; st.dropTimer = 0.45;
  sfx.drop();
  st.dirty = true;
}

function checkOver(dt) {
  const high = st.coins.some(c => c.age > 1.2 && c.y - c.r < DANGER_Y);
  st.dangerTime = high ? st.dangerTime + dt : Math.max(0, st.dangerTime - dt * 2);
  if (st.dangerTime > 2.2 && !st.over) {
    st.over = true; st.games++;
    if (st.score > st.best) st.best = st.score;
    sdk.score(st.best);
    sfx.over();
    maybeSave(true);
  }
}

async function restart() {
  if (st.games > 0 && st.games % 3 === 0) {                    // 세 판마다 전면 광고 (유튜브 안에서만)
    st.paused = true;
    try { await sdk.interstitial(); } catch (e) {}
    st.paused = false;
  }
  newGame(); maybeSave(true);
}

// ───────────── 화면 맞춤 (9:32 ~ 32:9 어떤 비율도) ─────────────
const cv = document.getElementById("c");
const cx = cv.getContext("2d");
let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, wide: false };

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = cv.clientWidth || window.innerWidth, h = cv.clientHeight || window.innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  view.dpr = dpr; view.w = w; view.h = h;
  view.wide = w / h > 1.25;                    // 가로 화면: 점수판을 통 옆으로
  const worldW = view.wide ? BOX_W + 90 : BOX_W + 12;
  const worldH = view.wide ? BOX_H + TOP + 10 : BOX_H + TOP + 40;
  view.s = Math.min(w / worldW, h / worldH);
  const boxPx = BOX_W * view.s;
  view.ox = view.wide ? (w - (BOX_W + 90) * view.s) / 2 + 6 * view.s : (w - boxPx) / 2;
  view.oy = (h - worldH * view.s) / 2 + (view.wide ? TOP : TOP + 30) * view.s;
}
window.addEventListener("resize", layout);

function toWorldX(px) { return (px - cv.getBoundingClientRect().left - view.ox) / view.s; }

// ───────────── 입력 ─────────────
let dragging = false;
cv.addEventListener("pointerdown", e => {
  ensureAudio();
  const rc = cv.getBoundingClientRect();
  if (st.over) { if (hitAgain(e.clientX - rc.left, e.clientY - rc.top)) restart(); return; }
  dragging = true; st.aimX = toWorldX(e.clientX);
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener("pointermove", e => {
  if (dragging || e.pointerType === "mouse") st.aimX = toWorldX(e.clientX);
});
cv.addEventListener("pointerup", e => {
  if (!dragging) return;
  dragging = false; st.aimX = toWorldX(e.clientX); drop();
});
cv.addEventListener("pointercancel", () => { dragging = false; });
window.addEventListener("keydown", e => {
  ensureAudio();
  if (st.over && (e.key === "Enter" || e.key === " ")) { restart(); return; }
  if (e.key === "ArrowLeft" || e.key === "a") st.aimX -= 4;
  else if (e.key === "ArrowRight" || e.key === "d") st.aimX += 4;
  else if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown") { drop(); e.preventDefault(); }
});

let againBtn = null;
function hitAgain(x, y) {
  if (!againBtn) return false;
  return x >= againBtn.x && x <= againBtn.x + againBtn.w && y >= againBtn.y && y <= againBtn.y + againBtn.h;
}

// ───────────── 그리기 ─────────────
function fmt(n) { return n.toLocaleString("en-US"); }
function label(t) {
  const v = TIERS[t].v;
  if (T === TEXT.ko) return v >= 10000 ? (v / 10000) + "만" : v >= 1000 ? (v / 1000) + "천" : String(v);
  return v >= 1000 ? (v / 1000) + "K" : String(v);
}

function drawCoin(x, y, t, scale = 1, alpha = 1, tag = true) {
  const s = view.s, R = TIERS[t].r * s * scale, tier = TIERS[t];
  const X = view.ox + x * s, Y = view.oy + y * s, im = IMG[t];
  cx.save(); cx.globalAlpha = alpha;
  cx.beginPath(); cx.ellipse(X, Y + R * 0.92, R * 0.8, R * 0.18, 0, 0, Math.PI * 2);
  cx.fillStyle = "rgba(0,0,0,.28)"; cx.fill();                       // 바닥 그림자
  if (im.complete && im.naturalWidth) {
    const S = R * 2 * SPRITE_PAD;
    cx.drawImage(im, X - S / 2, Y - S / 2, S, S);
  } else {                                                            // 그림 로딩 전엔 단색 원
    cx.beginPath(); cx.arc(X, Y, R, 0, Math.PI * 2); cx.fillStyle = tier.c2; cx.fill();
  }
  if (tag && R > 7) {                                                 // 금액 이름표
    const txt = label(t), fs = Math.max(8, R * 0.42);
    cx.font = `900 ${Math.round(fs)}px "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;
    const w = cx.measureText(txt).width + fs * 0.9, h = fs * 1.25, ty = Y + R * 0.78;
    cx.fillStyle = "rgba(20,12,45,.82)";
    cx.beginPath(); cx.roundRect(X - w / 2, ty - h / 2, w, h, h / 2); cx.fill();
    cx.lineWidth = Math.max(1, fs * 0.12); cx.strokeStyle = tier.c1; cx.stroke();
    cx.fillStyle = "#fff"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText(txt, X, ty + fs * 0.04);
  }
  cx.restore();
}

function star(x, y, r, col, a) {                    // 반짝이 별 (4갈래)
  cx.save(); cx.globalAlpha = a; cx.fillStyle = col; cx.shadowColor = col; cx.shadowBlur = r * 3;
  cx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r;
    cx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  cx.closePath(); cx.fill(); cx.restore();
}

function neonRect(x, y, w, h, r, color, glow) {
  cx.save();
  cx.shadowColor = color; cx.shadowBlur = glow; cx.strokeStyle = color; cx.lineWidth = Math.max(2, view.s * 1.1);
  cx.beginPath(); cx.roundRect(x, y, w, h, r); cx.stroke();
  cx.restore();
}

function text(str, x, y, size, color, align = "center", weight = 900, glow = 0) {
  cx.save();
  cx.font = `${weight} ${Math.round(size)}px "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;
  cx.textAlign = align; cx.textBaseline = "middle"; cx.fillStyle = color;
  if (glow) { cx.shadowColor = color; cx.shadowBlur = glow; }
  cx.fillText(str, x, y);
  cx.restore();
}

const BOKEH = [
  { x: 0.12, y: 0.18, r: 0.28, c: "rgba(255,64,160,.18)" },
  { x: 0.88, y: 0.25, r: 0.3, c: "rgba(60,230,255,.14)" },
  { x: 0.75, y: 0.85, r: 0.25, c: "rgba(255,214,64,.10)" },
];

function drawBackground() {
  const w = view.w, h = view.h;
  const g = cx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0e0a22"); g.addColorStop(1, "#2a0f45");
  cx.fillStyle = g; cx.fillRect(0, 0, w, h);
  for (const b of BOKEH) {
    const rg = cx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * Math.max(w, h));
    rg.addColorStop(0, b.c); rg.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = rg; cx.fillRect(0, 0, w, h);
  }
  // 바닥 격자 (신스웨이브)
  cx.save(); cx.strokeStyle = "rgba(160,60,200,.28)"; cx.lineWidth = 1;
  const hz = h * 0.72;
  for (let i = -16; i <= 16; i++) { cx.beginPath(); cx.moveTo(w / 2 + i * w * 0.02, hz); cx.lineTo(w / 2 + i * w * 0.14, h); cx.stroke(); }
  for (let y = hz, gap = 6; y < h; y += gap, gap *= 1.35) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(w, y); cx.stroke(); }
  cx.restore();
}

function draw() {
  cx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  drawBackground();
  const s = view.s, bx = view.ox, by = view.oy, bw = BOX_W * s, bh = BOX_H * s;

  // 통
  cx.fillStyle = "rgba(20,14,50,.72)";
  cx.beginPath(); cx.roundRect(bx - s, by - s, bw + 2 * s, bh + 2 * s, 3 * s); cx.fill();
  const glass = cx.createLinearGradient(bx, 0, bx + bw, 0);
  glass.addColorStop(0, "rgba(255,255,255,.07)"); glass.addColorStop(0.12, "rgba(255,255,255,0)");
  glass.addColorStop(0.85, "rgba(255,255,255,0)"); glass.addColorStop(1, "rgba(255,255,255,.05)");
  cx.fillStyle = glass; cx.beginPath(); cx.roundRect(bx - s, by - s, bw + 2 * s, bh + 2 * s, 3 * s); cx.fill();
  neonRect(bx - s, by - s, bw + 2 * s, bh + 2 * s, 3 * s, "#3ce6ff", 18);

  // 위험선
  const danger = st.dangerTime > 0.2;
  cx.save(); cx.setLineDash([3 * s, 2 * s]);
  cx.strokeStyle = danger ? `rgba(255,64,160,${0.5 + 0.5 * Math.sin(performance.now() / 90)})` : "rgba(255,64,160,.35)";
  cx.lineWidth = Math.max(1, s * 0.5); cx.beginPath(); cx.moveTo(bx, by + DANGER_Y * s); cx.lineTo(bx + bw, by + DANGER_Y * s); cx.stroke();
  cx.restore();

  // 조준선 + 다음 동전
  if (!st.over && st.ready) {
    const r = TIERS[st.next].r, ax = Math.min(BOX_W - r, Math.max(r, st.aimX));
    cx.save(); cx.strokeStyle = "rgba(255,255,255,.18)"; cx.lineWidth = Math.max(1, s * 0.4);
    cx.beginPath(); cx.moveTo(bx + ax * s, by - 4 * s); cx.lineTo(bx + ax * s, by + bh); cx.stroke(); cx.restore();
    drawCoin(ax, -r - 4, st.next, 1, st.canDrop ? 1 : 0.45);
  }

  // 동전
  cx.save(); cx.beginPath(); cx.rect(bx - 2 * s, by - 60 * s, bw + 4 * s, bh + 62 * s); cx.clip();
  for (const c of st.coins) drawCoin(c.x, c.y, c.tier, 1 + c.pop * 0.18);
  cx.restore();
  // 합쳐질 때 터지는 빛
  for (const p of st.pops) {
    cx.save(); cx.globalAlpha = p.life * 0.8; cx.strokeStyle = p.color; cx.lineWidth = s * 1.2 * p.life;
    cx.shadowColor = p.color; cx.shadowBlur = 20;
    cx.beginPath(); cx.arc(bx + p.x * s, by + p.y * s, p.r * s * (1.6 - p.life * 0.6), 0, Math.PI * 2); cx.stroke(); cx.restore();
  }

  for (const p of st.sparks) star(bx + p.x * s, by + p.y * s, p.size * s * p.life + 1, p.col, p.life);
  for (const f of st.floats) {
    cx.save(); cx.globalAlpha = Math.min(1, f.life * 1.5);
    text(f.text, bx + f.x * s, by + f.y * s, 5 * s, f.col, "center", 900, 10);
    cx.restore();
  }

  drawHud();

  if (st.banner && st.bannerT > 0) {
    const a = Math.min(1, st.bannerT);
    cx.save(); cx.globalAlpha = a;
    text(st.banner, bx + bw / 2, by + bh * 0.35, Math.min(7 * s, view.w / 18), "#ffd640", "center", 900, 18);
    cx.restore();
  }
  if (st.over) drawOver();
}

function drawHud() {
  const s = view.s, bx = view.ox, by = view.oy, bw = BOX_W * s;
  if (view.wide) {                                           // 가로: 오른쪽 패널
    const px = bx + bw + 10 * s;
    text(T.title, px, by + 4 * s, 7 * s, "#ff40a0", "left", 900, 14);
    text(T.score, px, by + 18 * s, 4 * s, "#3ce6ff", "left", 800);
    text(fmt(st.score), px, by + 27 * s, 9 * s, "#ffffff", "left", 900, 8);
    text(`${T.best} ${fmt(Math.max(st.best, st.score))}`, px, by + 38 * s, 4.2 * s, "#ffd640", "left", 800);
    text(T.next, px, by + 52 * s, 4 * s, "#3ce6ff", "left", 800);
    drawCoinAt(px + 8 * s, by + 64 * s, st.after, 0.9);
    drawCollection(px, by + 82 * s, 5.2, false);
  } else {                                                   // 세로: 위쪽 띠
    const y = by - 24 * s;
    text(fmt(st.score), bx, y, 9 * s, "#ffffff", "left", 900, 8);
    text(`${T.best} ${fmt(Math.max(st.best, st.score))}`, bx, y + 8.5 * s, 3.8 * s, "#ffd640", "left", 800);
    text(T.next, bx + bw - 14 * s, y - 1 * s, 3.4 * s, "#3ce6ff", "center", 800);
    drawCoinAt(bx + bw - 14 * s, y + 7 * s, st.after, 0.7);
    drawCollection(bx, by + BOX_H * s + 8 * s, 4.6, true);
  }
}

function drawCoinAt(pxX, pxY, t, scale) {           // 화면 좌표로 동전 그리기
  drawCoin((pxX - view.ox) / view.s, (pxY - view.oy) / view.s, t, scale);
}

function drawCollection(x, y, size, row) {          // 모은 동전 도감 (모르는 단계는 ?)
  const s = view.s, n = TIERS.length;
  const gap = row ? (BOX_W * s) / n : size * 2.4 * s;
  for (let t = 0; t < n; t++) {
    const cxp = row ? x + gap * (t + 0.5) : x + size * s + (t % 3) * gap;
    const cyp = row ? y : y + Math.floor(t / 3) * gap;
    if (st.discovered.includes(t)) {
      drawCoin((cxp - view.ox) / s, (cyp - view.oy) / s, t, (size / TIERS[t].r) * 0.9, 1, false);
    } else {
      cx.save(); cx.strokeStyle = "rgba(255,255,255,.25)"; cx.lineWidth = 1;
      cx.beginPath(); cx.arc(cxp, cyp, size * s * 0.9, 0, Math.PI * 2); cx.stroke(); cx.restore();
      text("?", cxp, cyp, size * s, "rgba(255,255,255,.35)");
    }
  }
}

function drawOver() {
  const s = view.s, cxm = view.ox + BOX_W * s / 2, cym = view.oy + BOX_H * s * 0.45;
  cx.save(); cx.fillStyle = "rgba(8,5,20,.78)"; cx.fillRect(0, 0, view.w, view.h); cx.restore();
  const big = Math.min(11 * s, view.w / 9);
  text(T.over, cxm, cym - big * 1.6, big, "#ff40a0", "center", 900, 22);
  text(`${T.score} ${fmt(st.score)}`, cxm, cym, big * 0.55, "#ffffff", "center", 900);
  text(`${T.best} ${fmt(st.best)}`, cxm, cym + big * 0.75, big * 0.45, "#ffd640", "center", 800);
  const bw = big * 4.2, bh = big * 1.1, x = cxm - bw / 2, y = cym + big * 1.5;
  againBtn = { x, y, w: bw, h: bh };
  cx.save(); cx.fillStyle = "#ff40a0"; cx.shadowColor = "#ff40a0"; cx.shadowBlur = 20;
  cx.beginPath(); cx.roundRect(x, y, bw, bh, bh / 2); cx.fill(); cx.restore();
  text(T.again, cxm, y + bh / 2, big * 0.5, "#ffffff");
}

// ───────────── 루프 ─────────────
let last = 0, acc = 0, rafId = 0, firstFrame = false;
const DT = 1 / 120;

function frame(now) {
  rafId = 0;
  if (st.paused) return;
  // 화면 배율(dpr)이나 크기가 바뀌면 다시 맞춘다 — resize 이벤트가 안 오는 기기 대비
  { const d = Math.min(window.devicePixelRatio || 1, 3); if (Math.abs(cv.width - Math.round((cv.clientWidth || innerWidth) * d)) > 2) layout(); }                            // onPause 동안은 아무것도 돌리지 않는다
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  if (st.ready && !st.over) {
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
    if (!st.canDrop) { st.dropTimer -= dt; if (st.dropTimer <= 0) st.canDrop = true; }
    checkOver(dt);
    maybeSave(false);
  }
  for (const p of st.pops) p.life -= dt * 2.2;
  for (const p of st.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.life -= dt * 1.6; }
  st.sparks = st.sparks.filter(p => p.life > 0);
  for (const f of st.floats) { f.y -= 14 * dt; f.life -= dt * 1.1; }
  st.floats = st.floats.filter(f => f.life > 0);
  st.pops = st.pops.filter(p => p.life > 0);
  if (st.bannerT > 0) st.bannerT -= dt;
  draw();
  if (!firstFrame) { firstFrame = true; sdk.firstFrameReady(); }
  rafId = requestAnimationFrame(frame);
}

function startLoop() { if (!rafId) { last = 0; rafId = requestAnimationFrame(frame); } }

// ───────────── 시작 ─────────────
(async function boot() {
  layout();
  startLoop();                                       // 로딩 화면이라도 첫 프레임부터 보여준다
  const lang = (await sdk.lang() || "").toLowerCase();
  T = lang.startsWith("ko") ? TEXT.ko : TEXT.en;
  document.title = T.title;
  audioEnabled = sdk.audioOn();
  await loadSave();                                  // loadData 를 기다린 뒤에야 saveData 허용
  st.ready = true;
  sdk.gameReady();
  if (IN_YT) {
    YT.system.onPause(() => { st.paused = true; if (actx) actx.suspend(); saveNow(); });
    YT.system.onResume(() => { st.paused = false; if (actx && audioEnabled) actx.resume(); startLoop(); });
    YT.system.onAudioEnabledChange(on => setAudio(on));
  }
})();
