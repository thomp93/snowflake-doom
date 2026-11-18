// ---- g_game.c / d_main.c / st_stuff.c palette / m_cheat.c : game flow, input, browser glue ----
let wad = null, gamestate = 'title', paused = false, nextmapnum = 0, wipeOut = null;

function bootData(bytes) {
  wad = new Wad(bytes);
  gfx = new GfxData(wad);
  bindActions();
  initSwitchList();
  initPicAnims();
  if (!wad.lumps.some(l => /^E\dM\d$/.test(l.name))) throw new Error('This WAD has no ExMy maps (only Doom 1 WADs like DOOM.WAD / DOOM1.WAD are supported)');
}

// G_InitNew
function initNew(skill, episode, map) {
  G.skill = skill; G.episode = episode; G.map = map;
  prndindex = rndindex = 0;
  players = [newPlayer()];
  doLoadLevel();
}
// G_DoLoadLevel + P_SetupLevel
function doLoadLevel() {
  const name = 'E' + G.episode + 'M' + G.map;
  level = loadLevel(wad, gfx, name);
  mobjs = []; thinkers = [];
  G.leveltime = 0; G.totalkills = G.totalitems = G.totalsecret = 0; G.exit = null;
  R.skytexture = gfx.texNum(['SKY1', 'SKY2', 'SKY3', 'SKY4'][G.episode - 1] || 'SKY1');
  const pl = players[0];
  pl.killcount = pl.itemcount = pl.secretcount = 0;
  const bit = G.skill === sk_baby ? 1 : G.skill === sk_nightmare ? 4 : 1 << (G.skill - 1);
  for (const mt of level.things) {
    if (mt.type === 11 || (mt.type >= 2 && mt.type <= 4)) continue;
    if (mt.type === 1) { spawnPlayer(mt); continue; }
    if (mt.options & 16) continue;                 // multiplayer only
    if (!(mt.options & bit)) continue;
    const i = INFO.mobjinfo.findIndex(m => m.doomednum === mt.type);
    if (i < 0) continue;
    const info = INFO.mobjinfo[i];
    const mo = spawnMobj(mt.x, mt.y, info.flags & MF_SPAWNCEILING ? ONCEILINGZ : ONFLOORZ, i);
    mo.spawnpoint = mt;
    if (mo.tics > 0) mo.tics = 1 + (P_Random() % mo.tics);
    if (mo.flags & MF_COUNTKILL) G.totalkills++;
    if (mo.flags & MF_COUNTITEM) G.totalitems++;
    mo.angle = normAngle(ANG45 * Math.floor(mt.angle / 45));
    if (mt.options & 8) mo.flags |= MF_AMBUSH;
  }
  spawnSpecials();
  HUD.automap = false; HUD.msgtics = 0; HUD.oldweapons = null; HUD.priority = 0; HUD.facecount = 0; HUD.oldhealth = pl.health;
  gamestate = 'level';
}
function exitLevel(secret) { G.exit = { secret }; }

// G_DoCompleted -> intermission
function doCompleted() {
  const pl = players[0], secret = G.exit.secret;
  G.exit = null;
  playerFinishLevel(pl);
  const e = G.episode, m = G.map;
  if (secret) nextmapnum = 9;
  else if (m === 9) nextmapnum = { 1: 4, 2: 6, 3: 7, 4: 3 }[e];
  else nextmapnum = m + 1;
  const pct = (n, t) => t ? Math.floor(n * 100 / t) : 100;
  startIntermission([pct(pl.killcount, G.totalkills), pct(pl.itemcount, G.totalitems), pct(pl.secretcount, G.totalsecret),
    Math.floor(G.leveltime / TICRATE), (PARS[e] || [])[m] || 0]);
  if (m === 8 && !secret) nextmapnum = 0;      // episode end
  gamestate = 'intermission';
}

// ---- input -> ticcmd (G_BuildTiccmd) ----
const keys = new Set();
const INPUT = { mousex: 0, mousebuttons: 0, pressed: false, weapon: -1, turnheld: 0, cheatbuf: '', mouseSens: 5 };
const FORWARDMOVE = [0x19, 0x32], SIDEMOVE = [0x18, 0x28], ANGLETURN = [640, 1280, 320];
const k = (...names) => names.some(n => keys.has(n));
function buildTiccmd(cmd) {
  const run = k('ShiftLeft', 'ShiftRight') ? 1 : 0;
  const strafe = k('AltLeft', 'AltRight');
  let forward = 0, side = 0;
  cmd.angleturn = 0; cmd.buttons = 0;
  const left = k('ArrowLeft', 'KeyA'), right = k('ArrowRight', 'KeyD');
  INPUT.turnheld = left || right ? INPUT.turnheld + 1 : 0;
  const tspeed = INPUT.turnheld < 6 ? 2 : run;
  if (strafe) { if (right) side += SIDEMOVE[run]; if (left) side -= SIDEMOVE[run]; }
  else { if (right) cmd.angleturn -= ANGLETURN[tspeed]; if (left) cmd.angleturn += ANGLETURN[tspeed]; }
  if (k('ArrowUp', 'KeyW')) forward += FORWARDMOVE[run];
  if (k('ArrowDown', 'KeyS')) forward -= FORWARDMOVE[run];
  if (k('KeyE', 'Period')) side += SIDEMOVE[run];
  if (k('KeyQ', 'Comma')) side -= SIDEMOVE[run];
  if (k('ControlLeft', 'ControlRight') || (INPUT.mousebuttons & 1)) cmd.buttons |= BT_ATTACK;
  if (k('Space') || (INPUT.mousebuttons & 4)) cmd.buttons |= BT_USE;
  if (INPUT.weapon >= 0) { cmd.buttons |= BT_CHANGE | (INPUT.weapon << BT_WEAPONSHIFT); INPUT.weapon = -1; }
  cmd.angleturn -= Math.round(INPUT.mousex * (INPUT.mouseSens + 5) / 10 * 8);
  INPUT.mousex = 0;
  cmd.forwardmove = Math.max(-0x32, Math.min(0x32, forward));
  cmd.sidemove = Math.max(-0x32, Math.min(0x32, side));
}

// m_cheat.c (single player cheats)
function checkCheat(ch) {
  const pl = players[0]; if (!pl || gamestate !== 'level') return;
  INPUT.cheatbuf = (INPUT.cheatbuf + ch.toLowerCase()).slice(-12);
  const b = INPUT.cheatbuf, hit = c => b.endsWith(c);
  if (hit('iddqd')) { pl.cheats ^= CF_GODMODE; if (pl.cheats & CF_GODMODE) { pl.health = pl.mo.health = 100; } pl.message = pl.cheats & CF_GODMODE ? TXT.STSTR_DQDON : TXT.STSTR_DQDOFF; INPUT.cheatbuf = ''; }
  else if (hit('idkfa') || hit('idfa')) {
    pl.armorpoints = 200; pl.armortype = 2;
    for (let i = 0; i < 9; i++) pl.weaponowned[i] = i !== wp_supershotgun;
    for (let i = 0; i < 4; i++) pl.ammo[i] = pl.maxammo[i];
    if (hit('idkfa')) { pl.cards.fill(true); pl.message = TXT.STSTR_KFAADDED; } else pl.message = TXT.STSTR_FAADDED;
    INPUT.cheatbuf = '';
  } else if (hit('idclip') || hit('idspispopd')) { pl.cheats ^= CF_NOCLIP; pl.message = pl.cheats & CF_NOCLIP ? TXT.STSTR_NCON : TXT.STSTR_NCOFF; INPUT.cheatbuf = ''; }
  else if (hit('iddt')) { pl.cheats ^= 8; INPUT.cheatbuf = ''; }
  else if (hit('idchoppers')) { pl.weaponowned[wp_chainsaw] = true; pl.powers[pw_invulnerability] = 1; pl.message = TXT.STSTR_CHOPPERS; INPUT.cheatbuf = ''; }
}

// ---- one game tic ----
function gameTick() {
  const pressed = INPUT.pressed; INPUT.pressed = false;
  if (WIPE.active) return;
  switch (gamestate) {
    case 'title': if (pressed) { startTransition(() => doLoadLevel()); } return;
    case 'level': {
      if (paused) return;
      const pl = players[0];
      buildTiccmd(pl.cmd);
      playerThink(pl);
      runThinkers();
      updateSpecials();
      hudTicker(pl);
      S_UpdateSounds();
      G.leveltime++;
      if (pl.playerstate === PST_REBORN) { startTransition(() => { pl.playerstate = PST_REBORN; doLoadLevel(); }); return; }
      if (G.exit) startTransition(doCompleted);
      return;
    }
    case 'intermission':
      intermissionTicker(pressed);
      if (WI.done) {
        if (!nextmapnum) { startTransition(() => { startFinale(); gamestate = 'finale'; }); }
        else startTransition(() => { G.map = nextmapnum; doLoadLevel(); });
      }
      return;
    case 'finale':
      FIN.tics++;
      if (pressed && FIN.tics > 3 * FIN.text.length / 1 + 40) startTransition(() => { gamestate = 'title'; });
      else if (pressed) FIN.tics = 3 * FIN.text.length + 40;
      return;
  }
}
// draw current screen, then begin a melt from it into the next state
function startTransition(fn) {
  drawScreen();
  const old = R.fb.slice();
  fn();
  drawScreen();
  startWipe(old);
}

// ST_doPaletteStuff
function paletteIndex(pl) {
  let cnt = pl.damagecount;
  if (pl.powers[pw_strength]) { const bzc = 12 - (pl.powers[pw_strength] >> 6); if (bzc > cnt) cnt = bzc; }
  if (cnt) return 1 + Math.min(7, (cnt + 7) >> 3);
  if (pl.bonuscount) return 9 + Math.min(3, (pl.bonuscount + 7) >> 3);
  const f = pl.powers[pw_ironfeet];
  if (f > 4 * 32 || (f & 8)) return 13;
  return 0;
}
function drawScreen() {
  let pal = 0;
  switch (gamestate) {
    case 'title': drawPatch(0, 0, pat('TITLEPIC')); break;
    case 'level': {
      const pl = players[0];
      if (HUD.automap) drawAutomap(pl); else renderPlayerView(pl);
      drawStatusBar(pl);
      drawMessages();
      if (paused) { const p = pat('M_PAUSE'); if (p) drawPatch((SCREENWIDTH - p.w) >> 1, 4, p); }
      pal = paletteIndex(pl);
      break;
    }
    case 'intermission': drawIntermission(nextmapnum); break;
    case 'finale': drawFinale(); break;
  }
  return pal;
}

// ---- browser glue ----
function startBrowser(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SCREENWIDTH, SCREENHEIGHT), px = new Uint32Array(img.data.buffer);
  wipeOut = new Uint8Array(SCREENWIDTH * SCREENHEIGHT);
  G.skill = opts.skill; G.episode = opts.episode; G.map = opts.map;
  players = [newPlayer()];
  gamestate = 'title';
  S_Init();
  const weaponKeys = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6 };
  addEventListener('keydown', e => {
    S_Resume();
    if (e.repeat && keys.has(e.code)) { e.preventDefault(); return; }
    keys.add(e.code);
    if (gamestate !== 'level' || ['Enter', 'Space', 'ControlLeft'].includes(e.code)) INPUT.pressed = true;
    if (e.code in weaponKeys) INPUT.weapon = weaponKeys[e.code];
    if (e.code === 'Tab') HUD.automap = !HUD.automap;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') HUD.amscale = Math.min(2, HUD.amscale * 1.25);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') HUD.amscale = Math.max(0.03, HUD.amscale / 1.25);
    if (e.code === 'Pause' || e.code === 'KeyP') paused = !paused;
    if (e.key.length === 1) checkCheat(e.key);
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab' || e.altKey) e.preventDefault();
  });
  addEventListener('keyup', e => { keys.delete(e.code); });
  addEventListener('blur', () => keys.clear());
  canvas.addEventListener('mousedown', e => {
    S_Resume(); canvas.focus();
    INPUT.pressed = true;
    e.preventDefault();
    // fire regardless of pointer lock: lock may be refused inside the sandboxed Streamlit iframe
    if (gamestate === 'level') INPUT.mousebuttons |= 1 << e.button;
    if (document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { } }
  });
  addEventListener('mouseup', e => { INPUT.mousebuttons &= ~(1 << e.button); });
  addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) INPUT.mousex += e.movementX; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  let last = performance.now(), acc = 0;
  const frame = now => {
    acc += Math.min(250, now - last); last = now;
    let n = 0;
    let wiping = WIPE.active;
    while (acc >= 1000 / TICRATE && n < 5) {
      if (WIPE.active) wipeStep(wipeOut); else gameTick();
      acc -= 1000 / TICRATE; n++;
    }
    let pal = 0, src = R.fb;
    if (WIPE.active || (wiping && n === 0)) src = wipeOut;
    else pal = drawScreen();
    const p = gfx.palettes[pal];
    for (let i = 0; i < src.length; i++) px[i] = p[src[i]];
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const DOOM = {
  bootData, initNew, doLoadLevel, gameTick, drawScreen, renderPlayerView, R, G, INFO, STATES, S, MT, SFX,
  get players() { return players; }, get mobjs() { return mobjs; }, get level() { return level; }, get gfx() { return gfx; },
  get gamestate() { return gamestate; }, set gamestate(v) { gamestate = v; }, keys, INPUT, HUD, WIPE, startBrowser, exitLevel, doCompleted,
};
if (typeof globalThis !== 'undefined') globalThis.DOOM = DOOM;
