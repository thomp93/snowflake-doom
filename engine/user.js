// ---- p_user.c / p_pspr.c / g_game.c (player parts) : player movement and weapons ----
const BT_ATTACK = 1, BT_USE = 2, BT_CHANGE = 4, BT_WEAPONSHIFT = 3;
const WEAPONTOP = 32, WEAPONBOTTOM = 128, LOWERSPEED = 6, RAISESPEED = 6;
const ps_weapon = 0, ps_flash = 1;

function newPlayer() {
  return {
    mo: null, playerstate: PST_REBORN, cmd: { forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 },
    viewz: 0, viewheight: VIEWHEIGHT, deltaviewheight: 0, bob: 0, health: MAXHEALTH, armorpoints: 0, armortype: 0,
    powers: new Int32Array(6), cards: new Array(6).fill(false), backpack: false, weaponowned: new Array(9).fill(false),
    ammo: [0, 0, 0, 0], maxammo: MAXAMMO.slice(), readyweapon: wp_pistol, pendingweapon: wp_pistol,
    attackdown: false, usedown: false, cheats: 0, refire: 0, killcount: 0, itemcount: 0, secretcount: 0,
    message: null, damagecount: 0, bonuscount: 0, attacker: null, extralight: 0, fixedcolormap: 0,
    psprites: [{ state: null, tics: 0, sx: 0, sy: 0 }, { state: null, tics: 0, sx: 0, sy: 0 }],
  };
}
// G_PlayerReborn: keep only the tallies
function playerReborn(pl) {
  const { killcount, itemcount, secretcount } = pl;
  Object.assign(pl, newPlayer(), { killcount, itemcount, secretcount, playerstate: PST_LIVE });
  pl.weaponowned[wp_fist] = pl.weaponowned[wp_pistol] = true;
  pl.ammo[am_clip] = 50;
}
// G_PlayerFinishLevel
function playerFinishLevel(pl) {
  pl.powers.fill(0); pl.cards.fill(false);
  if (pl.mo) pl.mo.flags &= ~MF_SHADOW;
  pl.extralight = 0; pl.fixedcolormap = 0; pl.damagecount = 0; pl.bonuscount = 0;
}
function spawnPlayer(mt) {
  const pl = players[0];
  if (pl.playerstate === PST_REBORN) playerReborn(pl);
  const mo = spawnMobj(mt.x, mt.y, ONFLOORZ, MT.PLAYER);
  mo.angle = normAngle(ANG45 * Math.floor(mt.angle / 45));
  mo.player = pl; mo.health = pl.health;
  pl.mo = mo; pl.playerstate = PST_LIVE; pl.refire = 0; pl.message = null; pl.damagecount = 0; pl.bonuscount = 0;
  pl.extralight = 0; pl.fixedcolormap = 0; pl.viewheight = VIEWHEIGHT; pl.attacker = null; pl.viewz = mo.z + VIEWHEIGHT;
  for (const p of pl.psprites) p.state = null;
  pl.pendingweapon = pl.readyweapon;
  bringUpWeapon(pl);
}

// ---- P_PlayerThink ----
let onground = false;
function thrust(pl, angle, move) { pl.mo.momx += move * Math.cos(angle); pl.mo.momy += move * Math.sin(angle); }
function calcHeight(pl) {
  const mo = pl.mo;
  pl.bob = Math.min(MAXBOB, (mo.momx * mo.momx + mo.momy * mo.momy) / 4);
  if ((pl.cheats & CF_NOMOMENTUM) || !onground) {
    pl.viewz = Math.min(mo.z + VIEWHEIGHT, mo.ceilingz - 4);
    pl.viewz = mo.z + pl.viewheight;
    return;
  }
  const bob = pl.bob / 2 * Math.sin(TAU * (G.leveltime % 20) / 20);
  if (pl.playerstate === PST_LIVE) {
    pl.viewheight += pl.deltaviewheight;
    if (pl.viewheight > VIEWHEIGHT) { pl.viewheight = VIEWHEIGHT; pl.deltaviewheight = 0; }
    if (pl.viewheight < VIEWHEIGHT / 2) { pl.viewheight = VIEWHEIGHT / 2; if (pl.deltaviewheight <= 0) pl.deltaviewheight = 1 / 65536; }
    if (pl.deltaviewheight) { pl.deltaviewheight += 0.25; if (!pl.deltaviewheight) pl.deltaviewheight = 1 / 65536; }
  }
  pl.viewz = mo.z + pl.viewheight + bob;
  if (pl.viewz > mo.ceilingz - 4) pl.viewz = mo.ceilingz - 4;
}
function movePlayer(pl) {
  const cmd = pl.cmd, mo = pl.mo;
  mo.angle = normAngle(mo.angle + (cmd.angleturn << 16) * BAM);
  onground = mo.z <= mo.floorz;
  if (cmd.forwardmove && onground) thrust(pl, mo.angle, cmd.forwardmove * 2048 / 65536);
  if (cmd.sidemove && onground) thrust(pl, mo.angle - ANG90, cmd.sidemove * 2048 / 65536);
  if ((cmd.forwardmove || cmd.sidemove) && mo.state === STATES[S.PLAY]) setMobjState(mo, S.PLAY_RUN1);
}
function deathThink(pl) {
  movePsprites(pl);
  if (pl.viewheight > 6) pl.viewheight -= 1;
  if (pl.viewheight < 6) pl.viewheight = 6;
  pl.deltaviewheight = 0;
  onground = pl.mo.z <= pl.mo.floorz;
  calcHeight(pl);
  const ANG5 = ANG90 / 18;
  if (pl.attacker && pl.attacker !== pl.mo) {
    const angle = pointToAngle(pl.mo.x, pl.mo.y, pl.attacker.x, pl.attacker.y);
    const delta = normAngle(angle - pl.mo.angle);
    if (delta < ANG5 || delta > TAU - ANG5) { pl.mo.angle = angle; if (pl.damagecount) pl.damagecount--; }
    else if (delta < ANG180) pl.mo.angle = normAngle(pl.mo.angle + ANG5);
    else pl.mo.angle = normAngle(pl.mo.angle - ANG5);
  } else if (pl.damagecount) pl.damagecount--;
  if (pl.cmd.buttons & BT_USE) pl.playerstate = PST_REBORN;
}
function playerInSpecialSector(pl) {
  const sec = pl.mo.subsector.sector;
  if (pl.mo.z !== sec.floorheight) return;
  switch (sec.special) {
    case 5: if (!pl.powers[pw_ironfeet] && !(G.leveltime & 0x1f)) damageMobj(pl.mo, null, null, 10); break;
    case 7: if (!pl.powers[pw_ironfeet] && !(G.leveltime & 0x1f)) damageMobj(pl.mo, null, null, 5); break;
    case 16: case 4: if ((!pl.powers[pw_ironfeet] || P_Random() < 5) && !(G.leveltime & 0x1f)) damageMobj(pl.mo, null, null, 20); break;
    case 9: pl.secretcount++; sec.special = 0; break;
    case 11:
      pl.cheats &= ~CF_GODMODE;
      if (!(G.leveltime & 0x1f)) damageMobj(pl.mo, null, null, 20);
      if (pl.health <= 10) exitLevel(false);
      break;
  }
}
function playerThink(pl) {
  const cmd = pl.cmd, mo = pl.mo;
  if (pl.cheats & CF_NOCLIP) mo.flags |= MF_NOCLIP; else mo.flags &= ~MF_NOCLIP;
  if (mo.flags & MF_JUSTATTACKED) { cmd.angleturn = 0; cmd.forwardmove = 0xc800 / 512; cmd.sidemove = 0; mo.flags &= ~MF_JUSTATTACKED; }
  if (pl.playerstate === PST_DEAD) { deathThink(pl); return; }
  if (mo.reactiontime) mo.reactiontime--; else movePlayer(pl);
  calcHeight(pl);
  if (mo.subsector.sector.special) playerInSpecialSector(pl);
  if (cmd.buttons & BT_CHANGE) {
    let nw = (cmd.buttons >> BT_WEAPONSHIFT) & 7;
    if (nw === wp_fist && pl.weaponowned[wp_chainsaw] && !(pl.readyweapon === wp_chainsaw && pl.powers[pw_strength])) nw = wp_chainsaw;
    if (pl.weaponowned[nw] && nw !== pl.readyweapon) pl.pendingweapon = nw;
  }
  if (cmd.buttons & BT_USE) { if (!pl.usedown) { useLines(pl); pl.usedown = true; } } else pl.usedown = false;
  movePsprites(pl);
  if (pl.powers[pw_strength]) pl.powers[pw_strength]++;
  if (pl.powers[pw_invulnerability]) pl.powers[pw_invulnerability]--;
  if (pl.powers[pw_invisibility]) if (!--pl.powers[pw_invisibility]) mo.flags &= ~MF_SHADOW;
  if (pl.powers[pw_infrared]) pl.powers[pw_infrared]--;
  if (pl.powers[pw_ironfeet]) pl.powers[pw_ironfeet]--;
  if (pl.damagecount) pl.damagecount--;
  if (pl.bonuscount) pl.bonuscount--;
  const inv = pl.powers[pw_invulnerability], ir = pl.powers[pw_infrared];
  if (inv) pl.fixedcolormap = (inv > 4 * 32 || (inv & 8)) ? INVERSECOLORMAP : 0;
  else if (ir) pl.fixedcolormap = (ir > 4 * 32 || (ir & 8)) ? 1 : 0;
  else pl.fixedcolormap = 0;
}

// ---- p_pspr.c ----
function setPsprite(pl, pos, stnum) {
  const psp = pl.psprites[pos];
  do {
    if (!stnum) { psp.state = null; break; }
    const st = STATES[stnum];
    psp.state = st; psp.tics = st.tics;
    if (st.misc1) { psp.sx = st.misc1; psp.sy = st.misc2; }
    if (st.action) { st.action(pl.mo, pl, psp); if (!psp.state) break; }
    stnum = psp.state.nextstate;
  } while (!psp.tics);
}
function movePsprites(pl) {
  for (let i = 0; i < 2; i++) {
    const psp = pl.psprites[i];
    if (psp.state && psp.tics !== -1) { psp.tics--; if (!psp.tics) setPsprite(pl, i, psp.state.nextstate); }
  }
  pl.psprites[ps_flash].sx = pl.psprites[ps_weapon].sx; pl.psprites[ps_flash].sy = pl.psprites[ps_weapon].sy;
}
function bringUpWeapon(pl) {
  if (pl.pendingweapon === wp_nochange) pl.pendingweapon = pl.readyweapon;
  if (pl.pendingweapon === wp_chainsaw) S_StartSound(pl.mo, SFX.sawup);
  const ns = INFO.weapons[pl.pendingweapon].upstate;
  pl.pendingweapon = wp_nochange;
  pl.psprites[ps_weapon].sy = WEAPONBOTTOM;
  setPsprite(pl, ps_weapon, ns);
}
function checkAmmo(pl) {
  const ammo = INFO.weapons[pl.readyweapon].ammo, count = pl.readyweapon === wp_bfg ? 40 : 1;
  if (ammo === am_noammo || pl.ammo[ammo] >= count) return true;
  const w = pl.weaponowned, a = pl.ammo;
  if (w[wp_plasma] && a[am_cell]) pl.pendingweapon = wp_plasma;
  else if (w[wp_chaingun] && a[am_clip]) pl.pendingweapon = wp_chaingun;
  else if (w[wp_shotgun] && a[am_shell]) pl.pendingweapon = wp_shotgun;
  else if (a[am_clip]) pl.pendingweapon = wp_pistol;
  else if (w[wp_chainsaw]) pl.pendingweapon = wp_chainsaw;
  else if (w[wp_missile] && a[am_misl]) pl.pendingweapon = wp_missile;
  else if (w[wp_bfg] && a[am_cell] > 40) pl.pendingweapon = wp_bfg;
  else pl.pendingweapon = wp_fist;
  setPsprite(pl, ps_weapon, INFO.weapons[pl.readyweapon].downstate);
  return false;
}
function fireWeapon(pl) {
  if (!checkAmmo(pl)) return;
  setMobjState(pl.mo, S.PLAY_ATK1);
  setPsprite(pl, ps_weapon, INFO.weapons[pl.readyweapon].atkstate);
  noiseAlert(pl.mo, pl.mo);
}
function dropWeapon(pl) { setPsprite(pl, ps_weapon, INFO.weapons[pl.readyweapon].downstate); }

let bulletslope = 0;
function bulletSlope(mo) {
  let an = mo.angle;
  bulletslope = aimLineAttack(mo, an, 1024);
  if (!linetarget) {
    an = normAngle(an + (1 << 26) * BAM); bulletslope = aimLineAttack(mo, an, 1024);
    if (!linetarget) { an = normAngle(an - (2 << 26) * BAM); bulletslope = aimLineAttack(mo, an, 1024); }
  }
}
function gunShot(mo, accurate) {
  const damage = 5 * (P_Random() % 3 + 1);
  let angle = mo.angle;
  if (!accurate) angle = normAngle(angle + ((P_Random() - P_Random()) << 18) * BAM);
  lineAttack(mo, angle, MISSILERANGE, bulletslope, damage);
}
const flashState = pl => INFO.weapons[pl.readyweapon].flashstate;

Object.assign(ACTIONS, {
  A_WeaponReady(mo, pl, psp) {
    if (mo.state === STATES[S.PLAY_ATK1] || mo.state === STATES[S.PLAY_ATK2]) setMobjState(mo, S.PLAY);
    if (pl.readyweapon === wp_chainsaw && psp.state === STATES[S.SAW]) S_StartSound(mo, SFX.sawidl);
    if (pl.pendingweapon !== wp_nochange || !pl.health) { setPsprite(pl, ps_weapon, INFO.weapons[pl.readyweapon].downstate); return; }
    if (pl.cmd.buttons & BT_ATTACK) {
      if (!pl.attackdown || (pl.readyweapon !== wp_missile && pl.readyweapon !== wp_bfg)) { pl.attackdown = true; fireWeapon(pl); return; }
    } else pl.attackdown = false;
    const a = TAU * ((128 * G.leveltime) & 8191) / 8192;
    psp.sx = 1 + pl.bob * Math.cos(a);
    psp.sy = WEAPONTOP + pl.bob * Math.sin(TAU * ((128 * G.leveltime) & 4095) / 8192);
  },
  A_ReFire(mo, pl) {
    if ((pl.cmd.buttons & BT_ATTACK) && pl.pendingweapon === wp_nochange && pl.health) { pl.refire++; fireWeapon(pl); }
    else { pl.refire = 0; checkAmmo(pl); }
  },
  A_CheckReload(mo, pl) { checkAmmo(pl); },
  A_Lower(mo, pl, psp) {
    psp.sy += LOWERSPEED;
    if (psp.sy < WEAPONBOTTOM) return;
    if (pl.playerstate === PST_DEAD) { psp.sy = WEAPONBOTTOM; return; }
    if (!pl.health) { setPsprite(pl, ps_weapon, S.NULL); return; }
    pl.readyweapon = pl.pendingweapon;
    bringUpWeapon(pl);
  },
  A_Raise(mo, pl, psp) {
    psp.sy -= RAISESPEED;
    if (psp.sy > WEAPONTOP) return;
    psp.sy = WEAPONTOP;
    setPsprite(pl, ps_weapon, INFO.weapons[pl.readyweapon].readystate);
  },
  A_GunFlash(mo, pl) { setMobjState(mo, S.PLAY_ATK2); setPsprite(pl, ps_flash, flashState(pl)); },
  A_Punch(mo, pl) {
    let damage = (P_Random() % 10 + 1) << 1;
    if (pl.powers[pw_strength]) damage *= 10;
    const angle = normAngle(mo.angle + ((P_Random() - P_Random()) << 18) * BAM);
    const slope = aimLineAttack(mo, angle, MELEERANGE);
    lineAttack(mo, angle, MELEERANGE, slope, damage);
    if (linetarget) { S_StartSound(mo, SFX.punch); mo.angle = pointToAngle(mo.x, mo.y, linetarget.x, linetarget.y); }
  },
  A_Saw(mo, pl) {
    const damage = 2 * (P_Random() % 10 + 1);
    let angle = normAngle(mo.angle + ((P_Random() - P_Random()) << 18) * BAM);
    const slope = aimLineAttack(mo, angle, MELEERANGE + 1);
    lineAttack(mo, angle, MELEERANGE + 1, slope, damage);
    if (!linetarget) { S_StartSound(mo, SFX.sawful); return; }
    S_StartSound(mo, SFX.sawhit);
    angle = pointToAngle(mo.x, mo.y, linetarget.x, linetarget.y);
    const d = normAngle(angle - mo.angle), a20 = ANG90 / 20, a21 = ANG90 / 21;
    if (d > ANG180) mo.angle = d < TAU - a20 ? normAngle(angle + a21) : normAngle(mo.angle - a20);
    else mo.angle = d > a20 ? normAngle(angle - a21) : normAngle(mo.angle + a20);
    mo.flags |= MF_JUSTATTACKED;
  },
  A_FireMissile(mo, pl) { pl.ammo[am_misl]--; spawnPlayerMissile(mo, MT.ROCKET); },
  A_FireBFG(mo, pl) { pl.ammo[am_cell] -= 40; spawnPlayerMissile(mo, MT.BFG); },
  A_FirePlasma(mo, pl) { pl.ammo[am_cell]--; setPsprite(pl, ps_flash, flashState(pl) + (P_Random() & 1)); spawnPlayerMissile(mo, MT.PLASMA); },
  A_FirePistol(mo, pl) {
    S_StartSound(mo, SFX.pistol); setMobjState(mo, S.PLAY_ATK2); pl.ammo[am_clip]--;
    setPsprite(pl, ps_flash, flashState(pl)); bulletSlope(mo); gunShot(mo, !pl.refire);
  },
  A_FireShotgun(mo, pl) {
    S_StartSound(mo, SFX.shotgn); setMobjState(mo, S.PLAY_ATK2); pl.ammo[am_shell]--;
    setPsprite(pl, ps_flash, flashState(pl)); bulletSlope(mo);
    for (let i = 0; i < 7; i++) gunShot(mo, false);
  },
  A_FireShotgun2(mo, pl) {
    S_StartSound(mo, SFX.dshtgn); setMobjState(mo, S.PLAY_ATK2); pl.ammo[am_shell] -= 2;
    setPsprite(pl, ps_flash, flashState(pl)); bulletSlope(mo);
    for (let i = 0; i < 20; i++) {
      const damage = 5 * (P_Random() % 3 + 1), angle = normAngle(mo.angle + ((P_Random() - P_Random()) << 19) * BAM);
      lineAttack(mo, angle, MISSILERANGE, bulletslope + ((P_Random() - P_Random()) << 5) / 65536, damage);
    }
  },
  A_FireCGun(mo, pl, psp) {
    S_StartSound(mo, SFX.pistol);
    if (!pl.ammo[am_clip]) return;
    setMobjState(mo, S.PLAY_ATK2); pl.ammo[am_clip]--;
    setPsprite(pl, ps_flash, flashState(pl) + psp.state.id - S.CHAIN1);
    bulletSlope(mo); gunShot(mo, !pl.refire);
  },
  A_Light0(mo, pl) { pl.extralight = 0; }, A_Light1(mo, pl) { pl.extralight = 1; }, A_Light2(mo, pl) { pl.extralight = 2; },
  A_OpenShotgun2(mo) { S_StartSound(mo, SFX.dbopn); }, A_LoadShotgun2(mo) { S_StartSound(mo, SFX.dbload); },
  A_CloseShotgun2(mo, pl) { S_StartSound(mo, SFX.dbcls); ACTIONS.A_ReFire(mo, pl); },
  A_BFGsound(mo) { S_StartSound(mo, SFX.bfg); },
  A_BFGSpray(mo) {
    for (let i = 0; i < 40; i++) {
      const an = normAngle(mo.angle - ANG90 / 2 + ANG90 / 40 * i);
      aimLineAttack(mo.target, an, 1024 * 16);
      if (!linetarget) continue;
      spawnMobj(linetarget.x, linetarget.y, linetarget.z + linetarget.height / 4, MT.EXTRABFG);
      let damage = 0;
      for (let j = 0; j < 15; j++) damage += (P_Random() & 7) + 1;
      damageMobj(linetarget, mo.target, mo.target, damage);
    }
  },
});
