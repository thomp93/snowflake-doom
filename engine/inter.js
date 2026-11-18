// ---- p_inter.c : damage, death, item pickups ----
const am_clip = 0, am_shell = 1, am_cell = 2, am_misl = 3, am_noammo = 5;
const wp_fist = 0, wp_pistol = 1, wp_shotgun = 2, wp_chaingun = 3, wp_missile = 4, wp_plasma = 5, wp_bfg = 6, wp_chainsaw = 7, wp_supershotgun = 8, wp_nochange = 10;
const pw_invulnerability = 0, pw_strength = 1, pw_invisibility = 2, pw_ironfeet = 3, pw_allmap = 4, pw_infrared = 5;
const it_bluecard = 0, it_yellowcard = 1, it_redcard = 2, it_blueskull = 3, it_yellowskull = 4, it_redskull = 5;
const CF_NOCLIP = 1, CF_GODMODE = 2, CF_NOMOMENTUM = 4;
const PST_LIVE = 0, PST_DEAD = 1, PST_REBORN = 2;
const MAXHEALTH = 100, BONUSADD = 6, BASETHRESHOLD = 100;
const CLIPAMMO = [10, 4, 20, 1], MAXAMMO = [200, 50, 300, 50];
const TXT = INFO.strings;

function giveAmmo(pl, ammo, num) {
  if (ammo === am_noammo) return false;
  if (pl.ammo[ammo] === pl.maxammo[ammo]) return false;
  num = num ? num * CLIPAMMO[ammo] : Math.floor(CLIPAMMO[ammo] / 2);
  if (G.skill === sk_baby || G.skill === sk_nightmare) num <<= 1;
  const old = pl.ammo[ammo];
  pl.ammo[ammo] = Math.min(pl.maxammo[ammo], pl.ammo[ammo] + num);
  if (old) return true;
  const w = pl.weaponowned, r = pl.readyweapon;
  switch (ammo) {
    case am_clip: if (r === wp_fist) pl.pendingweapon = w[wp_chaingun] ? wp_chaingun : wp_pistol; break;
    case am_shell: if ((r === wp_fist || r === wp_pistol) && w[wp_shotgun]) pl.pendingweapon = wp_shotgun; break;
    case am_cell: if ((r === wp_fist || r === wp_pistol) && w[wp_plasma]) pl.pendingweapon = wp_plasma; break;
    case am_misl: if (r === wp_fist && w[wp_missile]) pl.pendingweapon = wp_missile; break;
  }
  return true;
}
function giveWeapon(pl, weapon, dropped) {
  const ammo = INFO.weapons[weapon].ammo;
  const gaveammo = ammo !== am_noammo ? giveAmmo(pl, ammo, dropped ? 1 : 2) : false;
  let gaveweapon = false;
  if (!pl.weaponowned[weapon]) { gaveweapon = true; pl.weaponowned[weapon] = true; pl.pendingweapon = weapon; }
  return gaveweapon || gaveammo;
}
function giveBody(pl, num) {
  if (pl.health >= MAXHEALTH) return false;
  pl.health = Math.min(MAXHEALTH, pl.health + num); pl.mo.health = pl.health;
  return true;
}
function giveArmor(pl, type) {
  const hits = type * 100;
  if (pl.armorpoints >= hits) return false;
  pl.armortype = type; pl.armorpoints = hits;
  return true;
}
function giveCard(pl, card) { if (pl.cards[card]) return; pl.bonuscount = BONUSADD; pl.cards[card] = true; }
function givePower(pl, p) {
  switch (p) {
    case pw_invulnerability: pl.powers[p] = 30 * 35; return true;
    case pw_invisibility: pl.powers[p] = 60 * 35; pl.mo.flags |= MF_SHADOW; return true;
    case pw_infrared: pl.powers[p] = 120 * 35; return true;
    case pw_ironfeet: pl.powers[p] = 60 * 35; return true;
    case pw_strength: giveBody(pl, 100); pl.powers[p] = 1; return true;
  }
  if (pl.powers[p]) return false;
  pl.powers[p] = 1;
  return true;
}

function touchSpecialThing(special, toucher) {
  const delta = special.z - toucher.z;
  if (delta > toucher.height || delta < -8) return;
  const pl = toucher.player;
  if (!pl || toucher.health <= 0) return;
  let sound = SFX.itemup, msg = null;
  const dropped = special.flags & MF_DROPPED;
  switch (INFO.sprnames[special.sprite]) {
    case 'ARM1': if (!giveArmor(pl, 1)) return; msg = TXT.GOTARMOR; break;
    case 'ARM2': if (!giveArmor(pl, 2)) return; msg = TXT.GOTMEGA; break;
    case 'BON1': pl.health = Math.min(200, pl.health + 1); pl.mo.health = pl.health; msg = TXT.GOTHTHBONUS; break;
    case 'BON2': pl.armorpoints = Math.min(200, pl.armorpoints + 1); if (!pl.armortype) pl.armortype = 1; msg = TXT.GOTARMBONUS; break;
    case 'SOUL': pl.health = Math.min(200, pl.health + 100); pl.mo.health = pl.health; msg = TXT.GOTSUPER; sound = SFX.getpow; break;
    case 'MEGA': pl.health = 200; pl.mo.health = 200; giveArmor(pl, 2); msg = TXT.GOTMSPHERE; sound = SFX.getpow; break;
    case 'BKEY': if (!pl.cards[it_bluecard]) msg = TXT.GOTBLUECARD; giveCard(pl, it_bluecard); break;
    case 'YKEY': if (!pl.cards[it_yellowcard]) msg = TXT.GOTYELWCARD; giveCard(pl, it_yellowcard); break;
    case 'RKEY': if (!pl.cards[it_redcard]) msg = TXT.GOTREDCARD; giveCard(pl, it_redcard); break;
    case 'BSKU': if (!pl.cards[it_blueskull]) msg = TXT.GOTBLUESKUL; giveCard(pl, it_blueskull); break;
    case 'YSKU': if (!pl.cards[it_yellowskull]) msg = TXT.GOTYELWSKUL; giveCard(pl, it_yellowskull); break;
    case 'RSKU': if (!pl.cards[it_redskull]) msg = TXT.GOTREDSKULL; giveCard(pl, it_redskull); break;
    case 'STIM': if (!giveBody(pl, 10)) return; msg = TXT.GOTSTIM; break;
    case 'MEDI': if (!giveBody(pl, 25)) return; msg = pl.health < 25 ? TXT.GOTMEDINEED : TXT.GOTMEDIKIT; break;
    case 'PINV': if (!givePower(pl, pw_invulnerability)) return; msg = TXT.GOTINVUL; sound = SFX.getpow; break;
    case 'PSTR': if (!givePower(pl, pw_strength)) return; msg = TXT.GOTBERSERK; if (pl.readyweapon !== wp_fist) pl.pendingweapon = wp_fist; sound = SFX.getpow; break;
    case 'PINS': if (!givePower(pl, pw_invisibility)) return; msg = TXT.GOTINVIS; sound = SFX.getpow; break;
    case 'SUIT': if (!givePower(pl, pw_ironfeet)) return; msg = TXT.GOTSUIT; sound = SFX.getpow; break;
    case 'PMAP': if (!givePower(pl, pw_allmap)) return; msg = TXT.GOTMAP; sound = SFX.getpow; break;
    case 'PVIS': if (!givePower(pl, pw_infrared)) return; msg = TXT.GOTVISOR; sound = SFX.getpow; break;
    case 'CLIP': if (!giveAmmo(pl, am_clip, dropped ? 0 : 1)) return; msg = TXT.GOTCLIP; break;
    case 'AMMO': if (!giveAmmo(pl, am_clip, 5)) return; msg = TXT.GOTCLIPBOX; break;
    case 'ROCK': if (!giveAmmo(pl, am_misl, 1)) return; msg = TXT.GOTROCKET; break;
    case 'BROK': if (!giveAmmo(pl, am_misl, 5)) return; msg = TXT.GOTROCKBOX; break;
    case 'CELL': if (!giveAmmo(pl, am_cell, 1)) return; msg = TXT.GOTCELL; break;
    case 'CELP': if (!giveAmmo(pl, am_cell, 5)) return; msg = TXT.GOTCELLBOX; break;
    case 'SHEL': if (!giveAmmo(pl, am_shell, 1)) return; msg = TXT.GOTSHELLS; break;
    case 'SBOX': if (!giveAmmo(pl, am_shell, 5)) return; msg = TXT.GOTSHELLBOX; break;
    case 'BPAK':
      if (!pl.backpack) { for (let i = 0; i < 4; i++) pl.maxammo[i] *= 2; pl.backpack = true; }
      for (let i = 0; i < 4; i++) giveAmmo(pl, i, 1);
      msg = TXT.GOTBACKPACK; break;
    case 'BFUG': if (!giveWeapon(pl, wp_bfg, false)) return; msg = TXT.GOTBFG9000; sound = SFX.wpnup; break;
    case 'MGUN': if (!giveWeapon(pl, wp_chaingun, dropped)) return; msg = TXT.GOTCHAINGUN; sound = SFX.wpnup; break;
    case 'CSAW': if (!giveWeapon(pl, wp_chainsaw, false)) return; msg = TXT.GOTCHAINSAW; sound = SFX.wpnup; break;
    case 'LAUN': if (!giveWeapon(pl, wp_missile, false)) return; msg = TXT.GOTLAUNCHER; sound = SFX.wpnup; break;
    case 'PLAS': if (!giveWeapon(pl, wp_plasma, false)) return; msg = TXT.GOTPLASMA; sound = SFX.wpnup; break;
    case 'SHOT': if (!giveWeapon(pl, wp_shotgun, dropped)) return; msg = TXT.GOTSHOTGUN; sound = SFX.wpnup; break;
    case 'SGN2': if (!giveWeapon(pl, wp_supershotgun, dropped)) return; msg = TXT.GOTSHOTGUN2; sound = SFX.wpnup; break;
    default: return;
  }
  if (msg) pl.message = msg;
  if (special.flags & MF_COUNTITEM) pl.itemcount++;
  removeMobj(special);
  pl.bonuscount += BONUSADD;
  S_StartSound(null, sound);
}

function killMobj(source, target) {
  target.flags &= ~(MF_SHOOTABLE | MF_FLOAT | MF_SKULLFLY);
  if (target.type !== MT.SKULL) target.flags &= ~MF_NOGRAVITY;
  target.flags |= MF_CORPSE | MF_DROPOFF;
  target.height /= 4;
  if (target.flags & MF_COUNTKILL) players[0].killcount++;
  if (target.player) {
    target.flags &= ~MF_SOLID;
    target.player.playerstate = PST_DEAD;
    dropWeapon(target.player);
    HUD.automap = false;
  }
  if (target.health < -target.info.spawnhealth && target.info.xdeathstate) setMobjState(target, target.info.xdeathstate);
  else setMobjState(target, target.info.deathstate);
  target.tics -= P_Random() & 3; if (target.tics < 1) target.tics = 1;
  let item = -1;
  if (target.type === MT.WOLFSS || target.type === MT.POSSESSED) item = MT.CLIP;
  else if (target.type === MT.SHOTGUY) item = MT.SHOTGUN;
  else if (target.type === MT.CHAINGUY) item = MT.CHAINGUN;
  if (item >= 0) spawnMobj(target.x, target.y, ONFLOORZ, item).flags |= MF_DROPPED;
}

function damageMobj(target, inflictor, source, damage) {
  if (!(target.flags & MF_SHOOTABLE) || target.health <= 0) return;
  if (target.flags & MF_SKULLFLY) target.momx = target.momy = target.momz = 0;
  const pl = target.player;
  if (pl && G.skill === sk_baby) damage >>= 1;
  if (inflictor && !(target.flags & MF_NOCLIP) && (!source || !source.player || source.player.readyweapon !== wp_chainsaw)) {
    let ang = pointToAngle(inflictor.x, inflictor.y, target.x, target.y);
    let thrust = damage * 100 / (8 * target.info.mass);
    if (damage < 40 && damage > target.health && target.z - inflictor.z > 64 && (P_Random() & 1)) { ang = normAngle(ang + ANG180); thrust *= 4; }
    target.momx += thrust * Math.cos(ang); target.momy += thrust * Math.sin(ang);
  }
  if (pl) {
    if (target.subsector.sector.special === 11 && damage >= target.health) damage = target.health - 1;
    if (damage < 1000 && ((pl.cheats & CF_GODMODE) || pl.powers[pw_invulnerability])) return;
    if (pl.armortype) {
      let saved = pl.armortype === 1 ? Math.floor(damage / 3) : Math.floor(damage / 2);
      if (pl.armorpoints <= saved) { saved = pl.armorpoints; pl.armortype = 0; }
      pl.armorpoints -= saved; damage -= saved;
    }
    pl.health = Math.max(0, pl.health - damage);
    pl.attacker = source;
    pl.damagecount = Math.min(100, pl.damagecount + damage);
  }
  target.health -= damage;
  if (target.health <= 0) { killMobj(source, target); return; }
  if (P_Random() < target.info.painchance && !(target.flags & MF_SKULLFLY)) {
    target.flags |= MF_JUSTHIT;
    setMobjState(target, target.info.painstate);
  }
  target.reactiontime = 0;
  if ((!target.threshold || target.type === MT.VILE) && source && source !== target && source.type !== MT.VILE) {
    target.target = source; target.threshold = BASETHRESHOLD;
    if (target.state === STATES[target.info.spawnstate] && target.info.seestate !== S.NULL) setMobjState(target, target.info.seestate);
  }
}
