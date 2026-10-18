(() => {
'use strict';
const $ = id => document.getElementById(id), cv = $('c'), wrap = $('wrap');
let ctx = cv.getContext('2d');
const W = 960, H = 540, G = 450, PX = 130;

// El takibi: Google MediaPipe Hands (CDN'den yüklenir, internet gerekir)
const MP = 'mediapipe/';   // el takibi dosyaları yerel klasörden (internet gerekmez)
// El kontrolü (BAR sistemi): kamerada dikey bir çizgi ve çizgi üzerinde yukarı-aşağı giden kısa yatay bir bar var.
// Avuç içi bara getirilince bar avuca yapışır ve avucu takip eder: bar üst bölgeye çıkınca ZIPLA, alt bölgeye inince EĞİL, ortada bekle.
// SOL / SAĞ düğmeleri çizginin kameranın hangi tarafında olacağını seçer. Konumlar ekranda görünen (aynalı) görüntüye göredir.
const LINE = { left: 0.12, right: 0.88 };      // çizginin x konumu (kare genişliğinin oranı)
const BARC = {
  lo: 0.12, hi: 0.88,        // avucun kare içindeki yukarı/aşağı hareket aralığı → bar 0..1 (dar aralık = elini az oynatman yeter)
  jump: 0.30, jumpRe: 0.42,  // bar bu değerin üstüne (0 = en üst) çıkınca zıpla; tekrar zıplamak için jumpRe'nin altına inmeli
  duck: 0.70, duckRe: 0.58,  // bar bu değerin altına inince eğil; duckRe'nin üstüne çıkınca kalk
  near: { x: 0.17, y: 0.22 },// avuç içi bara bu kadar yakınsa kilitlenme başlar
  lockMs: 90, loseMs: 700,   // kilitlenme için bekleme / el kaybolunca kilidin açılma süresi
  lead: 0.03, duckHold: 200  // gecikmeyi azaltmak için bar hızıyla ileri tahmin (sn) / en az eğilme süresi (ms)
};
const HAND = { hold: 600 };                // elin "açık" sayılması için bekleme (ms)
let side = 'left';

// ================= OYUNCULAR / SIRALAMA =================
const KEY = 'kcPlayers2';
function loadPlayers() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(a)) return a.filter(x => x && typeof x.name === 'string')
      .map(x => ({ id: String(x.id), name: x.name.slice(0, 14), score: +x.score || 0, seq: +x.seq || 0 }));
  } catch (e) {}
  return [];
}
function savePlayers() { try { localStorage.setItem(KEY, JSON.stringify(players)); } catch (e) {} }
let players = loadPlayers(), me = null, seq = players.reduce((m, p) => Math.max(m, p.seq), 0);

// ================= OYUN DURUMU =================
// name -> welcome -> hand -> count -> play -> dead -> over
let st = 'name', p, obs, coins, pups, parts, speed, t, dist, sc, shield, dbl, spawnIn;
let fx = [], passed = 0, nsp = 0, prevDuck = false, bgOff = 0, shake = 0, ct = 0, ci = -1, clock = 0, dk = false, last = 0;
reset();
function reset() {
  prevDuck = false; fx = []; passed = 0;
  p = { y: G, vy: 0, duck: false }; obs = []; coins = []; pups = []; parts = [];
  speed = 260; t = 0; dist = 0; sc = 0; shield = 0; dbl = 0; spawnIn = 700; nsp = 0;
}
const liveScore = () => (st === 'play' || st === 'dead') ? Math.floor(sc) : 0;
const shown = q => q === me ? Math.max(q.score, liveScore()) : q.score;
const ranked = () => players.slice().sort((a, b) => shown(b) - shown(a) || a.seq - b.seq).map(q => ({ id: q.id, name: q.name, score: shown(q) }));
const bestScore = () => players.reduce((m, q) => Math.max(m, shown(q)), 0);

// ================= SES =================
const coarse = matchMedia('(pointer:coarse)').matches, portraitPhone = matchMedia('(orientation:portrait) and (max-width:600px)');
let tdk = false, ac;
function beep(f, d = .1, type = 'sine', f2) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; if (f2) o.frequency.linearRampToValueAtTime(f2, ac.currentTime + d);
    g.gain.value = .08; g.gain.linearRampToValueAtTime(0, ac.currentTime + d);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch (e) {}
}

// ================= MÜZİK, MİYAV, MIRLAMA =================
let master = null, noiseBuf = null, musicOn = false, musicMuted = false, musTimer = 0, nextBar = 0, barN = 0, musGain = null;
function actx() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; } }
function noise() {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return noiseBuf;
}
// Miyav: gırtlak sesi + gezinen formant filtresi + hafif titreme; her karakterin kendi ses profili (CHARS[].v) var
function meow(mul = 1, delay = 0, dm = 1, vol = 1) {
  const a = actx(); if (!a) return;
  try {
    const v = CHARS[skin].v, t0 = a.currentTime + delay, pr = v.p * mul * (.95 + Math.random() * .1), d = v.d * dm, c = v.c, bp = v.bp;
    const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
    o.type = v.type;
    o.frequency.setValueAtTime(c[0] * v.p * mul, t0); o.frequency.linearRampToValueAtTime(c[1] * v.p * mul, t0 + d * .32); o.frequency.linearRampToValueAtTime(c[2] * v.p * mul, t0 + d);
    lfo.frequency.value = v.vib; lg.gain.value = 12 * pr; lfo.connect(lg); lg.connect(o.frequency);
    f.type = 'bandpass'; f.Q.value = v.q;
    f.frequency.setValueAtTime(bp[0], t0); f.frequency.linearRampToValueAtTime(bp[1], t0 + d * .33); f.frequency.linearRampToValueAtTime(bp[2], t0 + d);   // "mi-ya-v"
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v.g * vol, t0 + .05); g.gain.linearRampToValueAtTime(v.g * vol * .75, t0 + d * .5); g.gain.linearRampToValueAtTime(0, t0 + d);
    o.connect(f); f.connect(g); g.connect(a.destination);
    o.start(t0); lfo.start(t0); o.stop(t0 + d + .02); lfo.stop(t0 + d + .02);
  } catch (e) {}
}
function chime(notes, gap, vol, type, delay = 0) {
  const a = actx(); if (!a) return;
  notes.forEach((n, i) => {
    try {
      const t = a.currentTime + delay + i * gap, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.value = n; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .35);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + .4);
    } catch (e) {}
  });
}
function shing() {            // kılıç sesi: yükselen parlak gürültü + metal tınısı
  const a = actx(); if (!a) return;
  try {
    const t0 = a.currentTime + .05, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noise(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(2500, t0); f.frequency.exponentialRampToValueAtTime(9000, t0 + .28);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.22, t0 + .03); g.gain.exponentialRampToValueAtTime(.0001, t0 + .32);
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t0); s.stop(t0 + .35);
  } catch (e) {}
  chime([2400, 3200], .06, .035, 'sine', .08);
}
// 5 engel kutlaması: karaktere göre neşeli (Aşko/Leydi) ya da kahramanca (Tarçın/Knightcat) miyav
function cheer() {
  if (skin === 1 || skin === 3) {
    meow(1.05, 0, 1, 1.1); meow(1.3, .2, 1.15, 1.15);
    chime(skin === 1 ? [1047, 1319, 1568, 2093] : [880, 1109, 1319, 1760], .07, .045, 'triangle', .05);
  } else {
    meow(1, 0, 1.45, 1.15);
    const o = skin === 2 ? [196, 262, 330] : [220, 277, 330];
    chime(o, .13, .05, 'square', .12);
    if (skin === 0) shing(); else chime([1568, 2093], .08, .03, 'sine', .3);
  }
}
// Mırlama: alçak frekanslı gürültüyü ~25 Hz ile titreştirerek
let purr = null;
function purrStart() {
  const a = actx(); if (!a || purr) return;
  try {
    const t0 = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain(), out = a.createGain();
    s.buffer = noise(); s.loop = true; f.type = 'lowpass'; f.frequency.value = 260;
    g.gain.value = .5; lfo.frequency.value = 23; lg.gain.value = .5; lfo.connect(lg); lg.connect(g.gain);
    out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(1.7, t0 + .08);
    s.connect(f); f.connect(g); g.connect(out); out.connect(a.destination);
    s.start(t0); lfo.start(t0); purr = { s, lfo, out, t0 };
  } catch (e) {}
}
function purrStop(now) {
  if (!purr) return; const pu = purr; purr = null;
  try {
    const a = ac, end = Math.max(a.currentTime, pu.t0 + (now ? 0 : .5));     // en az yarım saniye mırlasın
    pu.out.gain.cancelScheduledValues(a.currentTime); pu.out.gain.setValueAtTime(pu.out.gain.value, end); pu.out.gain.linearRampToValueAtTime(0, end + .25);
    pu.s.stop(end + .3); pu.lfo.stop(end + .3);
  } catch (e) {}
}
// Rahatlatıcı lo-fi müzik: Cmaj7 - Am7 - Fmaj7 - G6, yumuşak pad + bas + seyrek pentatonik melodi
const CH = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]], PENT = [72, 74, 76, 79, 81, 84], BPM = 74, BAR = 240 / BPM;
const mf = n => 440 * Math.pow(2, (n - 69) / 12);
function tone(f, t, d, type, vol, atk, lp) {
  const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
  o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = lp || 1200;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(fl); fl.connect(g); g.connect(musGain); o.start(t); o.stop(t + d + .05);
}
function schedBar(t) {
  const ch = CH[barN % 4];
  ch.forEach((n, i) => { tone(mf(n + 12), t, BAR * 1.05, 'triangle', .018, 1.2, 700); if (i % 2 === 0) tone(mf(n + 12) * 1.003, t, BAR * 1.05, 'sine', .014, 1.2, 900); });
  tone(mf(ch[0] - 12), t, BAR * .5, 'sine', .07, .02, 400); tone(mf(ch[0] - 12), t + BAR * .5, BAR * .45, 'sine', .05, .02, 400);
  for (let i = 0; i < 8; i++) {                       // yumuşak hi-hat
    const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter(), tt = t + i * BAR / 8;
    s.buffer = noise(); f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(i % 2 ? .006 : .011, tt); g.gain.exponentialRampToValueAtTime(.0001, tt + .06);
    s.connect(f); f.connect(g); g.connect(musGain); s.start(tt, Math.random()); s.stop(tt + .08);
  }
  let k = barN * 2;
  for (let i = 0; i < 8; i++) if (Math.random() < (i % 2 ? .22 : .42)) {
    k = Math.max(0, Math.min(PENT.length - 1, (k + Math.floor(Math.random() * 5) - 2)));
    tone(mf(PENT[k]), t + i * BAR / 8, .9, 'sine', .05, .01, 2200);
  }
  barN++;
}
function musicTick() {
  if (!musicOn || !ac) return;
  while (nextBar < ac.currentTime + .6) { schedBar(Math.max(nextBar, ac.currentTime + .02)); nextBar += BAR; }
}
function musicStart() {
  const a = actx(); if (!a || musicOn) return;
  musGain = a.createGain(); musGain.gain.setValueAtTime(0, a.currentTime); musGain.gain.linearRampToValueAtTime(musicMuted ? 0 : 1, a.currentTime + 2);
  musGain.connect(a.destination); musicOn = true; barN = 0; nextBar = a.currentTime + .05;
  musicTick(); musTimer = setInterval(musicTick, 150);
}
function musicStop() {
  if (!musicOn) return; musicOn = false; clearInterval(musTimer);
  try { const a = ac, g = musGain; g.gain.cancelScheduledValues(a.currentTime); g.gain.setValueAtTime(g.gain.value, a.currentTime); g.gain.linearRampToValueAtTime(0, a.currentTime + 1.2); setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 1600); } catch (e) {}
}
function toggleMute() { musicMuted = !musicMuted; if (musGain && musicOn) { musGain.gain.cancelScheduledValues(ac.currentTime); musGain.gain.linearRampToValueAtTime(musicMuted ? 0 : 1, ac.currentTime + .3); } }

// ================= SIRALAMA TABLOSU (animasyonlu liste) =================
function Board(el, o) {
  el.classList.add('lbx');
  const rows = new Map(); let data = [], empty = null;
  if (o.emptyText) { empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = o.emptyText; el.appendChild(empty); }
  function geom() {
    const n = data.length, w = el.clientWidth, h = el.clientHeight;
    const maxCols = Math.max(1, Math.floor(w / o.colMinW));
    let cols = maxCols;
    for (let c = 1; c <= maxCols; c++) if (Math.ceil(n / c) * o.prefRow <= h) { cols = c; break; }
    const per = Math.max(1, Math.ceil(n / cols));
    return { per, rh: Math.max(4, Math.min(o.maxRow, h / per)), cw: w / cols };
  }
  function layout() {
    if (!el.clientWidth || !el.clientHeight) return;
    const g = geom();
    data.forEach((d, i) => {
      const r = rows.get(d.id); if (!r) return;
      const s = r.el.style;
      s.width = (g.cw - 4) + 'px'; s.height = Math.max(3, g.rh - 2) + 'px';
      s.fontSize = Math.max(6, g.rh * .56) + 'px';
      s.transform = 'translate(' + Math.floor(i / g.per) * g.cw + 'px,' + (i % g.per) * g.rh + 'px)';
    });
  }
  function flash(e) { e.classList.remove('up'); void e.offsetWidth; e.classList.add('up'); setTimeout(() => e.classList.remove('up'), 1000); }
  function update(list, curId) {
    data = list; const seen = new Set();
    list.forEach((d, i) => {
      seen.add(d.id);
      let r = rows.get(d.id);
      if (!r) {
        const e = document.createElement('div'); e.className = 'row enter';
        e.innerHTML = '<span class="rk"></span><span class="nm"></span><span class="sc"></span>';
        r = { el: e, rk: e.children[0], nm: e.children[1], sc: e.children[2], rank: 0, name: null, score: null };
        el.appendChild(e); rows.set(d.id, r);
        setTimeout(() => e.classList.remove('enter'), 700);
      }
      const rank = i + 1;
      if (r.rank !== rank) {
        if (r.rank && rank < r.rank && d.id === curId) flash(r.el);
        r.rank = rank; r.rk.textContent = rank;
        r.el.classList.toggle('g1', rank === 1); r.el.classList.toggle('g2', rank === 2); r.el.classList.toggle('g3', rank === 3);
      }
      if (r.name !== d.name) { r.nm.textContent = d.name; r.name = d.name; }
      if (r.score !== d.score) { r.sc.textContent = d.score; r.score = d.score; }
      r.el.classList.toggle('me', d.id === curId);
    });
    rows.forEach((r, id) => { if (!seen.has(id)) { r.el.remove(); rows.delete(id); } });
    if (empty) empty.style.display = list.length ? 'none' : '';
    layout();
  }
  if (window.ResizeObserver) new ResizeObserver(layout).observe(el); else addEventListener('resize', layout);
  return { update, layout };
}
const SIDE_ROW = 20;   // yan tabloda satır başına en az piksel; sığmazsa tablo 2-3 sütuna genişler
const sideBoard = Board($('lb'), { colMinW: 105, prefRow: SIDE_ROW, maxRow: 28, emptyText: 'Henüz oyuncu yok' });
const bigBoard = Board($('lbBig'), { colMinW: 300, prefRow: 40, maxRow: 56 });
let lastKey = null, boardCols = 1;
function refreshBoards(force) {
  const list = ranked(), cur = me ? me.id : null;
  const per = Math.max(1, Math.floor($('lb').clientHeight / SIDE_ROW));
  const cols = Math.min(3, Math.max(1, Math.ceil(list.length / per)));
  if (cols !== boardCols) { boardCols = cols; $('board').style.setProperty('--cols', cols); }
  const key = cur + '#' + list.map(d => d.id + ':' + d.score).join('|');
  if (!force && key === lastKey) return;
  lastKey = key;
  sideBoard.update(list, cur);
  if (st === 'welcome') bigBoard.update(list, cur);
}

// ================= EKRAN AKIŞI =================
const SCREEN = { name: 'nameScr', welcome: 'welcomeScr', char: 'charScr', hand: 'handScr', count: 'count', over: 'over' };
let welcomeT = 0;
function setStage(s) {
  st = s; wrap.dataset.stage = s;
  Object.keys(SCREEN).forEach(k => $(SCREEN[k]).classList.toggle('hidden', k !== s));
  placeCam(); updateHandUI(true);
}
function gotoName() {
  me = null; $('pn').textContent = '-'; $('nm').value = ''; setStage('name'); refreshBoards(true); checkCam();
  setTimeout(() => { if (st === 'name') $('nm').focus(); }, 60);
}
$('nameForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = $('nm').value.trim().replace(/\s+/g, ' ').slice(0, 14);
  if (!n) { const i = $('nm'); i.classList.add('err'); i.focus(); setTimeout(() => i.classList.remove('err'), 500); return; }
  me = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: n, score: 0, seq: ++seq };
  players.push(me); savePlayers();
  $('pn').textContent = n; $('wname').textContent = n.toLocaleUpperCase('tr-TR');
  setStage('welcome'); refreshBoards(true); bigBoard.layout();
  beep(520, .15, 'triangle', 780);
  clearTimeout(welcomeT); welcomeT = setTimeout(() => { if (st === 'welcome') gotoChar(); }, 5000);
});
// ---- karakter seçimi ----
const SUBS = ['Klasik şövalye', 'Tatlı prenses', 'Karanlık avcı', 'Şık tuxedo'];
let chEls = [];
function buildChars() {
  if (chEls.length) return;
  chEls = CHARS.map((c, i) => {
  const d = document.createElement('div'); d.className = 'ch';
  d.innerHTML = '<canvas width="150" height="180"></canvas><b>' + c.name + '</b><small>' + c.sub + '</small>';
  d.onclick = () => pickChar(i); $('chars').appendChild(d); return d;
  });
}
function pickChar(i) { skin = i; chEls.forEach((e, j) => e.classList.toggle('sel', j === i)); beep(500 + i * 90, .1, 'triangle', 700 + i * 90); }
function drawPreviews() {
  if (!chEls.length) return;
  const main = ctx;
  chEls.forEach((e, i) => {
    const c = e.firstChild; ctx = c.getContext('2d'); ctx.clearRect(0, 0, 150, 180);
    const g = ctx.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, i === 2 ? '#3a2150' : '#6cc4ff'); g.addColorStop(1, i === 2 ? '#150c24' : '#dff3ff'); ctx.fillStyle = g; ctx.fillRect(0, 0, 150, 180);
    ctx.fillStyle = i === 2 ? '#2a1c2a' : '#7a4b2a'; ctx.fillRect(0, 160, 150, 20);
    ctx.save(); ctx.scale(1.4, 1.4); cat(34, 113, false, clock * .6, e.classList.contains('sel') ? false : true, i); ctx.restore();
  });
  ctx = main;
}
function gotoChar() {
  me && me.skin != null && (skin = me.skin);
  buildChars(); setStage('char'); pickChar(skin);
}
function confirmChar() { if (st !== 'char') return; if (me) me.skin = skin; gotoHand(); }
$('charGo').onclick = confirmChar;
function gotoHand() {
  // her yeni oyuncu ve her tekrarda algılama sıfırdan başlar; kamera sağlığı da yeniden kontrol edilir
  handReady = false; handSeen = false; openSince = 0; lastOpenT = 0; lastSeen = 0; kbMode = false;
  barUnlock(true); msgKey = '';
  setStage('hand'); checkCam();
}
function tryStart() { if (st === 'hand' && (handReady || kbMode)) beginRun(); }
function beginRun() {
  reset(); ct = 0; ci = -1; setStage('count');
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {}
}
function gameOver() {
  setStage('dead'); fx = []; musicStop(); purrStop(true); shake = .4; beep(200, .5, 'sawtooth', 50);
  for (let i = 0; i < 30; i++) puff(PX + 24, p.y - 30, 1, ['#ffd24a', '#ff6a5c', '#fff'][i % 3], 400);
  const s = Math.floor(sc), prevBest = players.reduce((m, q) => Math.max(m, q.score), 0);
  const isRecord = s > prevBest && s > 0;
  if (me && s > me.score) me.score = s;
  savePlayers(); refreshBoards(true);
  setTimeout(() => {
    $('fscore').textContent = s;
    $('fnote').textContent = isRecord ? '🎉 YENİ REKOR!' : 'Rekor: ' + bestScore();
    const list = ranked(), r = me ? list.findIndex(d => d.id === me.id) + 1 : 0;
    $('rank').textContent = r === 1 ? '👑 Lider sensin!' : 'Sıralamadaki yerin: ' + r + ' / ' + list.length;
    setStage('over');
  }, 900);
}
$('goBtn').onclick = tryStart;
$('kbBtn').onclick = () => { kbMode = true; updateHandUI(true); };
$('again').onclick = () => { if (st === 'over') gotoChar(); };
$('next').onclick = () => { if (st === 'over') gotoName(); };

// ================= KLAVYE / DOKUNMATİK (yedek kontroller) =================
function jump() {
  if (st === 'play' && p.y >= G - 1) { p.vy = -800; meow(); puff(PX + 20, G, 6, '#fff', 150); }
}
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.code;
  if (st === 'char') {
    if (k === 'ArrowLeft') pickChar((skin + 3) % 4); else if (k === 'ArrowRight') pickChar((skin + 1) % 4);
    else if (/^Digit[1-4]$/.test(k)) pickChar(+k[5] - 1); else if (k === 'Enter' || k === 'Space') { e.preventDefault(); confirmChar(); }
    return;
  }
  if (k === 'KeyM') toggleMute();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
  if (k === 'Space' || k === 'ArrowUp') { if (st === 'play') jump(); else tryStart(); }
  else if (k === 'ArrowDown') dk = true;
  else if (k === 'Enter') { if (st === 'hand') tryStart(); else if (st === 'over') gotoChar(); }
  else if (k === 'KeyF') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  else if (k === 'Delete' && e.shiftKey) clearAll();
});
addEventListener('keyup', e => { if (e.code === 'ArrowDown') dk = false; });
// Listeyi sil: onay sorar; oyun sürüyorsa durdurur ve isim ekranına döner
function clearAll() {
  if (!confirm('Tüm oyuncular ve skorlar silinsin mi?\nBu işlem geri alınamaz.')) return;
  players = []; seq = 0; savePlayers();
  clearTimeout(welcomeT); musicStop(); purrStop(true); reset(); lastKey = null;
  gotoName();
}
$('clearBtn').addEventListener('mousedown', e => e.preventDefault());      // odak almasın: BOŞLUK tuşu yanlışlıkla tetiklemesin
$('clearBtn').onclick = e => { e.currentTarget.blur(); clearAll(); };
let py = 0;
cv.addEventListener('pointerdown', e => { e.preventDefault(); if (coarse) return; py = e.clientY; jump(); });
cv.addEventListener('pointermove', e => { if (!coarse && (e.buttons || e.pointerType === 'touch') && e.clientY - py > 40) dk = true; });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => cv.addEventListener(ev, () => dk = false));
addEventListener('touchmove', e => e.preventDefault(), { passive: false });
// dokunmatik butonlar: sağ = zıpla, sol = eğil (basılı tuttukça)
(() => {
  const J = $('tbJ'), D = $('tbD');
  J.addEventListener('pointerdown', e => { e.preventDefault(); J.classList.add('on'); jump(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => J.addEventListener(ev, () => J.classList.remove('on')));
  D.addEventListener('pointerdown', e => { e.preventDefault(); try { D.setPointerCapture(e.pointerId); } catch (x) {} tdk = true; D.classList.add('on'); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => D.addEventListener(ev, () => { tdk = false; D.classList.remove('on'); }));
})();
// tam ekran (telefon/tablet): mümkünse yatay kilitler
(() => {
  const b = $('fsBtn'), de = document.documentElement;
  if (!de.requestFullscreen) { b.style.display = 'none'; return; }
  b.addEventListener('mousedown', e => e.preventDefault());
  b.onclick = () => { const r = document.fullscreenElement ? document.exitFullscreen() : de.requestFullscreen(); Promise.resolve(r).then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (x) {} }).catch(() => {}); };
})();
// QR kod: telefonla açmak için bu sayfanın linki (ya da elle girilen yayın linki)
function qrLink() {
  let u = ''; try { u = localStorage.getItem('kcQrUrl') || ''; } catch (e) {}
  if (!u && /^https?:$/.test(location.protocol)) u = location.href.split('#')[0];
  return u;
}
function drawQR() {
  const c = $('qrc'), u = qrLink(), t = $('qrTxt');
  if (!u || typeof qrcode !== 'function') { c.style.display = 'none'; $('qrBox').style.setProperty('display','none','important'); return; }
  try {
    const q = qrcode(0, 'M'); q.addData(u); q.make();
    const n = q.getModuleCount(), cell = 6, size = (n + 8) * cell, g = c.getContext('2d');
    c.width = c.height = size; g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + 4) * cell, (r + 4) * cell, cell, cell);
    c.style.display = ''; t.innerHTML = '📱 Telefonda oyna<br>QR kodu okut';
  } catch (e) { c.style.display = 'none'; t.textContent = '📱 QR oluşturulamadı'; }
}
drawQR();
addEventListener('contextmenu', e => e.preventDefault());

// ================= EL TAKİBİ (MediaPipe Hands) =================
// Kamera ve el takibi oyun boyunca açık kalır; kendini izler, koparsa/takılırsa kendi kendine yeniden başlar.
const vid = $('vid'), hc = $('hc'), hx = hc.getContext('2d'), camEl = $('cam');
let camState = 'idle', camMsg = '', camT0 = 0;           // idle | loading | ready | error
let hands = null, recovering = false, retryT = 0, lastResultT = 0, lastSendT = 0, lastCT = -1, stallMs = 0;
let handSeen = false, handReady = false, openSince = 0, lastSeen = 0, kbMode = false;
let lastOpenT = 0, handDuck = false, gsT = 0, msgKey = '';

const raf = () => new Promise(r => requestAnimationFrame(r));
function withTimeout(p, ms) {
  let id; p.catch(() => {});
  const to = new Promise((_, rej) => { id = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(id));
}
const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous';
  s.onload = res; s.onerror = () => { s.remove(); rej(new Error('script')); }; document.head.appendChild(s);
});

async function openStream() {
  const old = vid.srcObject; if (old) old.getTracks().forEach(t => t.stop());
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
  vid.srcObject = s; stallMs = 0; lastCT = -1;
  s.getVideoTracks().forEach(t => { t.onended = () => { if (vid.srcObject === s) recover('stream'); }; });
  await vid.play();
}
async function makeHands() {
  if (!window.Hands) await loadScript(MP + 'hands.js');
  const old = hands; hands = null;
  if (old) { try { Promise.resolve(old.close()).catch(() => {}); } catch (e) {} }
  const h = new window.Hands({ locateFile: f => MP + f });
  h.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: .35, minTrackingConfidence: .2 });
  h.onResults(r => { if (hands === h) onHands(r); });   // eski örneğin geç gelen sonuçları yok sayılır
  await withTimeout(h.initialize(), 30000);
  hands = h; lastResultT = performance.now();
}
function camFail(m) {
  camState = 'error'; camMsg = m; clearTimeout(retryT);
  retryT = setTimeout(() => { if (camState === 'error') recover('all'); }, 5000);   // izin/internet düzelince kendiliğinden toparlar
}
// kind: 'all' (kamera + el takibi) | 'stream' (yalnız kamera akışı) | 'hands' (yalnız el takibi)
async function recover(kind) {
  if (recovering) return; recovering = true;
  camState = 'loading'; camT0 = performance.now(); setHs(); updateHandUI(true);
  let stage = 'cam';
  try {
    if (kind !== 'hands') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
      await openStream();
    }
    stage = 'lib';
    if (kind !== 'stream') await makeHands();
    camState = 'ready'; lastResultT = performance.now();
  } catch (e) {
    camFail(stage === 'lib' ? 'El takibi yüklenemedi (internet gerekli).' : 'Kamera açılamadı. Tarayıcıdan kamera iznini ver.');
  }
  recovering = false; placeCam(); updateHandUI(true); setHs();
}
// Her yeni oyuncu / tekrar oynamada çağrılır: kamera ve el takibi sağlıklı mı, değilse hemen düzelt (sayfa yenilemeden)
function checkCam() {
  if (recovering) return;
  if (camState === 'error' || camState === 'idle') { clearTimeout(retryT); recover('all'); return; }
  const tr = vid.srcObject && vid.srcObject.getVideoTracks()[0];
  if (!tr || tr.readyState !== 'live') recover('stream');
  else if (performance.now() - lastResultT > 2500) recover('hands');
}
// yeni kamera karesi gelince hemen işle (requestVideoFrameCallback): gereksiz bekleme yok, hep en yeni kare gönderilir
function nextFrame() {
  return new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    if (vid.requestVideoFrameCallback) { vid.requestVideoFrameCallback(fin); setTimeout(fin, 120); } else requestAnimationFrame(fin);
  });
}
async function camLoop() {
  let fails = 0;
  for (;;) {
    await nextFrame();
    if (camState !== 'ready' || recovering || !hands) { await raf(); continue; }
    const now = performance.now(), idle = st === 'name' || st === 'welcome' || st === 'over';
    if (idle && now - lastSendT < 250) continue;         // oyun dışında düşük hızda çalışır ama hep canlı kalır
    if (vid.paused) vid.play().catch(() => {});
    if (vid.readyState < 2 || !vid.videoWidth) { await raf(); continue; }
    lastSendT = now;
    try { await withTimeout(hands.send({ image: vid }), 4000); fails = 0; }
    catch (e) { if (e.message === 'timeout' || ++fails >= 3) { fails = 0; await recover('hands'); } }
  }
}
// bekçi: akış bitti mi, görüntü durdu mu, sonuç akışı kesildi mi?
setInterval(() => {
  if (camState !== 'ready' || recovering || document.hidden) return;
  const tr = vid.srcObject && vid.srcObject.getVideoTracks()[0];
  if (!tr || tr.readyState === 'ended') { recover('stream'); return; }
  stallMs = vid.currentTime === lastCT ? stallMs + 1000 : 0; lastCT = vid.currentTime;
  if (stallMs >= 5000) { stallMs = 0; recover('stream'); }
  else if (performance.now() - lastResultT > 8000) recover('hands');
}, 1000);

// Eli açık mı? Hafif kıvrık parmaklar da kabul edilir: 4 parmaktan en az 3'ü uzanmış ve el yeterince büyük olmalı
function isOpen(lm) {
  const vw = vid.videoWidth || 640, vh = vid.videoHeight || 480;
  const d = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
  const w = lm[0]; let ext = 0;
  for (const [mcp, pip, tip] of [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]])
    if (d(w, lm[tip]) > d(w, lm[pip]) * 1.03 && d(w, lm[tip]) > d(w, lm[mcp]) * 1.2) ext++;
  return ext >= 3 && d(w, lm[9]) > vh * .09;
}
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(lm, open) {
  const vw = vid.videoWidth || 640, vh = vid.videoHeight || 480;
  if (hc.width !== vw || hc.height !== vh) { hc.width = vw; hc.height = vh; }
  hx.clearRect(0, 0, vw, vh);
  if (!lm) return;
  hx.lineWidth = vw / 90; hx.lineCap = 'round';
  hx.strokeStyle = open ? '#53ff9a' : '#ffd24a';
  hx.beginPath(); BONES.forEach(([a, b]) => { hx.moveTo(lm[a].x * vw, lm[a].y * vh); hx.lineTo(lm[b].x * vw, lm[b].y * vh); }); hx.stroke();
  hx.fillStyle = '#fff'; lm.forEach(q => { hx.beginPath(); hx.arc(q.x * vw, q.y * vh, vw / 110, 0, 7); hx.fill(); });
}
function setHs() {
  const live = camState === 'ready';
  $('hs').textContent = live ? (handSeen ? 'EL VAR' : 'EL YOK') : (camState === 'error' ? 'KAMERA YOK' : '⟳ KAMERA');
  camEl.classList.toggle('on', live && handSeen);
}
// Kare görüntüsü 4:3 kutuya "cover" ile sığdırılıyor (kaynak farklı oranda ise kenarlar kırpılır) ve ayna gibi ters çevriliyor;
// kameradan gelen 0-1 koordinatını ekranda görünen konuma çevirir
function viewX(x) {
  const ar = (vid.videoWidth || 640) / (vid.videoHeight || 480), frac = Math.min(1, (4 / 3) / ar);
  return 1 - (x - (1 - frac) / 2) / frac;
}
function viewY(y) {
  const ar = (vid.videoWidth || 640) / (vid.videoHeight || 480), frac = Math.min(1, ar / (4 / 3));
  return (y - (1 - frac) / 2) / frac;
}
// ---------- BAR SİSTEMİ ----------
const trkEl = $('trk'), barZ = $('barZ'), clamp01 = v => Math.max(0, Math.min(1, v));
const toBar = y => clamp01((y - BARC.lo) / (BARC.hi - BARC.lo));          // avucun kare içindeki y'si → bar konumu (0 üst, 1 alt)
// One-Euro filtresi: elin yavaşken titremesini bastırır, hızlı harekette neredeyse hiç gecikme eklemez
function oneEuro(minCut, beta, dcut) {
  let x = null, dx = 0, t = 0; const al = (c, dt) => { const r = 6.2832 * c * dt; return r / (r + 1); };
  return {
    reset() { x = null; dx = 0; },
    f(v, tm) {
      if (x === null) { x = v; dx = 0; t = tm; return v; }
      const dt = Math.max(.004, (tm - t) / 1000); t = tm;
      dx += al(dcut, dt) * ((v - x) / dt - dx);
      x += al(minCut + beta * Math.abs(dx), dt) * (v - x); return x;
    },
    get vel() { return dx; }
  };
}
const fy = oneEuro(3, 30, 1.2);
const B = { locked: false, near: 0, v: .5, vy: 0, pred: .5, disp: .5, upZone: false, dnZone: false, duckUntil: 0, lastT: 0 };
function setCls(c, on) { if (camEl.classList.contains(c) !== on) camEl.classList.toggle(c, on); }
function barUnlock(silent) {
  B.locked = false; B.near = 0; B.v = B.pred = .5; B.vy = 0; B.upZone = B.dnZone = false; handDuck = false; fy.reset();
  setCls('lock', false); setCls('rdy', false); $('zUp').classList.remove('on'); $('zDn').classList.remove('on');
  if (!silent) flashGs('bar bırakıldı');
}
function barLock(now, y) {
  B.locked = true; fy.reset(); fy.f(y, now); B.lastT = now; setCls('lock', true); setCls('rdy', false);
  flashGs('🔒 BAR AVUCUNDA'); beep(700, .08, 'triangle', 1000);
}
// bar konumuna göre hareket: üst bölge = zıpla (girişte bir kez), alt bölge = eğil (bölgede kaldıkça)
function applyBar(now) {
  const v = clamp01(B.v + B.vy * BARC.lead);        // kısa ileri tahmin: kamera gecikmesini kapatır
  B.pred = v;
  if (v < BARC.jump) { if (!B.upZone) { B.upZone = true; flashGs('⬆ ZIPLAMA'); if (st === 'play') jump(); } }
  else if (v > BARC.jumpRe) B.upZone = false;
  if (v > BARC.duck) { if (!B.dnZone) { B.dnZone = true; flashGs('⬇ EĞİLME'); } B.duckUntil = now + BARC.duckHold; handDuck = true; }
  else if (v < BARC.duckRe && B.dnZone && now >= B.duckUntil) { B.dnZone = false; handDuck = false; }
  else if (B.dnZone) handDuck = true;
  $('zUp').classList.toggle('on', B.upZone); $('zDn').classList.toggle('on', B.dnZone);
}
function onHands(res) {
  const lm = res.multiHandLandmarks && res.multiHandLandmarks[0], now = performance.now();
  lastResultT = now;
  if (!lm) {
    handSeen = false; if (now - lastOpenT > 350) openSince = 0;     // kısa kayıplarda "açık el" sayacı sıfırlanmaz
    drawHand(null); setHs(); B.near = 0; setCls('rdy', false);
    // kilitliyken el çok hızlı giderken kaybolursa: son hızla kısa süre ileri tahmin et (zıplama/eğilme kaçmasın)
    if (B.locked && now - lastSeen < 180) { const dt = Math.min(.18, (now - lastSeen) / 1000); B.v = clamp01(B.v + B.vy * dt * .5); B.vy *= .8; applyBar(now); }
    return;
  }
  handSeen = true; lastSeen = now; setHs();
  const open = isOpen(lm); drawHand(lm, open);
  if (st === 'hand') {
    if (open) { lastOpenT = now; if (!openSince) openSince = now; if (!handReady && now - openSince > HAND.hold) { handReady = true; beep(660, .25, 'triangle', 990); } }
    else if (now - lastOpenT > 350) openSince = 0;
  }
  // avuç içi merkezi (ekranda görünen/aynalı koordinatlarda)
  let px = 0, py = 0; [0, 5, 9, 13, 17].forEach(i => { px += viewX(lm[i].x) / 5; py += viewY(lm[i].y) / 5; });
  if (!B.locked) {
    const near = Math.abs(px - LINE[side]) <= BARC.near.x && Math.abs(toBar(py) - .5) <= BARC.near.y;
    if (near) { if (!B.near) B.near = now; if (now - B.near >= BARC.lockMs) barLock(now, py); else setCls('rdy', true); }
    else { B.near = 0; setCls('rdy', false); }
    if (!B.locked) { updateHandUI(); return; }
  }
  const yf = fy.f(py, now);
  B.v = toBar(yf); B.vy = fy.vel / (BARC.hi - BARC.lo); B.lastT = now;
  applyBar(now);
  updateHandUI();
}
// bar çizimi: her ekran karesinde (60+ fps) hedefe çok hızlı yaklaşır → akıcı hareket, düşük gecikme
let barT = 0;
function barLoop(ts) {
  const dt = Math.min(.05, (ts - barT) / 1000 || .016); barT = ts;
  if (!camEl.classList.contains('off')) {
    if (B.locked && ts - lastSeen > BARC.loseMs) barUnlock();
    const tgt = B.locked ? B.pred : .5, tau = B.locked ? .014 : .16;
    B.disp += (tgt - B.disp) * (1 - Math.exp(-dt / tau));
    barZ.style.transform = 'translateY(' + (5 + 90 * B.disp).toFixed(2) + '%)';
  }
  requestAnimationFrame(barLoop);
}
requestAnimationFrame(barLoop);
const HOW = {
  left: 'Çizgi <b>solda</b>. Avuç içini çizgideki <b>bara</b> getir, bar avucuna yapışır: elini <b>yukarı = zıpla</b>, <b>aşağı = eğil</b>, ortada = bekle.',
  right: 'Çizgi <b>sağda</b>. Avuç içini çizgideki <b>bara</b> getir, bar avucuna yapışır: elini <b>yukarı = zıpla</b>, <b>aşağı = eğil</b>, ortada = bekle.'
};
function setSide(m, keep) {
  side = LINE[m] != null ? m : 'left';
  if (!keep) try { localStorage.setItem('kcSide', side); } catch (e) {}
  barUnlock(true);
  $('sideL').classList.toggle('on', side === 'left'); $('sideR').classList.toggle('on', side === 'right');
  trkEl.classList.toggle('sideL', side === 'left'); trkEl.classList.toggle('sideR', side === 'right');
  trkEl.style.setProperty('--lx', LINE[side] * 100 + '%');
  $('infoHow').innerHTML = HOW[side];
}
['sideL', 'sideR'].forEach(id => $(id).addEventListener('mousedown', e => e.preventDefault()));
$('sideL').onclick = () => setSide('left');
$('sideR').onclick = () => setSide('right');
function flashGs(s) { const g = $('gs'); g.textContent = s; clearTimeout(gsT); gsT = setTimeout(() => g.textContent = '', 600); }

function placeCam() {
  const show = camState !== 'error' && vid.srcObject && (st === 'hand' || st === 'count' || st === 'play' || st === 'dead');
  camEl.classList.toggle('off', !show);                  // display:none değil, visibility: video oynamaya devam etsin
  camEl.classList.toggle('big', st === 'hand'); camEl.classList.toggle('mini', st !== 'hand');
  if (show && st === 'hand') {
    const a = $('camslot').getBoundingClientRect(), b = wrap.getBoundingClientRect(), s = camEl.style;
    s.left = (a.left - b.left - wrap.clientLeft) + 'px'; s.top = (a.top - b.top - wrap.clientTop) + 'px';
    s.width = a.width + 'px'; s.height = a.height + 'px';
  } else camEl.removeAttribute('style');
}
addEventListener('resize', placeCam);

function updateHandUI(force) {
  if (st !== 'hand') return;
  let text, cls = '', go = false, kb = false;
  if (kbMode) { text = coarse ? '👆 Dokunmatik mod: sağ buton zıplar, sol buton eğilir' : '⌨ Klavye modu: BOŞLUK / ↑ zıpla, ↓ eğil'; go = true; }
  else if (handReady) { text = '✅ El algılandı oyuna başlayabilirsiniz'; cls = 'ok'; go = true; }
  else if (camState === 'error') { text = '⚠ ' + camMsg + ' Tekrar deneniyor…'; cls = 'bad'; kb = true; }
  else if (camState !== 'ready') { text = '⏳ Kamera ve el takibi hazırlanıyor…'; kb = performance.now() - camT0 > 12000; }
  else if (handSeen) text = '✋ Elini tamamen aç, parmakların ayrık olsun';
  else text = '✋ Elini kameraya göster';
  if (coarse && !go) kb = true;                          // telefonda dokunarak oynama seçeneği hemen görünür
  const key = text + cls + go + kb;
  if (!force && key === msgKey) return; msgKey = key;
  const m = $('handMsg'); m.textContent = text; m.className = 'note ' + cls;
  $('goBtn').classList.toggle('hidden', !go); $('kbBtn').classList.toggle('hidden', !kb);
  placeCam();
}
setInterval(() => updateHandUI(), 500);

// ================= DÜNYA =================
function puff(x, y, n, c, v = 200) {
  for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * v * 2, vy: -Math.random() * v, l: .5 + Math.random() * .4, c, s: 3 + Math.random() * 4 });
}
function spawn() {
  // Zorluk yavaş yavaş artar: ilk 4 engel tek kasa + para, 8. engelden sonra üst üste kasa, 12.'den sonra yarasa
  const n = nsp++, d = Math.min(1, t / 100), r = Math.random(); let o;
  const wBat = n < 12 ? 0 : .09 + .12 * d, wStack = n < 8 ? 0 : .06 + .26 * d, wSpike = n < 4 ? 0 : .22 + .1 * d;
  if (r < wBat) o = { k: 'bat', w: 52, h: 30 };
  else if (r < wBat + wStack) o = { k: 'stack', w: 46, h: 92 };
  else if (r < wBat + wStack + wSpike) o = { k: 'spike', w: 56, h: 34 };
  else o = { k: 'crate', w: 46, h: 46 };
  o.x = W + 60; o.y = o.k === 'bat' ? G - 72 : G - o.h + 4; obs.push(o);      // +4: kasa/diken çimene gömülü, zemine yapışık
  if (n < 4 || Math.random() < .7) for (let i = 0; i < 5; i++)
    coins.push({ x: o.x + o.w / 2 - 80 + i * 40, y: o.k === 'bat' ? G - 28 : G - o.h - 45 - Math.sin(i / 4 * Math.PI) * 45 });
  if (n >= 3 && Math.random() < .2) pups.push({ x: o.x + o.w + 90, y: G - 90, k: Math.random() < .65 ? 's' : 'd' });
  spawnIn = speed * (1.25 - .3 * d + Math.random() * .6) + o.w;               // aralık: en az ~1 sn'lik yol, rahat zıplanır
}
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ---- 5 engelde bir kutlama efekti: Aşko/Leydi kalp, Tarçın kalkan, Knightcat kılıç ----
function celebrate() {
  if (skin === 1 || skin === 3) {
    const cols = skin === 1 ? ['#ff4f8b', '#ff8fb8', '#ffd0e0', '#ff6fa3'] : ['#ff6fa3', '#d9a0f0', '#ffd0e0', '#ff4f8b'];
    for (let i = 0; i < 14; i++) { const an = Math.random() * 6.283, r = 20 + Math.random() * 20; fx.push({ k: 'heart', ox: Math.cos(an) * r, oy: Math.sin(an) * r, vx: Math.cos(an) * 55, vy: Math.sin(an) * 40 - 75, l: 1.3 + Math.random() * .4, l0: 1.6, s: 4 + Math.random() * 5, c: cols[i % 4] }); }
  } else {
    const n = 8, k = skin === 2 ? 'shield' : 'sword';
    for (let i = 0; i < n; i++) fx.push({ k, a: i / n * 6.283, va: 3.2, r0: 30, l: 1.5, l0: 1.5, s: skin === 2 ? 9 : 8, c: skin === 2 ? (i % 2 ? '#7cf0ff' : '#e6b33a') : '#e6eef9' });
    fx.push({ k: 'ring', l: .6, l0: .6, c: skin === 2 ? '#7cf0ff' : '#ffd24a' });
  }
  fx.push({ k: 'txt', ox: 0, oy: -62, vy: -45, l: 1.1, l0: 1.1, t: passed + ' ENGEL!', c: skin === 1 || skin === 3 ? '#ff8fb8' : '#ffd24a' });
  cheer();
}
function updateFx(dt) {
  fx.forEach(e => {
    e.l -= dt;
    if (e.a != null) { e.a += e.va * dt; e.r = e.r0 + (1 - e.l / e.l0) * 28; e.ox = Math.cos(e.a) * e.r; e.oy = Math.sin(e.a) * e.r * .85; }
    else { e.ox += (e.vx || 0) * dt; e.oy += (e.vy || 0) * dt; }
  });
  fx = fx.filter(e => e.l > 0);
}
function drawShield(x, y, s, c) {
  ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * .85, y - s * .6); ctx.quadraticCurveTo(x + s * .85, y + s * .55, x, y + s * 1.1); ctx.quadraticCurveTo(x - s * .85, y + s * .55, x - s * .85, y - s * .6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.7)'; rr(x - s * .12, y - s * .6, s * .24, s * 1.3, 1);
}
function drawSword(x, y, s, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#e6eef9'; rr(-s * .2, -s * 1.1, s * .4, s * 1.6, 1); tri(-s * .2, -s * 1.1, s * .2, -s * 1.1, 0, -s * 1.6);
  ctx.fillStyle = '#ffd24a'; rr(-s * .6, .5 * s, s * 1.2, s * .28, 1); rr(-s * .15, .75 * s, s * .3, s * .5, 1); ctx.restore();
}
function drawFx() {
  if (!fx.length) return;
  const cx = PX + 26, cy = p.y - 38;
  fx.forEach(e => {
    const al = Math.min(1, e.l / .4), x = cx + (e.ox || 0), y = cy + (e.oy || 0);
    ctx.globalAlpha = al;
    if (e.k === 'heart') { ctx.fillStyle = e.c; heart(x, y, e.s); }
    else if (e.k === 'shield') drawShield(x, y, e.s, e.c);
    else if (e.k === 'sword') drawSword(x, y, e.s, e.a + 1.57);
    else if (e.k === 'ring') { ctx.strokeStyle = e.c; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, 30 + (1 - e.l / e.l0) * 46, 0, 7); ctx.stroke(); }
    else if (e.k === 'txt') { ctx.fillStyle = e.c; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 4; ctx.font = '900 24px sans-serif'; ctx.textAlign = 'center'; ctx.strokeText(e.t, x, y); ctx.fillText(e.t, x, y); }
  });
  ctx.globalAlpha = 1;
}
function update(dt) {
  t += dt; speed = Math.min(680, 260 + t * 5); dist += speed * dt; sc += speed * dt / 10 * (dbl > 0 ? 2 : 1);
  if (dbl > 0) dbl -= dt; if (shield > 0) shield -= dt;
  // el kameradan kaybolursa eğilme yarım saniye sonra bırakılır
  if (handDuck && performance.now() - lastSeen > 500) handDuck = false;
  const duck = dk || tdk || handDuck;
  p.duck = duck && p.y >= G;
  if (p.duck && !prevDuck) purrStart(); else if (!p.duck && prevDuck) purrStop();
  prevDuck = p.duck;
  p.vy += (2200 + (duck && p.y < G ? 3000 : 0)) * dt; p.y += p.vy * dt; if (p.y >= G) { p.y = G; p.vy = 0; }
  if ((spawnIn -= speed * dt) <= 0) spawn();
  updateFx(dt);
  for (const o of obs) if (!o.passed && !o.dead && o.x + o.w < PX + 6) { o.passed = 1; if (++passed % 5 === 0) celebrate(); }
  const mv = a => { a.forEach(o => o.x -= speed * dt); return a.filter(o => o.x > -120 && !o.dead); };
  obs = mv(obs); coins = mv(coins); pups = mv(pups);
  const ph = p.duck ? 30 : 54, box = { x: PX + 6, y: p.y - ph, w: 34, h: ph };
  for (const o of obs) if (hit(box, { x: o.x + 6, y: o.y + 6, w: o.w - 12, h: o.h - 8 })) {
    if (shield > 0) { shield = 0; o.dead = 1; shake = .25; puff(o.x, o.y, 20, '#7cf0ff', 300); beep(150, .2, 'square'); }
    else { gameOver(); return; }
  }
  coins = coins.filter(c => { if (hit(box, { x: c.x - 12, y: c.y - 12, w: 24, h: 24 })) { sc += 50 * (dbl > 0 ? 2 : 1); puff(c.x, c.y, 8, '#ffd24a', 150); beep(880, .1, 'triangle', 1320); return false; } return true; });
  pups = pups.filter(u => { if (hit(box, { x: u.x - 18, y: u.y - 18, w: 36, h: 36 })) { u.k === 's' ? shield = 10 : dbl = 8; puff(u.x, u.y, 20, u.k === 's' ? '#7cf0ff' : '#ffd24a', 300); beep(500, .3, 'sine', 1000); return false; } return true; });
}

// ================= ÇİZİM =================
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
function ci_(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function tri(a, b, c, d, e, f) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.lineTo(e, f); ctx.fill(); }

// ================= KARAKTERLER =================
const CHARS = [
  { name: 'KNIGHTCAT', sub: 'Klasik şövalye', v: { p: 1, d: .42, g: .34, type: 'sawtooth', c: [430, 820, 640], bp: [700, 1900, 950], q: 3.2, vib: 30 } },                 // normal kedi miyavı
  { name: 'AŞKO CAT', sub: 'Tatlı prenses', v: { p: 1.5, d: .34, g: .2, type: 'triangle', c: [520, 980, 800], bp: [1000, 2700, 1500], q: 4, vib: 36 } },                  // ince, narin
  { name: 'TARÇIN', sub: 'Cesur kahraman', v: { p: .66, d: .62, g: .36, type: 'sawtooth', c: [380, 640, 600], bp: [520, 1250, 780], q: 2.6, vib: 22 } },                   // derin, uzun, kahramanca
  { name: 'LEYDİ', sub: 'Şık tuxedo', v: { p: 1.2, d: .3, g: .32, type: 'triangle', c: [480, 760, 900], bp: [850, 2300, 1300], q: 3.6, vib: 26 } }                          // naif, yumuşak "miyu"

];
let skin = 0;
function heart(x, y, s) { ci_(x - s * .5, y - s * .3, s * .55); ci_(x + s * .5, y - s * .3, s * .55); tri(x - s * 1.02, y - s * .1, x + s * 1.02, y - s * .1, x, y + s * 1.05); }
function star(x, y, r, a) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); for (let i = 0; i < 8; i++) { const q = i % 2 ? r * .4 : r, an = i * Math.PI / 4; ctx.lineTo(Math.cos(an) * q, Math.sin(an) * q); } ctx.closePath(); ctx.fill(); ctx.restore(); }
function tail(col, w, ph, tip, ring) {
  ctx.lineCap = 'round'; ctx.lineWidth = w; ctx.strokeStyle = col;
  const path = () => { ctx.beginPath(); ctx.moveTo(8, -22); ctx.quadraticCurveTo(-16, -22, -12, -48 + Math.sin(ph * 10) * 5); };
  path(); ctx.stroke();
  if (ring) { path(); ctx.strokeStyle = ring; ctx.lineWidth = w - 3; ctx.setLineDash([3, 7]); ctx.stroke(); ctx.setLineDash([]); }
  if (tip) { ctx.fillStyle = tip; ci_(-12, -48 + Math.sin(ph * 10) * 5, w / 2); }
}
function legs(fur, paw, sw, r) { ctx.fillStyle = fur; rr(13 + sw, -14, 8, 10, 3); rr(29 - sw, -14, 8, 10, 3); ctx.fillStyle = paw; rr(11 + sw, -6, 12, 6, r || 2); rr(27 - sw, -6, 12, 6, r || 2); }
function whisk(c) { ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(17, -34); ctx.lineTo(4, -37); ctx.moveTo(17, -32); ctx.lineTo(4, -31); ctx.moveTo(35, -34); ctx.lineTo(48, -37); ctx.moveTo(35, -32); ctx.lineTo(48, -31); ctx.stroke(); }

const SK = [
  // 0 — KNIGHTCAT (şövalye)
  (ph, sw, air) => {
    const fur = '#9aa1a9', steel = '#b9c4d6', dark = '#8493ad';
    tail(fur, 8, ph, 0, '#4a4f57'); legs(fur, dark, sw);
    ctx.fillStyle = steel; rr(8, -36, 32, 26, 8); ctx.fillStyle = '#e3eaf5'; rr(11, -33, 5, 18, 3);
    ctx.fillStyle = '#c0392b'; rr(22, -36, 5, 26, 1); ctx.fillStyle = dark; ci_(13, -30, 2); ci_(35, -30, 2); ci_(13, -15, 2); ci_(35, -15, 2);
    ctx.fillStyle = dark; ci_(11, -35, 7);
    ctx.fillStyle = fur; ci_(26, -40, 13);
    tri(9, -52, 9, -72, 23, -60); tri(43, -52, 43, -72, 29, -60);
    ctx.fillStyle = '#ffb3c1'; tri(12, -56, 12, -66, 19, -60); tri(40, -56, 40, -66, 33, -60);
    ctx.fillStyle = steel; ctx.beginPath(); ctx.arc(26, -46, 18, Math.PI, 0); ctx.fill(); rr(8, -47, 36, 5, 2); rr(8, -46, 7, 16, 3); rr(37, -46, 7, 16, 3);
    ctx.fillStyle = dark; rr(24, -50, 4, 15, 1);
    ctx.fillStyle = '#e8f06a'; ci_(19, -40, 5.5); ci_(33, -40, 5.5);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(20.5, -39, 1.8, 3.4, 0, 0, 7); ctx.ellipse(34.5, -39, 1.8, 3.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = fur; rr(12, -47, 14, 6.5, 0); rr(30, -47, 14, 6.5, 0);
    ctx.fillStyle = '#ff7a9a'; ci_(26, -34, 2.2); whisk('#fff');
    ctx.fillStyle = '#e8453c'; ctx.beginPath(); ctx.moveTo(26, -64); ctx.quadraticCurveTo(14, -82 - Math.sin(ph * 14) * 3, 0, -64); ctx.quadraticCurveTo(14, -68, 26, -58); ctx.fill();
    ctx.fillStyle = '#e6eef9'; rr(42, -52, 5, 30, 2); ctx.fillStyle = '#ffd24a'; rr(37, -26, 15, 4, 1); rr(42, -22, 5, 8, 2);
  },
  // 1 — AŞKO CAT (tatlı pembe prenses kedi)
  (ph, sw) => {
    const fur = '#ffe0ea', pink = '#ff8fb8', hot = '#ff4f8b';
    tail(fur, 10, ph, hot, 0);
    legs(fur, pink, sw, 4);
    // elbise + tutu
    ctx.fillStyle = '#ffc2da'; ctx.beginPath(); ctx.moveTo(8, -24); ctx.lineTo(44, -24); ctx.lineTo(52, -9); ctx.lineTo(-4, -9); ctx.fill();
    ctx.fillStyle = '#ffa6cb'; for (let i = 0; i < 5; i++) ci_(-1 + i * 13, -9, 6);
    ctx.fillStyle = pink; rr(8, -36, 32, 20, 8); ctx.fillStyle = '#fff'; rr(10, -36, 28, 5, 3);
    ctx.fillStyle = hot; heart(24, -24, 4.4);
    // kulaklar (kafanın arkasından, dik ve sivri)
    ctx.fillStyle = fur; tri(7, -46, 8, -75, 26, -54); tri(45, -46, 44, -75, 26, -54);
    ctx.fillStyle = pink; tri(11, -52, 11, -68, 21, -57); tri(41, -52, 41, -68, 31, -57);
    // yuvarlak, geniş kedi kafası
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(26, -41, 18, 14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3f7'; ctx.beginPath(); ctx.ellipse(26, -34.5, 8, 5.5, 0, 0, 7); ctx.fill();
    // taç
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(18, -52); ctx.lineTo(18, -61); ctx.lineTo(22, -56); ctx.lineTo(26, -64); ctx.lineTo(30, -56); ctx.lineTo(34, -61); ctx.lineTo(34, -52); ctx.fill();
    ctx.fillStyle = hot; ci_(26, -56, 2);
    // gözler, yanaklar, burun, ağız, bıyıklar
    ctx.fillStyle = '#2a1a2a'; ctx.beginPath(); ctx.ellipse(18.5, -42, 2.7, 4, 0, 0, 7); ctx.ellipse(33.5, -42, 2.7, 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ci_(17.6, -43.6, 1.2); ci_(32.6, -43.6, 1.2);
    ctx.fillStyle = 'rgba(255,90,140,.4)'; ci_(11.5, -36, 3.4); ci_(40.5, -36, 3.4);
    ctx.fillStyle = '#ff6f9f'; tri(24, -37.5, 28, -37.5, 26, -34.8);
    ctx.strokeStyle = '#d9568a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(26, -34.8); ctx.lineTo(26, -33); ctx.moveTo(22.5, -32.5); ctx.quadraticCurveTo(24.3, -30.3, 26, -33); ctx.quadraticCurveTo(27.7, -30.3, 29.5, -32.5); ctx.stroke();
    ctx.strokeStyle = '#c98ba6'; ctx.lineWidth = 1.1; ctx.beginPath();
    [[-38, -41], [-36, -36], [-34, -31]].forEach(w => { ctx.moveTo(13, w[0]); ctx.lineTo(0, w[1]); ctx.moveTo(39, w[0]); ctx.lineTo(52, w[1]); }); ctx.stroke();
    // fiyonklu yaka
    ctx.fillStyle = hot; tri(26, -27, 15, -33, 15, -22); tri(26, -27, 37, -33, 37, -22); ci_(26, -27, 3.2); ctx.fillStyle = '#fff'; ci_(25.2, -28, 1);
    // sihirli değnek
    ctx.fillStyle = '#ff8fb8'; rr(44, -50, 4, 28, 2); ctx.fillStyle = '#ffd24a'; star(46, -54, 8 + Math.sin(ph * 8) * 1.2, ph * 2);
    ctx.fillStyle = '#fff'; const tw = Math.sin(ph * 6); star(60, -64, 3 + tw, 0); star(-8, -70, 2.4 - tw, 0); star(58, -36, 2.2 + tw, 0);
  },
  // 2 — TARÇIN (kahraman tekir şövalye)
  (ph, sw) => {
    const fur = '#8a6a44', str = '#2a1c12', lite = '#cdb088', arm = '#2f3a4e', gold = '#e6b33a';
    // pelerin
    ctx.fillStyle = '#8a2234'; ctx.beginPath(); ctx.moveTo(12, -38); ctx.quadraticCurveTo(-24, -30 - Math.sin(ph * 10) * 6, -28, -4 + Math.sin(ph * 7) * 3); ctx.lineTo(-10, -9 + Math.sin(ph * 9) * 2); ctx.lineTo(-16, -2); ctx.lineTo(8, -12); ctx.fill();
    tail(fur, 12, ph, 0, str);
    legs(fur, arm, sw, 2); ctx.fillStyle = gold; rr(11 + sw, -8, 12, 2, 1); rr(27 - sw, -8, 12, 2, 1);
    // zırh
    ctx.fillStyle = arm; rr(8, -36, 32, 26, 6); ctx.fillStyle = gold; rr(10, -14, 28, 2.5, 1); rr(8, -36, 32, 3, 1);
    ci_(24, -25, 5.5); ctx.fillStyle = arm; ci_(24, -25, 3.6); ctx.fillStyle = gold; star(24, -25, 3, 0);
    ctx.fillStyle = arm; ci_(11, -35, 7); ci_(41, -35, 7); ctx.fillStyle = gold; ci_(11, -35, 2.2); ci_(41, -35, 2.2);
    // tüylü kafa
    ctx.fillStyle = fur; ctx.beginPath(); [[8, -42, -1, -38, 9, -34], [44, -42, 53, -38, 43, -34], [14, -29, 13, -22, 20, -29], [38, -29, 39, -22, 32, -29]].forEach(t => { ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); ctx.lineTo(t[4], t[5]); }); ctx.fill();
    tri(8, -48, 7, -72, 24, -58); tri(44, -48, 45, -72, 28, -58);
    ctx.fillStyle = lite; tri(11, -54, 11, -66, 19, -58); tri(41, -54, 41, -66, 33, -58);
    ctx.fillStyle = fur; ci_(26, -41, 14);
    ctx.fillStyle = lite; ctx.beginPath(); ctx.ellipse(26, -33, 8, 5.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = str; rr(21, -54, 2.4, 7, 1); rr(25, -55, 2.4, 9, 1); rr(29, -54, 2.4, 7, 1); rr(10, -41, 5, 2, 1); rr(10, -37, 4, 2, 1); rr(37, -41, 5, 2, 1); rr(38, -37, 4, 2, 1);
    // miğfer (altın tepelikli)
    ctx.fillStyle = arm; ctx.beginPath(); ctx.arc(26, -46, 14.5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill(); rr(11, -48, 30, 4, 2);
    ctx.fillStyle = gold; tri(21, -59, 26, -74, 31, -59); ctx.fillStyle = '#8a2234'; tri(24, -62, 26, -70, 28, -62);
    // gözler: sıcak amber, kararlı ve cesur
    ctx.fillStyle = '#ffc83a'; ci_(19, -41, 5); ci_(33, -41, 5);
    ctx.fillStyle = '#1a1208'; ctx.beginPath(); ctx.ellipse(19.5, -41, 1.6, 3.8, 0, 0, 7); ctx.ellipse(33.5, -41, 1.6, 3.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ci_(18, -43, 1.1); ci_(32, -43, 1.1);
    ctx.strokeStyle = str; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(13, -47.5); ctx.lineTo(23, -45); ctx.moveTo(39, -47.5); ctx.lineTo(29, -45); ctx.stroke();
    ctx.fillStyle = '#c4636f'; tri(24, -36.5, 28, -36.5, 26, -34); ctx.strokeStyle = '#6a3a2a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(26, -33.6, 3.6, .25, Math.PI - .25); ctx.stroke();
    whisk('#e9e1d2');
    // kahraman kılıcı
    ctx.fillStyle = gold; rr(37, -27, 16, 4, 1); rr(43, -23, 4, 9, 2);
    ctx.save(); ctx.shadowColor = '#7cf0ff'; ctx.shadowBlur = 8; ctx.fillStyle = '#e9f4ff'; rr(42.5, -58, 5, 31, 2); tri(42.5, -58, 47.5, -58, 45, -66); ctx.restore();
  },
  // 3 — LEYDİ (tuxedo)
  (ph, sw) => {
    const blk = '#25252e', rim = '#4a4a5a', wht = '#f7f7f7';
    tail(blk, 8, ph, wht, 0); legs(blk, wht, sw, 3);
    ctx.fillStyle = blk; rr(8, -36, 32, 26, 8);
    ctx.fillStyle = wht; ctx.beginPath(); ctx.ellipse(24, -23, 8, 12, 0, 0, 7); ctx.fill();
    // kulaklar: kafanın arkasından, tabanları kafaya gömülü; açık kenar çizgisi ve pembe iç
    ctx.lineJoin = 'round'; ctx.strokeStyle = rim; ctx.lineWidth = 1.6; ctx.fillStyle = blk;
    [[[8, -44], [9, -73], [26, -54]], [[44, -44], [43, -73], [26, -54]]].forEach(t => { ctx.beginPath(); ctx.moveTo(t[0][0], t[0][1]); ctx.lineTo(t[1][0], t[1][1]); ctx.lineTo(t[2][0], t[2][1]); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = '#ffb3c1'; tri(12, -51, 12, -66, 21, -56); tri(40, -51, 40, -66, 31, -56);
    ctx.fillStyle = blk; ctx.beginPath(); ctx.ellipse(26, -41, 17, 13.5, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = wht; ctx.beginPath(); ctx.ellipse(26, -34, 8, 6, 0, 0, 7); ctx.fill(); tri(24.5, -53, 27.5, -53, 26, -38);
    // inci kolye
    ctx.fillStyle = '#fff'; for (let i = 0; i < 7; i++) { const a = Math.PI * (.15 + i * .12); ci_(24 + Math.cos(a) * 12, -28 + Math.sin(a) * 4 + 1, 1.9); }
    // gözler
    ctx.fillStyle = '#8ee66a'; ci_(19, -42, 5); ci_(33, -42, 5);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(19.5, -42, 1.5, 3.6, 0, 0, 7); ctx.ellipse(33.5, -42, 1.5, 3.6, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(14.5, -44.5); ctx.lineTo(11.5, -47); ctx.moveTo(15, -46) ; ctx.lineTo(13.5, -49.5); ctx.moveTo(37.5, -44.5); ctx.lineTo(40.5, -47); ctx.moveTo(37, -46); ctx.lineTo(38.5, -49.5); ctx.stroke();
    ctx.fillStyle = '#ff7a9a'; ci_(26, -35.5, 2); whisk('#fff');
    // çiçek (sağ kulağın dibinde)
    ctx.fillStyle = '#ff6fa3'; for (let i = 0; i < 5; i++) { const a = i * 1.2566; ci_(37 + Math.cos(a) * 3.2, -57 + Math.sin(a) * 3.2, 2.5); } ctx.fillStyle = '#ffd24a'; ci_(37, -57, 1.9);
    // şemsiye
    ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(40, -27); ctx.lineTo(52, -30); ctx.stroke();
    ctx.fillStyle = '#5a3a1a'; rr(51, -58, 3, 36, 1);
    ctx.fillStyle = '#b13fc0'; ctx.beginPath(); ctx.arc(52.5, -56, 18, Math.PI, 0); for (let i = 0; i < 3; i++) ctx.arc(52.5 + 12 - i * 12, -56, 6, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#e6a2ee'; ctx.beginPath(); ctx.moveTo(52.5, -74); ctx.lineTo(46, -57); ctx.lineTo(52.5, -56); ctx.fill();
  }
];
function cat(x, y, duck, ph, air, k) {
  ctx.save(); ctx.translate(x, y); if (duck) ctx.scale(1.2, .55);
  SK[k == null ? skin : k](ph, air ? 0 : Math.sin(ph * 14) * 7, air);
  ctx.restore();
}

function drawObs(o) {
  ctx.save(); ctx.translate(o.x, o.y);
  if (o.k === 'crate' || o.k === 'stack') for (let y = 0; y < o.h; y += 46) {
    ctx.fillStyle = '#8a5a2b'; rr(0, y, o.w, 46, 5); ctx.fillStyle = '#b57a3c'; rr(4, y + 4, o.w - 8, 38, 3);
    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(6, y + 6); ctx.lineTo(o.w - 6, y + 40); ctx.moveTo(o.w - 6, y + 6); ctx.lineTo(6, y + 40); ctx.stroke();
  }
  else if (o.k === 'spike') { ctx.fillStyle = '#c9d3e3'; for (let i = 0; i < 3; i++) tri(i * 19, o.h, i * 19 + 9.5, 0, i * 19 + 19, o.h); ctx.fillStyle = '#e8453c'; rr(0, o.h - 6, o.w, 6, 2); }
  else { const f = Math.sin(clock * 18) * 14;
    ctx.fillStyle = '#6a3fb0'; tri(26, 12, 4, -10 + f, 12, 22); tri(26, 12, 48, -10 + f, 40, 22);
    ctx.fillStyle = '#4b2a85'; ctx.beginPath(); ctx.ellipse(26, 16, 13, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff4d4d'; ci_(21, 14, 3); ci_(31, 14, 3); ctx.fillStyle = '#fff'; tri(21, 21, 23, 26, 25, 21); tri(27, 21, 29, 26, 31, 21); }
  ctx.restore();
}
function drawBG() {
  let g = ctx.createLinearGradient(0, 0, 0, G); g.addColorStop(0, '#5ab8ff'); g.addColorStop(1, '#d9f2ff'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff6a8'; ci_(800, 90, 45);
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  for (let i = 0; i < 4; i++) { const x = ((i * 300 - bgOff * .08) % 1200 + 1200) % 1200 - 150, y = 60 + i * 35; ci_(x, y, 22); ci_(x + 28, y - 8, 28); ci_(x + 60, y, 22); }
  [['#8fd694', .15, 90, 40], ['#5fbf77', .4, 55, 28]].forEach(([c, f, b, a]) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, G - b - Math.sin((x + bgOff * f) / 120) * a);
    ctx.lineTo(W, H); ctx.fill();
  });
  ctx.fillStyle = '#7a4b2a'; ctx.fillRect(0, G, W, H - G); ctx.fillStyle = '#4cc35a'; ctx.fillRect(0, G, W, 14);
  ctx.fillStyle = '#5e3a1f'; for (let x = -((bgOff) % 80); x < W; x += 80) rr(x, G + 40, 40, 8, 4);
}
function drawItems() {
  coins.forEach(c => { ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 12 * Math.abs(Math.cos(clock * 5 + c.x / 40)) + 2, 12, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#d99a00'; ctx.lineWidth = 3; ctx.stroke(); });
  pups.forEach(u => { ctx.fillStyle = u.k === 's' ? '#3ab8e8' : '#ffb400'; ci_(u.x, u.y + Math.sin(clock * 5) * 4, 18);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(u.k === 's' ? 'K' : 'x2', u.x, u.y + 6 + Math.sin(clock * 5) * 4); });
}

// ================= ANA DÖNGÜ =================
let lastBoard = 0;
function frame(ts) {
  const dt = Math.min(.033, (ts - last) / 1000 || 0); last = ts; clock += dt;
  if (st === 'play') { if (!portraitPhone.matches) update(dt); }
  else if (st === 'count') {
    ct += dt; const i = Math.floor(ct / .8);
    if (i !== ci && i < 4) { ci = i; const n = $('cnum'); n.textContent = ['3', '2', '1', 'HAYDİ!'][i]; n.style.fontSize = i === 3 ? '17cqw' : ''; n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; beep(i < 3 ? 440 : 880, .2, 'square'); }
    if (ct >= 3.2) { setStage('play'); musicStart(); }
  }
  if (st === 'name' || st === 'welcome' || st === 'hand') bgOff += 120 * dt; else if (st === 'play') bgOff += speed * dt;
  parts.forEach(q => { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 600 * dt; q.l -= dt; }); parts = parts.filter(q => q.l > 0);
  shake = Math.max(0, shake - dt);
  ctx.save(); if (shake) ctx.translate((Math.random() - .5) * shake * 40, (Math.random() - .5) * shake * 40);
  if (st === 'char') drawPreviews();
  drawBG(); drawItems(); obs.forEach(drawObs);
  if (st !== 'dead' && st !== 'over') {
    cat(PX, p.y, p.duck, clock, p.y < G);
    if (shield > 0 && (shield > 2 || Math.sin(clock * 20) > 0)) { ctx.strokeStyle = 'rgba(80,200,255,.9)'; ctx.fillStyle = 'rgba(80,200,255,.25)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(PX + 26, p.y - 30, 44, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  if (st === 'play') drawFx();
  parts.forEach(q => { ctx.globalAlpha = Math.min(1, q.l * 2); ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.s, q.s); }); ctx.globalAlpha = 1;
  ctx.restore();
  $('sc').textContent = Math.floor(sc); $('hi').textContent = bestScore(); $('di').textContent = Math.floor(dist / 50) + ' m';
  $('bd').textContent = (shield > 0 ? '🛡 KALKAN  ' : '') + (dbl > 0 ? '⭐ x2 ' + Math.ceil(dbl) + 'sn' : '');
  if (ts - lastBoard > 120) { lastBoard = ts; refreshBoards(); }
  requestAnimationFrame(frame);
}

if (location.hash === '#debug') window.__kc = { celebrate: n => { passed = n || 5; celebrate(); }, setSkin: k => { skin = k; }, meow: () => meow(), purrStart, purrStop, stage: () => st, beginRun, pass: () => passed };
if (coarse) $('kbBtn').textContent = 'DOKUNARAK OYNA';
// ================= BAŞLAT =================
refreshBoards(true);
setStage('name');
setTimeout(() => $('nm').focus(), 100);
try { setSide(localStorage.getItem('kcSide') || 'left', true); } catch (e) { setSide('left', true); }
recover('all'); camLoop();
requestAnimationFrame(frame);
})();
