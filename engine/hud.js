// ---- st_stuff.c / hu_stuff.c / am_map.c / wi_stuff.c / f_finale.c / f_wipe.c : 2D screens ----
const HUD = { automap: false, amscale: 0.2, msg: null, msgtics: 0, face: 'STFST01', facecount: 0, priority: 0, oldhealth: -1,
  oldweapons: null, lastattackdown: -1, randomnumber: 0 };

function drawPatch(x, y, p, fb = R.fb) {
  if (!p) return;
  x -= p.lo; y -= p.to;
  for (let c = 0; c < p.w; c++) {
    const sx = x + c; if (sx < 0 || sx >= SCREENWIDTH) continue;
    const base = c * p.h;
    for (let r = 0; r < p.h; r++) {
      const sy = y + r; if (sy < 0 || sy >= SCREENHEIGHT) continue;
      const v = p.px[base + r]; if (v >= 0) fb[sy * SCREENWIDTH + sx] = v;
    }
  }
}
const pat = n => gfx.patch(n);

// HU font (STCFN033..STCFN095)
function drawText(x, y, text) {
  const x0 = x;
  for (const ch of text.toUpperCase()) {
    if (ch === '\n') { x = x0; y += 11; continue; }
    const c = ch.charCodeAt(0);
    if (c < 33 || c > 95) { x += 4; continue; }
    const p = pat('STCFN' + String(c).padStart(3, '0'));
    if (!p) { x += 4; continue; }
    if (x + p.w > SCREENWIDTH) break;
    drawPatch(x, y, p); x += p.w;
  }
}
function textWidth(t) { let w = 0; for (const ch of t.toUpperCase()) { const c = ch.charCodeAt(0); const p = c >= 33 && c <= 95 ? pat('STCFN' + String(c).padStart(3, '0')) : null; w += p ? p.w : 4; } return w; }

// ---- status bar ----
function stNum(x, y, n, digits, prefix) {
  const p0 = pat(prefix + '0'), w = p0.w;
  if (n === 0) { drawPatch(x - w, y, p0); return; }
  n = Math.max(0, Math.min(n, 10 ** digits - 1));
  while (n && digits--) { x -= w; drawPatch(x, y, pat(prefix + (n % 10))); n = Math.floor(n / 10); }
}
function painOffset(pl) { const h = Math.min(100, pl.health); return 4 - Math.floor(h * 5 / 101); }
function updateFace(pl) {
  const po = painOffset(pl);
  if (!HUD.oldweapons) HUD.oldweapons = pl.weaponowned.slice();
  if (HUD.priority < 10 && !pl.health) { HUD.priority = 9; HUD.face = 'STFDEAD0'; HUD.facecount = 1; }
  if (HUD.priority < 9 && pl.bonuscount) {
    let grin = false;
    for (let i = 0; i < 9; i++) if (HUD.oldweapons[i] !== pl.weaponowned[i]) { grin = true; HUD.oldweapons[i] = pl.weaponowned[i]; }
    if (grin) { HUD.priority = 8; HUD.facecount = 2 * TICRATE; HUD.face = 'STFEVL' + po; }
  }
  if (HUD.priority < 8 && pl.damagecount && pl.attacker && pl.attacker !== pl.mo) {
    HUD.priority = 7;
    if (HUD.oldhealth - pl.health > 20) HUD.face = 'STFOUCH' + po;
    else {
      const a = pointToAngle(pl.mo.x, pl.mo.y, pl.attacker.x, pl.attacker.y), d = normAngle(a - pl.mo.angle);
      if (d < ANG45 || d > TAU - ANG45) HUD.face = 'STFKILL' + po;
      else HUD.face = (d < ANG180 ? 'STFTL' : 'STFTR') + po + '0';
    }
    HUD.facecount = TICRATE;
  }
  if (HUD.priority < 7 && pl.damagecount) {
    HUD.priority = 6;
    HUD.face = HUD.oldhealth - pl.health > 20 ? 'STFOUCH' + po : 'STFKILL' + po;
    HUD.facecount = TICRATE;
  }
  if (HUD.priority < 6) {
    if (pl.attackdown) {
      if (HUD.lastattackdown === -1) HUD.lastattackdown = 2 * TICRATE;
      else if (!--HUD.lastattackdown) { HUD.priority = 5; HUD.face = 'STFKILL' + po; HUD.facecount = 1; HUD.lastattackdown = 1; }
    } else HUD.lastattackdown = -1;
  }
  if (HUD.priority < 5 && ((pl.cheats & CF_GODMODE) || pl.powers[pw_invulnerability])) { HUD.priority = 4; HUD.face = 'STFGOD0'; HUD.facecount = 1; }
  if (!HUD.facecount) { HUD.face = 'STFST' + po + (M_Random() % 3); HUD.facecount = TICRATE / 2; HUD.priority = 0; }
  HUD.facecount--;
  HUD.oldhealth = pl.health;
}
function drawStatusBar(pl) {
  drawPatch(0, 168, pat('STBAR'));
  drawPatch(104, 168, pat('STARMS'));
  const ammo = INFO.weapons[pl.readyweapon].ammo;
  if (ammo !== am_noammo) stNum(44, 171, pl.ammo[ammo], 3, 'STTNUM');
  stNum(90, 171, pl.health, 3, 'STTNUM'); drawPatch(90, 171, pat('STTPRCNT'));
  stNum(221, 171, pl.armorpoints, 3, 'STTNUM'); drawPatch(221, 171, pat('STTPRCNT'));
  for (let i = 0; i < 6; i++) drawPatch(111 + (i % 3) * 12, 172 + Math.floor(i / 3) * 10, pat((pl.weaponowned[i + 1] ? 'STYSNUM' : 'STGNUM') + (i + 2)));
  drawPatch(143, 168, pat(HUD.face));
  for (let i = 0; i < 3; i++) {
    let k = pl.cards[i] ? i : -1;
    if (pl.cards[i + 3]) k = i + 3;
    if (k >= 0) drawPatch(239, 171 + i * 10, pat('STKEYS' + k));
  }
  const rows = [173, 179, 191, 185];
  for (let i = 0; i < 4; i++) { stNum(288, rows[i], pl.ammo[i], 3, 'STYSNUM'); stNum(314, rows[i], pl.maxammo[i], 3, 'STYSNUM'); }
}
function hudTicker(pl) {
  if (pl.message) { HUD.msg = pl.message; HUD.msgtics = 4 * TICRATE; pl.message = null; }
  else if (HUD.msgtics) HUD.msgtics--;
  updateFace(pl);
}
function drawMessages() { if (HUD.msgtics && HUD.msg) drawText(0, 0, HUD.msg); }

// ---- automap ----
function amLine(x1, y1, x2, y2, color) {
  const fb = R.fb, vh = R.viewheight;
  let dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const n = Math.min(2000, Math.ceil(Math.max(dx, dy)) + 1);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0, x = Math.round(x1 + (x2 - x1) * t), y = Math.round(y1 + (y2 - y1) * t);
    if (x >= 0 && x < SCREENWIDTH && y >= 0 && y < vh) fb[y * SCREENWIDTH + x] = color;
  }
}
function drawAutomap(pl) {
  const vh = R.viewheight, s = HUD.amscale, cx = pl.mo.x, cy = pl.mo.y;
  R.fb.fill(0, 0, vh * SCREENWIDTH);
  const tx = x => SCREENWIDTH / 2 + (x - cx) * s, ty = y => vh / 2 - (y - cy) * s;
  const allmap = pl.powers[pw_allmap];
  for (const ln of level.lines) {
    let col = -1;
    if (pl.cheats & 8 || (ln.flags & ML_MAPPED)) {
      if (ln.flags & ML_DONTDRAW && !(pl.cheats & 8)) continue;
      if (!ln.backsector) col = 176;
      else if (ln.special === 39) col = 184;
      else if (ln.flags & ML_SECRET) col = 176;
      else if (ln.backsector.floorheight !== ln.frontsector.floorheight) col = 64;
      else if (ln.backsector.ceilingheight !== ln.frontsector.ceilingheight) col = 231;
      else if (pl.cheats & 8) col = 99;
    } else if (allmap && !(ln.flags & ML_DONTDRAW)) col = 99;
    if (col >= 0) amLine(tx(ln.v1.x), ty(ln.v1.y), tx(ln.v2.x), ty(ln.v2.y), col);
  }
  // player arrow (am_map.c player_arrow)
  const arrow = [[-0.875, 0, 1, 0], [1, 0, 0.5, 0.25], [1, 0, 0.5, -0.25], [-0.875, 0, -1.125, 0.25], [-0.875, 0, -1.125, -0.25], [-0.625, 0, -0.875, 0.25], [-0.625, 0, -0.875, -0.25]];
  const a = pl.mo.angle, c = Math.cos(a), sn = Math.sin(a), L = 16 * 1.0;
  for (const [x1, y1, x2, y2] of arrow) {
    const r = (x, y) => [cx + (x * c - y * sn) * L * 2, cy + (x * sn + y * c) * L * 2];
    const [ax, ay] = r(x1, y1), [bx, by] = r(x2, y2);
    amLine(tx(ax), ty(ay), tx(bx), ty(by), 209);
  }
  const name = TXT['HUSTR_E' + G.episode + 'M' + G.map];
  if (name) drawText(0, vh - 10, name);
}

// ---- intermission (wi_stuff.c, single player) ----
const PARS = [[0], [0, 30, 75, 120, 90, 165, 180, 180, 30, 165], [0, 90, 90, 90, 120, 90, 360, 240, 30, 170], [0, 90, 45, 90, 150, 90, 90, 165, 30, 135]];
const WI = { stage: 0, cnt: [0, 0, 0, 0, 0], target: [0, 0, 0, 0, 0], tics: 0, done: false };
function startIntermission(stats) {
  WI.stage = 0; WI.cnt = [-1, -1, -1, -1, -1]; WI.target = stats; WI.tics = 0; WI.done = false; WI.entering = false;
}
function wiNum(x, y, n, digits) {
  const w = pat('WINUM0').w;
  if (digits < 0) digits = n === 0 ? 1 : String(n).length;
  while (digits--) { x -= w; drawPatch(x, y, pat('WINUM' + (n % 10))); n = Math.floor(n / 10); }
  return x;
}
function wiPercent(x, y, p) { if (p < 0) return; drawPatch(x, y, pat('WIPCNT')); wiNum(x, y, p, -1); }
function wiTime(x, y, t) {
  if (t < 0) return;
  let div = 1;
  do {
    const n = Math.floor(t / div) % 60;
    x = wiNum(x, y, n, 2) - pat('WICOLON').w;
    div *= 60;
    if (div === 60 || Math.floor(t / div)) drawPatch(x, y, pat('WICOLON'));
  } while (Math.floor(t / div));
}
function intermissionTicker(pressed) {
  WI.tics++;
  if (WI.entering) { if (pressed || WI.tics > 4 * TICRATE) WI.done = true; return; }
  if (pressed) {
    if (WI.stage < 5) { WI.cnt = WI.target.slice(); WI.stage = 5; S_StartSound(null, SFX.barexp); return; }
    WI.entering = true; WI.tics = 0; S_StartSound(null, SFX.sgcock); return;
  }
  if (WI.stage >= 5 || (WI.tics & 1)) return;
  const st = WI.stage, step = st < 3 ? 2 : 3;
  if (WI.cnt[st] < 0) WI.cnt[st] = 0;
  WI.cnt[st] += st < 3 ? step : step;
  if (!(WI.tics & 3)) S_StartSound(null, SFX.pistol);
  if (WI.cnt[st] >= WI.target[st]) { WI.cnt[st] = WI.target[st]; S_StartSound(null, SFX.barexp); WI.stage++; }
}
function drawIntermission(nextmap) {
  const e = G.episode, bg = pat('WIMAP' + (e - 1)) || pat('INTERPIC');
  drawPatch(0, 0, bg);
  const lv = m => pat('WILV' + (e - 1) + (m - 1));
  if (!WI.entering) {
    const ln = lv(G.map);
    if (ln) drawPatch((SCREENWIDTH - ln.w) >> 1, 2, ln);
    const fin = pat('WIF'); if (fin) drawPatch((SCREENWIDTH - fin.w) >> 1, 2 + (ln ? (5 * ln.h) >> 2 : 20), fin);
    const lh = (3 * pat('WINUM0').h) >> 1;
    drawPatch(50, 50, pat('WIOSTK')); wiPercent(SCREENWIDTH - 50, 50, WI.cnt[0]);
    drawPatch(50, 50 + lh, pat('WIOSTI')); wiPercent(SCREENWIDTH - 50, 50 + lh, WI.cnt[1]);
    drawPatch(50, 50 + 2 * lh, pat('WISCRT2')); wiPercent(SCREENWIDTH - 50, 50 + 2 * lh, WI.cnt[2]);
    drawPatch(16, 168, pat('WITIME')); wiTime(SCREENWIDTH / 2 - 16, 168, WI.cnt[3]);
    drawPatch(SCREENWIDTH / 2 + 16, 168, pat('WIPAR')); wiTime(SCREENWIDTH - 16, 168, WI.cnt[4]);
  } else if (nextmap) {
    const en = pat('WIENTER'); if (en) drawPatch((SCREENWIDTH - en.w) >> 1, 2, en);
    const ln = lv(nextmap); if (ln) drawPatch((SCREENWIDTH - ln.w) >> 1, 2 + (en ? (5 * en.h) >> 2 : 20), ln);
  }
}

// ---- finale text (f_finale.c) ----
const FIN = { text: '', flat: '', tics: 0 };
function startFinale() {
  const e = G.episode;
  FIN.text = TXT['E' + e + 'TEXT'] || ''; FIN.flat = ['FLOOR4_8', 'SFLR6_1', 'MFLR8_4', 'MFLR8_3'][e - 1] || 'FLOOR4_8'; FIN.tics = 0;
}
function drawFinale() {
  const f = gfx.flat(gfx.flatNum(FIN.flat)), fb = R.fb;
  for (let y = 0; y < SCREENHEIGHT; y++) for (let x = 0; x < SCREENWIDTH; x++) fb[y * SCREENWIDTH + x] = f[(y & 63) * 64 + (x & 63)];
  const n = Math.max(0, Math.floor((FIN.tics - 10) / 3));
  drawText(10, 10, FIN.text.slice(0, n));
}

// ---- screen melt (f_wipe.c) ----
const WIPE = { active: false, start: null, end: null, y: null };
function startWipe(startScreen) {
  WIPE.active = true; WIPE.start = startScreen.slice(); WIPE.y = new Int32Array(SCREENWIDTH / 2);
  WIPE.y[0] = -(M_Random() % 16);
  for (let i = 1; i < WIPE.y.length; i++) { const r = (M_Random() % 3) - 1; WIPE.y[i] = Math.max(-15, Math.min(0, WIPE.y[i - 1] + r)); }
}
// composite: R.fb holds the new screen; draws the melting old screen on top
function wipeStep(out) {
  let done = true;
  const nw = R.fb, old = WIPE.start;
  out.set(nw);
  for (let i = 0; i < WIPE.y.length; i++) {
    let y = WIPE.y[i];
    if (y < 0) { WIPE.y[i]++; done = false; y = 0; }
    else if (y < SCREENHEIGHT) { const dy = y < 16 ? y + 1 : 8; WIPE.y[i] = Math.min(SCREENHEIGHT, y + dy); done = false; }
    y = Math.max(0, WIPE.y[i]);
    for (let r = y; r < SCREENHEIGHT; r++) for (let k = 0; k < 2; k++) out[r * SCREENWIDTH + i * 2 + k] = old[(r - y) * SCREENWIDTH + i * 2 + k];
  }
  if (done) WIPE.active = false;
}
