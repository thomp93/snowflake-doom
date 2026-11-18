// ---- p_enemy.c : monster AI and attacks ----
const DI_EAST = 0, DI_NORTHEAST = 1, DI_NORTH = 2, DI_NORTHWEST = 3, DI_WEST = 4, DI_SOUTHWEST = 5, DI_SOUTH = 6, DI_SOUTHEAST = 7, DI_NODIR = 8;
const OPPOSITE = [DI_WEST, DI_SOUTHWEST, DI_SOUTH, DI_SOUTHEAST, DI_EAST, DI_NORTHEAST, DI_NORTH, DI_NORTHWEST, DI_NODIR];
const DIAGS = [DI_NORTHWEST, DI_NORTHEAST, DI_SOUTHWEST, DI_SOUTHEAST];
const XSPEED = [1, 47000 / 65536, 0, -47000 / 65536, -1, -47000 / 65536, 0, 47000 / 65536];
const YSPEED = [0, 47000 / 65536, 1, 47000 / 65536, 0, -47000 / 65536, -1, -47000 / 65536];

function checkMeleeRange(actor) {
  const pl = actor.target;
  if (!pl) return false;
  if (approxDist(pl.x - actor.x, pl.y - actor.y) >= MELEERANGE - 20 + pl.info.radius) return false;
  return checkSight(actor, pl);
}
function checkMissileRange(actor) {
  if (!checkSight(actor, actor.target)) return false;
  if (actor.flags & MF_JUSTHIT) { actor.flags &= ~MF_JUSTHIT; return true; }
  if (actor.reactiontime) return false;
  let dist = approxDist(actor.x - actor.target.x, actor.y - actor.target.y) - 64;
  if (!actor.info.meleestate) dist -= 128;
  dist = Math.floor(dist);
  if (actor.type === MT.VILE && dist > 14 * 64) return false;
  if (actor.type === MT.UNDEAD) { if (dist < 196) return false; dist >>= 1; }
  if (actor.type === MT.CYBORG || actor.type === MT.SPIDER || actor.type === MT.SKULL) dist >>= 1;
  if (dist > 200) dist = 200;
  if (actor.type === MT.CYBORG && dist > 160) dist = 160;
  return P_Random() >= dist;
}
function monsterMove(actor) {
  if (actor.movedir === DI_NODIR) return false;
  const tx = actor.x + actor.info.speed * XSPEED[actor.movedir], ty = actor.y + actor.info.speed * YSPEED[actor.movedir];
  if (!tryMove(actor, tx, ty)) {
    if ((actor.flags & MF_FLOAT) && tm.floatok) {
      actor.z += actor.z < tm.floorz ? FLOATSPEED : -FLOATSPEED;
      actor.flags |= MF_INFLOAT;
      return true;
    }
    if (!tm.spechit.length) return false;
    actor.movedir = DI_NODIR;
    let good = false;
    const sh = tm.spechit.slice();
    for (let i = sh.length - 1; i >= 0; i--) if (useSpecialLine(actor, sh[i], 0)) good = true;
    return good;
  }
  actor.flags &= ~MF_INFLOAT;
  if (!(actor.flags & MF_FLOAT)) actor.z = actor.floorz;
  return true;
}
function tryWalk(actor) { if (!monsterMove(actor)) return false; actor.movecount = P_Random() & 15; return true; }
function newChaseDir(actor) {
  const olddir = actor.movedir, turnaround = OPPOSITE[olddir];
  const dx = actor.target.x - actor.x, dy = actor.target.y - actor.y;
  let d1 = dx > 10 ? DI_EAST : dx < -10 ? DI_WEST : DI_NODIR;
  let d2 = dy < -10 ? DI_SOUTH : dy > 10 ? DI_NORTH : DI_NODIR;
  if (d1 !== DI_NODIR && d2 !== DI_NODIR) {
    actor.movedir = DIAGS[((dy < 0) << 1) + (dx > 0)];
    if (actor.movedir !== turnaround && tryWalk(actor)) return;
  }
  if (P_Random() > 200 || Math.abs(dy) > Math.abs(dx)) { const t = d1; d1 = d2; d2 = t; }
  if (d1 === turnaround) d1 = DI_NODIR;
  if (d2 === turnaround) d2 = DI_NODIR;
  if (d1 !== DI_NODIR) { actor.movedir = d1; if (tryWalk(actor)) return; }
  if (d2 !== DI_NODIR) { actor.movedir = d2; if (tryWalk(actor)) return; }
  if (olddir !== DI_NODIR) { actor.movedir = olddir; if (tryWalk(actor)) return; }
  if (P_Random() & 1) {
    for (let t = DI_EAST; t <= DI_SOUTHEAST; t++) if (t !== turnaround) { actor.movedir = t; if (tryWalk(actor)) return; }
  } else {
    for (let t = DI_SOUTHEAST; t >= DI_EAST; t--) if (t !== turnaround) { actor.movedir = t; if (tryWalk(actor)) return; }
  }
  if (turnaround !== DI_NODIR) { actor.movedir = turnaround; if (tryWalk(actor)) return; }
  actor.movedir = DI_NODIR;
}
function lookForPlayers(actor, allaround) {
  const pl = players[0];
  if (!pl || !pl.mo || pl.health <= 0) return false;
  if (!checkSight(actor, pl.mo)) return false;
  if (!allaround) {
    const an = normAngle(pointToAngle(actor.x, actor.y, pl.mo.x, pl.mo.y) - actor.angle);
    if (an > ANG90 && an < ANG270 && approxDist(pl.mo.x - actor.x, pl.mo.y - actor.y) > MELEERANGE) return false;
  }
  actor.target = pl.mo;
  return true;
}
function faceTarget(actor) {
  if (!actor.target) return;
  actor.flags &= ~MF_AMBUSH;
  actor.angle = pointToAngle(actor.x, actor.y, actor.target.x, actor.target.y);
  if (actor.target.flags & MF_SHADOW) actor.angle = normAngle(actor.angle + ((P_Random() - P_Random()) << 21) * BAM);
}
const fullVolume = mo => mo.type === MT.SPIDER || mo.type === MT.CYBORG;
function refire(actor, chance) {
  faceTarget(actor);
  if (P_Random() < chance) return;
  if (!actor.target || actor.target.health <= 0 || !checkSight(actor, actor.target)) setMobjState(actor, actor.info.seestate);
}
function bossDeath(mo) {
  const e = G.episode, m = G.map;
  if (e === 1) { if (m !== 8 || mo.type !== MT.BRUISER) return; }
  else if (e === 2) { if (m !== 8 || mo.type !== MT.CYBORG) return; }
  else if (e === 3) { if (m !== 8 || mo.type !== MT.SPIDER) return; }
  else if (e === 4) { if (!((m === 6 && mo.type === MT.CYBORG) || (m === 8 && mo.type === MT.SPIDER))) return; }
  else if (m !== 8) return;
  if (players[0].health <= 0) return;
  for (const m2 of mobjs) if (!m2.removed && m2 !== mo && m2.type === mo.type && m2.health > 0) return;
  if (e === 1) { doFloor({ tag: 666 }, 'lowerFloorToLowest'); return; }
  if (e === 4) { if (m === 6) { doDoor({ tag: 666 }, 'blazeOpen'); return; } if (m === 8) { doFloor({ tag: 666 }, 'lowerFloorToLowest'); return; } }
  exitLevel(false);
}

Object.assign(ACTIONS, {
  A_Look(actor) {
    actor.threshold = 0;
    const targ = actor.subsector.sector.soundtarget;
    let see = false;
    if (targ && (targ.flags & MF_SHOOTABLE)) {
      actor.target = targ;
      if (!(actor.flags & MF_AMBUSH) || checkSight(actor, targ)) see = true;
    }
    if (!see && !lookForPlayers(actor, false)) return;
    let sound = actor.info.seesound;
    if (sound) {
      if (sound === SFX.posit1 || sound === SFX.posit2 || sound === SFX.posit3) sound = SFX.posit1 + P_Random() % 3;
      else if (sound === SFX.bgsit1 || sound === SFX.bgsit2) sound = SFX.bgsit1 + P_Random() % 2;
      S_StartSound(fullVolume(actor) ? null : actor, sound);
    }
    setMobjState(actor, actor.info.seestate);
  },
  A_Chase(actor) {
    if (actor.reactiontime) actor.reactiontime--;
    if (actor.threshold) { if (!actor.target || actor.target.health <= 0) actor.threshold = 0; else actor.threshold--; }
    if (actor.movedir < 8) {
      actor.angle = Math.floor(actor.angle / ANG45 + 1e-9) * ANG45;
      let delta = actor.angle - actor.movedir * ANG45;
      if (delta > ANG180) delta -= TAU; else if (delta < -ANG180) delta += TAU;
      if (delta > 0) actor.angle = normAngle(actor.angle - ANG45); else if (delta < 0) actor.angle = normAngle(actor.angle + ANG45);
    }
    if (!actor.target || !(actor.target.flags & MF_SHOOTABLE)) {
      if (lookForPlayers(actor, true)) return;
      setMobjState(actor, actor.info.spawnstate);
      return;
    }
    if (actor.flags & MF_JUSTATTACKED) {
      actor.flags &= ~MF_JUSTATTACKED;
      if (G.skill !== sk_nightmare) newChaseDir(actor);
      return;
    }
    if (actor.info.meleestate && checkMeleeRange(actor)) {
      if (actor.info.attacksound) S_StartSound(actor, actor.info.attacksound);
      setMobjState(actor, actor.info.meleestate);
      return;
    }
    if (actor.info.missilestate && !(G.skill < sk_nightmare && actor.movecount) && checkMissileRange(actor)) {
      setMobjState(actor, actor.info.missilestate);
      actor.flags |= MF_JUSTATTACKED;
      return;
    }
    if (--actor.movecount < 0 || !monsterMove(actor)) newChaseDir(actor);
    if (actor.info.activesound && P_Random() < 3) S_StartSound(actor, actor.info.activesound);
  },
  A_FaceTarget: faceTarget,
  A_PosAttack(actor) {
    if (!actor.target) return;
    faceTarget(actor);
    const slope = aimLineAttack(actor, actor.angle, MISSILERANGE);
    S_StartSound(actor, SFX.pistol);
    const angle = normAngle(actor.angle + ((P_Random() - P_Random()) << 20) * BAM);
    lineAttack(actor, angle, MISSILERANGE, slope, ((P_Random() % 5) + 1) * 3);
  },
  A_SPosAttack(actor) {
    if (!actor.target) return;
    S_StartSound(actor, SFX.shotgn);
    faceTarget(actor);
    const slope = aimLineAttack(actor, actor.angle, MISSILERANGE);
    for (let i = 0; i < 3; i++) {
      const angle = normAngle(actor.angle + ((P_Random() - P_Random()) << 20) * BAM);
      lineAttack(actor, angle, MISSILERANGE, slope, ((P_Random() % 5) + 1) * 3);
    }
  },
  A_CPosAttack(actor) {
    if (!actor.target) return;
    S_StartSound(actor, SFX.shotgn);
    faceTarget(actor);
    const slope = aimLineAttack(actor, actor.angle, MISSILERANGE);
    const angle = normAngle(actor.angle + ((P_Random() - P_Random()) << 20) * BAM);
    lineAttack(actor, angle, MISSILERANGE, slope, ((P_Random() % 5) + 1) * 3);
  },
  A_CPosRefire(actor) { refire(actor, 40); },
  A_SpidRefire(actor) { refire(actor, 10); },
  A_TroopAttack(actor) {
    if (!actor.target) return;
    faceTarget(actor);
    if (checkMeleeRange(actor)) { S_StartSound(actor, SFX.claw); damageMobj(actor.target, actor, actor, (P_Random() % 8 + 1) * 3); return; }
    spawnMissile(actor, actor.target, MT.TROOPSHOT);
  },
  A_SargAttack(actor) {
    if (!actor.target) return;
    faceTarget(actor);
    if (checkMeleeRange(actor)) damageMobj(actor.target, actor, actor, ((P_Random() % 10) + 1) * 4);
  },
  A_HeadAttack(actor) {
    if (!actor.target) return;
    faceTarget(actor);
    if (checkMeleeRange(actor)) { damageMobj(actor.target, actor, actor, (P_Random() % 6 + 1) * 10); return; }
    spawnMissile(actor, actor.target, MT.HEADSHOT);
  },
  A_CyberAttack(actor) { if (!actor.target) return; faceTarget(actor); spawnMissile(actor, actor.target, MT.ROCKET); },
  A_BruisAttack(actor) {
    if (!actor.target) return;
    if (checkMeleeRange(actor)) { S_StartSound(actor, SFX.claw); damageMobj(actor.target, actor, actor, (P_Random() % 8 + 1) * 10); return; }
    spawnMissile(actor, actor.target, MT.BRUISERSHOT);
  },
  A_SkullAttack(actor) {
    if (!actor.target) return;
    const dest = actor.target;
    actor.flags |= MF_SKULLFLY;
    S_StartSound(actor, actor.info.attacksound);
    faceTarget(actor);
    actor.momx = 20 * Math.cos(actor.angle); actor.momy = 20 * Math.sin(actor.angle);
    const dist = Math.max(1, Math.floor(approxDist(dest.x - actor.x, dest.y - actor.y) / 20));
    actor.momz = (dest.z + dest.height / 2 - actor.z) / dist;
  },
  A_Scream(actor) {
    let sound = actor.info.deathsound;
    if (!sound) return;
    if (sound === SFX.podth1 || sound === SFX.podth2 || sound === SFX.podth3) sound = SFX.podth1 + P_Random() % 3;
    else if (sound === SFX.bgdth1 || sound === SFX.bgdth2) sound = SFX.bgdth1 + P_Random() % 2;
    S_StartSound(fullVolume(actor) ? null : actor, sound);
  },
  A_XScream(actor) { S_StartSound(actor, SFX.slop); },
  A_Pain(actor) { if (actor.info.painsound) S_StartSound(actor, actor.info.painsound); },
  A_Fall(actor) { actor.flags &= ~MF_SOLID; },
  A_Explode(thing) { radiusAttack(thing, thing.target, 128); },
  A_BossDeath: bossDeath,
  A_Hoof(mo) { S_StartSound(mo, SFX.hoof); ACTIONS.A_Chase(mo); },
  A_Metal(mo) { S_StartSound(mo, SFX.metal); ACTIONS.A_Chase(mo); },
  A_BabyMetal(mo) { S_StartSound(mo, SFX.bspwlk); ACTIONS.A_Chase(mo); },
  A_PlayerScream(mo) { S_StartSound(mo, SFX.pldeth); },
  // Doom II monsters (not present in DOOM.WAD maps): approximate with the nearest Doom 1 behaviour
  A_SkelMissile(a) { if (!a.target) return; faceTarget(a); spawnMissile(a, a.target, MT.TRACER); },
  A_SkelFist(a) { if (!a.target) return; faceTarget(a); if (checkMeleeRange(a)) { S_StartSound(a, SFX.skepch); damageMobj(a.target, a, a, ((P_Random() % 10) + 1) * 6); } },
  A_SkelWhoosh(a) { faceTarget(a); S_StartSound(a, SFX.skeswg); },
  A_FatRaise(a) { faceTarget(a); S_StartSound(a, SFX.manatk); },
  A_FatAttack1(a) { if (a.target) { faceTarget(a); spawnMissile(a, a.target, MT.FATSHOT); } },
  A_FatAttack2(a) { if (a.target) { faceTarget(a); spawnMissile(a, a.target, MT.FATSHOT); } },
  A_FatAttack3(a) { if (a.target) { faceTarget(a); spawnMissile(a, a.target, MT.FATSHOT); } },
  A_BspiAttack(a) { if (a.target) { faceTarget(a); spawnMissile(a, a.target, MT.ARACHPLAZ); } },
  A_VileChase(a) { ACTIONS.A_Chase(a); },
});
