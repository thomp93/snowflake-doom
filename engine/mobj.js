// ---- p_mobj.c / p_map.c / p_tick.c / m_random.c : map objects, movement, collision, hitscan ----
const F = INFO.flags;
const { MF_SPECIAL, MF_SOLID, MF_SHOOTABLE, MF_NOSECTOR, MF_NOBLOCKMAP, MF_AMBUSH, MF_JUSTHIT, MF_JUSTATTACKED,
  MF_SPAWNCEILING, MF_NOGRAVITY, MF_DROPOFF, MF_PICKUP, MF_NOCLIP, MF_SLIDE, MF_FLOAT, MF_TELEPORT, MF_MISSILE,
  MF_DROPPED, MF_SHADOW, MF_NOBLOOD, MF_CORPSE, MF_INFLOAT, MF_COUNTKILL, MF_COUNTITEM, MF_SKULLFLY } = F;
const MT = {}, S = {}, SFX = {};
INFO.mobjtypes.forEach((n, i) => MT[n.slice(3)] = i);
INFO.statenames.forEach((n, i) => S[n.slice(2)] = i);
INFO.sfx.forEach((n, i) => SFX[n] = i);
const STATES = INFO.states.map((s, i) => ({ id: i, sprite: s[0], frame: s[1], tics: s[2], actionName: s[3], action: null, nextstate: s[4], misc1: s[5], misc2: s[6] }));
const ACTIONS = {};   // filled by enemy.js / user.js
function bindActions() { for (const st of STATES) st.action = st.actionName ? (ACTIONS[st.actionName] || null) : null; }

const GRAVITY = 1, MAXMOVE = 30, FRICTION = 0xe800 / 65536, STOPSPEED = 0x1000 / 65536, FLOATSPEED = 4;
const VIEWHEIGHT = 41, MAXBOB = 16, MELEERANGE = 64, MISSILERANGE = 2048, USERANGE = 64;
const ONFLOORZ = -Infinity, ONCEILINGZ = Infinity;
const BAM = TAU / 4294967296;          // radians per binary angle unit
const sk_baby = 0, sk_easy = 1, sk_medium = 2, sk_hard = 3, sk_nightmare = 4;

// game globals
const G = { skill: sk_medium, episode: 1, map: 1, leveltime: 0, totalkills: 0, totalitems: 0, totalsecret: 0, exit: null };
let mobjs = [], thinkers = [], players = [];

// m_random.c
let prndindex = 0, rndindex = 0;
const P_Random = () => INFO.rndtable[prndindex = (prndindex + 1) & 0xff];
const M_Random = () => INFO.rndtable[rndindex = (rndindex + 1) & 0xff];

function addThinker(t) { t.removed = false; thinkers.push(t); return t; }
function removeThinker(t) { t.removed = true; }
function runThinkers() {
  for (let i = 0; i < thinkers.length; i++) { const t = thinkers[i]; if (!t.removed && !t.frozen) t.think(); }
  if (G.leveltime % 35 === 0) { thinkers = thinkers.filter(t => !t.removed); mobjs = mobjs.filter(m => !m.removed); }
}

// ---- P_SpawnMobj / P_RemoveMobj / P_SetMobjState ----
function setThingPosition(mo) {
  mo.subsector = pointInSubsector(mo.x, mo.y);
  if (!(mo.flags & MF_NOSECTOR)) mo.subsector.sector.thinglist.add(mo);
}
function unsetThingPosition(mo) { if (!(mo.flags & MF_NOSECTOR) && mo.subsector) mo.subsector.sector.thinglist.delete(mo); }

function spawnMobj(x, y, z, type) {
  const info = INFO.mobjinfo[type];
  const mo = {
    type, info, x, y, z: 0, angle: 0, momx: 0, momy: 0, momz: 0, radius: info.radius, height: info.height, flags: info.flags,
    health: info.spawnhealth, reactiontime: G.skill !== sk_nightmare ? info.reactiontime : 0, lastlook: P_Random() % 4,
    target: null, tracer: null, player: null, movedir: 8, movecount: 0, threshold: 0, state: null, tics: 0, sprite: 0, frame: 0,
    floorz: 0, ceilingz: 0, subsector: null, spawnpoint: null, think() { mobjThinker(this); },
  };
  const st = STATES[info.spawnstate];
  mo.state = st; mo.tics = st.tics; mo.sprite = st.sprite; mo.frame = st.frame;
  setThingPosition(mo);
  mo.floorz = mo.subsector.sector.floorheight; mo.ceilingz = mo.subsector.sector.ceilingheight;
  mo.z = z === ONFLOORZ ? mo.floorz : z === ONCEILINGZ ? mo.ceilingz - mo.height : z;
  mobjs.push(mo); addThinker(mo);
  return mo;
}
function removeMobj(mo) {
  if (mo.removed) return;
  unsetThingPosition(mo);
  S_StopSound(mo);
  removeThinker(mo);
}
function setMobjState(mo, state) {
  do {
    if (state === S.NULL) { mo.state = null; removeMobj(mo); return false; }
    const st = STATES[state];
    mo.state = st; mo.tics = st.tics; mo.sprite = st.sprite; mo.frame = st.frame;
    if (st.action) st.action(mo);
    if (mo.removed) return false;
    state = st.nextstate;
  } while (!mo.tics);
  return true;
}

function mobjThinker(mo) {
  if (mo.momx || mo.momy || (mo.flags & MF_SKULLFLY)) { xyMovement(mo); if (mo.removed) return; }
  if (mo.z !== mo.floorz || mo.momz) { zMovement(mo); if (mo.removed) return; }
  if (mo.tics !== -1) {
    mo.tics--;
    if (!mo.tics) setMobjState(mo, mo.state.nextstate);
  } else if ((mo.flags & MF_COUNTKILL) && G.skill === sk_nightmare) {
    mo.movecount++;
    if (mo.movecount >= 12 * 35 && !(G.leveltime & 31) && P_Random() <= 4) nightmareRespawn(mo);
  }
}
function nightmareRespawn(mo) {
  const sp = mo.spawnpoint; if (!sp) return;
  if (!checkPosition(mo, sp.x, sp.y)) return;
  const fog = spawnMobj(mo.x, mo.y, mo.subsector.sector.floorheight, MT.TFOG); S_StartSound(fog, SFX.telept);
  const ss = pointInSubsector(sp.x, sp.y);
  S_StartSound(spawnMobj(sp.x, sp.y, ss.sector.floorheight, MT.TFOG), SFX.telept);
  const m = spawnMobj(sp.x, sp.y, mo.info.flags & MF_SPAWNCEILING ? ONCEILINGZ : ONFLOORZ, mo.type);
  m.spawnpoint = sp; m.angle = ANG45 * Math.floor(sp.angle / 45) % TAU;
  if (sp.options & 8) m.flags |= MF_AMBUSH;
  m.reactiontime = 18;
  removeMobj(mo);
}

// ---- P_XYMovement / P_ZMovement ----
function xyMovement(mo) {
  if (!mo.momx && !mo.momy) {
    if (mo.flags & MF_SKULLFLY) { mo.flags &= ~MF_SKULLFLY; mo.momx = mo.momy = mo.momz = 0; setMobjState(mo, mo.info.spawnstate); }
    return;
  }
  const pl = mo.player;
  mo.momx = Math.max(-MAXMOVE, Math.min(MAXMOVE, mo.momx));
  mo.momy = Math.max(-MAXMOVE, Math.min(MAXMOVE, mo.momy));
  let xmove = mo.momx, ymove = mo.momy;
  do {
    let px, py;
    if (xmove > MAXMOVE / 2 || ymove > MAXMOVE / 2) { px = mo.x + xmove / 2; py = mo.y + ymove / 2; xmove /= 2; ymove /= 2; }
    else { px = mo.x + xmove; py = mo.y + ymove; xmove = ymove = 0; }
    if (!tryMove(mo, px, py)) {
      if (pl) slideMove(mo);
      else if (mo.flags & MF_MISSILE) {
        if (tm.ceilingline && tm.ceilingline.backsector && tm.ceilingline.backsector.ceilingpic === gfx.skyflat) { removeMobj(mo); return; }
        explodeMissile(mo); return;
      } else mo.momx = mo.momy = 0;
    }
  } while (xmove || ymove);
  if (pl && (pl.cheats & CF_NOMOMENTUM)) { mo.momx = mo.momy = 0; return; }
  if (mo.flags & (MF_MISSILE | MF_SKULLFLY)) return;
  if (mo.z > mo.floorz) return;
  if (mo.flags & MF_CORPSE) {
    if ((Math.abs(mo.momx) > 0.25 || Math.abs(mo.momy) > 0.25) && mo.floorz !== mo.subsector.sector.floorheight) return;
  }
  if (Math.abs(mo.momx) < STOPSPEED && Math.abs(mo.momy) < STOPSPEED && (!pl || (!pl.cmd.forwardmove && !pl.cmd.sidemove))) {
    if (pl && mo.state.id >= S.PLAY_RUN1 && mo.state.id <= S.PLAY_RUN4) setMobjState(mo, S.PLAY);
    mo.momx = mo.momy = 0;
  } else { mo.momx *= FRICTION; mo.momy *= FRICTION; }
}
function zMovement(mo) {
  const pl = mo.player;
  if (pl && mo.z < mo.floorz) { pl.viewheight -= mo.floorz - mo.z; pl.deltaviewheight = (VIEWHEIGHT - pl.viewheight) / 8; }
  mo.z += mo.momz;
  if ((mo.flags & MF_FLOAT) && mo.target && !(mo.flags & (MF_SKULLFLY | MF_INFLOAT))) {
    const dist = approxDist(mo.x - mo.target.x, mo.y - mo.target.y);
    const delta = mo.target.z + mo.height / 2 - mo.z;
    if (delta < 0 && dist < -delta * 3) mo.z -= FLOATSPEED; else if (delta > 0 && dist < delta * 3) mo.z += FLOATSPEED;
  }
  if (mo.z <= mo.floorz) {
    if (mo.flags & MF_SKULLFLY) mo.momz = -mo.momz;
    if (mo.momz < 0) {
      if (pl && mo.momz < -GRAVITY * 8) { pl.deltaviewheight = mo.momz / 8; S_StartSound(mo, SFX.oof); }
      mo.momz = 0;
    }
    mo.z = mo.floorz;
    if ((mo.flags & MF_MISSILE) && !(mo.flags & MF_NOCLIP)) { explodeMissile(mo); return; }
  } else if (!(mo.flags & MF_NOGRAVITY)) mo.momz = mo.momz === 0 ? -GRAVITY * 2 : mo.momz - GRAVITY;
  if (mo.z + mo.height > mo.ceilingz) {
    if (mo.momz > 0) mo.momz = 0;
    mo.z = mo.ceilingz - mo.height;
    if (mo.flags & MF_SKULLFLY) mo.momz = -mo.momz;
    if ((mo.flags & MF_MISSILE) && !(mo.flags & MF_NOCLIP)) explodeMissile(mo);
  }
}

// ---- P_CheckPosition / P_TryMove ----
const tm = { thing: null, flags: 0, x: 0, y: 0, bbox: [0, 0, 0, 0], floorz: 0, ceilingz: 0, dropoffz: 0, ceilingline: null, spechit: [], floatok: false };
function checkThing(th) {
  if (!(th.flags & (MF_SOLID | MF_SPECIAL | MF_SHOOTABLE))) return true;
  const t = tm.thing, blockdist = th.radius + t.radius;
  if (Math.abs(th.x - tm.x) >= blockdist || Math.abs(th.y - tm.y) >= blockdist) return true;
  if (th === t) return true;
  if (t.flags & MF_SKULLFLY) {
    damageMobj(th, t, t, ((P_Random() % 8) + 1) * t.info.damage);
    t.flags &= ~MF_SKULLFLY; t.momx = t.momy = t.momz = 0;
    setMobjState(t, t.info.spawnstate);
    return false;
  }
  if (t.flags & MF_MISSILE) {
    if (t.z > th.z + th.height || t.z + t.height < th.z) return true;
    if (t.target && (t.target.type === th.type || (t.target.type === MT.KNIGHT && th.type === MT.BRUISER) || (t.target.type === MT.BRUISER && th.type === MT.KNIGHT))) {
      if (th === t.target) return true;
      if (th.type !== MT.PLAYER) return false;
    }
    if (!(th.flags & MF_SHOOTABLE)) return !(th.flags & MF_SOLID);
    damageMobj(th, t, t.target, ((P_Random() % 8) + 1) * t.info.damage);
    return false;
  }
  if (th.flags & MF_SPECIAL) {
    const solid = th.flags & MF_SOLID;
    if (tm.flags & MF_PICKUP) touchSpecialThing(th, t);
    return !solid;
  }
  return !(th.flags & MF_SOLID);
}
function checkLine(ld) {
  const b = tm.bbox;
  if (b[3] <= ld.bbox[2] || b[2] >= ld.bbox[3] || b[0] <= ld.bbox[1] || b[1] >= ld.bbox[0]) return true;
  if (boxOnLineSide(b, ld) !== -1) return true;
  if (!ld.backsector) return false;
  if (!(tm.thing.flags & MF_MISSILE)) {
    if (ld.flags & ML_BLOCKING) return false;
    if (!tm.thing.player && (ld.flags & ML_BLOCKMONSTERS)) return false;
  }
  lineOpening(ld);
  if (opening.top < tm.ceilingz) { tm.ceilingz = opening.top; tm.ceilingline = ld; }
  if (opening.bottom > tm.floorz) tm.floorz = opening.bottom;
  if (opening.lowfloor < tm.dropoffz) tm.dropoffz = opening.lowfloor;
  if (ld.special) tm.spechit.push(ld);
  return true;
}
function checkPosition(th, x, y) {
  tm.thing = th; tm.flags = th.flags; tm.x = x; tm.y = y;
  const r = th.radius, b = tm.bbox;
  b[0] = y + r; b[1] = y - r; b[2] = x - r; b[3] = x + r;
  const ss = pointInSubsector(x, y);
  tm.ceilingline = null;
  tm.floorz = tm.dropoffz = ss.sector.floorheight; tm.ceilingz = ss.sector.ceilingheight;
  validcount++;
  tm.spechit = [];
  if (tm.flags & MF_NOCLIP) return true;
  for (const m of mobjs) {
    if (m.removed || Math.abs(m.x - x) > r + MAXRADIUS || Math.abs(m.y - y) > r + MAXRADIUS) continue;
    if (!checkThing(m)) return false;
  }
  const [x0, x1, y0, y1] = blockRange(b);
  for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) if (!blockLinesIterator(bx, by, checkLine)) return false;
  return true;
}
function tryMove(th, x, y) {
  tm.floatok = false;
  if (!checkPosition(th, x, y)) return false;
  if (!(th.flags & MF_NOCLIP)) {
    if (tm.ceilingz - tm.floorz < th.height) return false;
    tm.floatok = true;
    if (!(th.flags & MF_TELEPORT) && tm.ceilingz - th.z < th.height) return false;
    if (!(th.flags & MF_TELEPORT) && tm.floorz - th.z > 24) return false;
    if (!(th.flags & (MF_DROPOFF | MF_FLOAT)) && tm.floorz - tm.dropoffz > 24) return false;
  }
  unsetThingPosition(th);
  const ox = th.x, oy = th.y;
  th.floorz = tm.floorz; th.ceilingz = tm.ceilingz; th.x = x; th.y = y;
  setThingPosition(th);
  if (!(th.flags & (MF_TELEPORT | MF_NOCLIP))) {
    const sh = tm.spechit.slice();
    for (let i = sh.length - 1; i >= 0; i--) {
      const ld = sh[i], side = pointOnLineSide(th.x, th.y, ld), oldside = pointOnLineSide(ox, oy, ld);
      if (side !== oldside && ld.special) crossSpecialLine(ld, oldside, th);
    }
  }
  return true;
}
function thingHeightClip(th) {
  const onfloor = th.z === th.floorz;
  checkPosition(th, th.x, th.y);
  th.floorz = tm.floorz; th.ceilingz = tm.ceilingz;
  if (onfloor) th.z = th.floorz; else if (th.z + th.height > th.ceilingz) th.z = th.ceilingz - th.height;
  return th.ceilingz - th.floorz >= th.height;
}

// ---- P_SlideMove ----
let slidemo, bestslidefrac, bestslideline, tmxmove, tmymove;
function slideTraverse(it) {
  const li = it.line;
  if (!(li.flags & ML_TWOSIDED)) { if (pointOnLineSide(slidemo.x, slidemo.y, li)) return true; }
  else {
    lineOpening(li);
    if (opening.range >= slidemo.height && opening.top - slidemo.z >= slidemo.height && opening.bottom - slidemo.z <= 24) return true;
  }
  if (it.frac < bestslidefrac) { bestslidefrac = it.frac; bestslideline = li; }
  return false;
}
function hitSlideLine(ld) {
  if (ld.slopetype === ST_HORIZONTAL) { tmymove = 0; return; }
  if (ld.slopetype === ST_VERTICAL) { tmxmove = 0; return; }
  const side = pointOnLineSide(slidemo.x, slidemo.y, ld);
  let lineangle = pointToAngle(0, 0, ld.dx, ld.dy);
  if (side === 1) lineangle = normAngle(lineangle + ANG180);
  const moveangle = pointToAngle(0, 0, tmxmove, tmymove);
  let delta = normAngle(moveangle - lineangle);
  if (delta > ANG180) delta = normAngle(delta + ANG180);
  const newlen = approxDist(tmxmove, tmymove) * Math.cos(delta);
  tmxmove = newlen * Math.cos(lineangle); tmymove = newlen * Math.sin(lineangle);
}
function slideMove(mo) {
  slidemo = mo;
  for (let hit = 0; hit < 3; hit++) {
    let leadx, leady, trailx, traily;
    if (mo.momx > 0) { leadx = mo.x + mo.radius; trailx = mo.x - mo.radius; } else { leadx = mo.x - mo.radius; trailx = mo.x + mo.radius; }
    if (mo.momy > 0) { leady = mo.y + mo.radius; traily = mo.y - mo.radius; } else { leady = mo.y - mo.radius; traily = mo.y + mo.radius; }
    bestslidefrac = 1.00002;
    pathTraverse(leadx, leady, leadx + mo.momx, leady + mo.momy, PT_ADDLINES, slideTraverse);
    pathTraverse(trailx, leady, trailx + mo.momx, leady + mo.momy, PT_ADDLINES, slideTraverse);
    pathTraverse(leadx, traily, leadx + mo.momx, traily + mo.momy, PT_ADDLINES, slideTraverse);
    if (bestslidefrac === 1.00002) break;
    bestslidefrac -= 1 / 32;
    if (bestslidefrac > 0 && !tryMove(mo, mo.x + mo.momx * bestslidefrac, mo.y + mo.momy * bestslidefrac)) break;
    bestslidefrac = 1 - (bestslidefrac + 1 / 32);
    if (bestslidefrac > 1) bestslidefrac = 1;
    if (bestslidefrac <= 0) return;
    tmxmove = mo.momx * bestslidefrac; tmymove = mo.momy * bestslidefrac;
    hitSlideLine(bestslideline);
    mo.momx = tmxmove; mo.momy = tmymove;
    if (tryMove(mo, mo.x + tmxmove, mo.y + tmymove)) return;
  }
  // stairstep
  if (!tryMove(mo, mo.x, mo.y + mo.momy)) tryMove(mo, mo.x + mo.momx, mo.y);
}

// ---- hitscan: P_AimLineAttack / P_LineAttack ----
let shootthing, shootz, attackrange, aimslope, la_damage, linetarget, aimtop, aimbottom;
function aimTraverse(it) {
  if (it.line) {
    const li = it.line;
    if (!(li.flags & ML_TWOSIDED)) return false;
    lineOpening(li);
    if (opening.bottom >= opening.top) return false;
    const dist = attackrange * it.frac;
    if (li.frontsector.floorheight !== li.backsector.floorheight) { const s = (opening.bottom - shootz) / dist; if (s > aimbottom) aimbottom = s; }
    if (li.frontsector.ceilingheight !== li.backsector.ceilingheight) { const s = (opening.top - shootz) / dist; if (s < aimtop) aimtop = s; }
    return aimtop > aimbottom;
  }
  const th = it.thing;
  if (th === shootthing || !(th.flags & MF_SHOOTABLE)) return true;
  const dist = attackrange * it.frac;
  let tt = (th.z + th.height - shootz) / dist; if (tt < aimbottom) return true;
  let tb = (th.z - shootz) / dist; if (tb > aimtop) return true;
  if (tt > aimtop) tt = aimtop; if (tb < aimbottom) tb = aimbottom;
  aimslope = (tt + tb) / 2; linetarget = th;
  return false;
}
function aimLineAttack(t1, angle, distance) {
  const x2 = t1.x + distance * Math.cos(angle), y2 = t1.y + distance * Math.sin(angle);
  shootthing = t1; shootz = t1.z + t1.height / 2 + 8;
  aimtop = 100 / 160; aimbottom = -100 / 160; attackrange = distance; linetarget = null;
  pathTraverse(t1.x, t1.y, x2, y2, PT_ADDLINES | PT_ADDTHINGS, aimTraverse);
  return linetarget ? aimslope : 0;
}
function shootTraverse(it) {
  if (it.line) {
    const li = it.line;
    if (li.special) shootSpecialLine(shootthing, li);
    let hit = !(li.flags & ML_TWOSIDED);
    if (!hit) {
      lineOpening(li);
      const dist = attackrange * it.frac;
      if (li.frontsector.floorheight !== li.backsector.floorheight && (opening.bottom - shootz) / dist > aimslope) hit = true;
      else if (li.frontsector.ceilingheight !== li.backsector.ceilingheight && (opening.top - shootz) / dist < aimslope) hit = true;
    }
    if (!hit) return true;
    const frac = it.frac - 4 / attackrange;
    const x = trace.x + trace.dx * frac, y = trace.y + trace.dy * frac, z = shootz + aimslope * frac * attackrange;
    if (li.frontsector.ceilingpic === gfx.skyflat) {
      if (z > li.frontsector.ceilingheight) return false;
      if (li.backsector && li.backsector.ceilingpic === gfx.skyflat) return false;
    }
    spawnPuff(x, y, z);
    return false;
  }
  const th = it.thing;
  if (th === shootthing || !(th.flags & MF_SHOOTABLE)) return true;
  const dist = attackrange * it.frac;
  if ((th.z + th.height - shootz) / dist < aimslope) return true;
  if ((th.z - shootz) / dist > aimslope) return true;
  const frac = it.frac - 10 / attackrange;
  const x = trace.x + trace.dx * frac, y = trace.y + trace.dy * frac, z = shootz + aimslope * frac * attackrange;
  if (th.flags & MF_NOBLOOD) spawnPuff(x, y, z); else spawnBlood(x, y, z, la_damage);
  if (la_damage) damageMobj(th, shootthing, shootthing, la_damage);
  return false;
}
function lineAttack(t1, angle, distance, slope, damage) {
  shootthing = t1; la_damage = damage;
  const x2 = t1.x + distance * Math.cos(angle), y2 = t1.y + distance * Math.sin(angle);
  shootz = t1.z + t1.height / 2 + 8; attackrange = distance; aimslope = slope;
  pathTraverse(t1.x, t1.y, x2, y2, PT_ADDLINES | PT_ADDTHINGS, shootTraverse);
}
function spawnPuff(x, y, z) {
  const th = spawnMobj(x, y, z + (P_Random() - P_Random()) / 64, MT.PUFF);
  th.momz = 1; th.tics -= P_Random() & 3; if (th.tics < 1) th.tics = 1;
  if (attackrange === MELEERANGE) setMobjState(th, S.PUFF3);
}
function spawnBlood(x, y, z, damage) {
  const th = spawnMobj(x, y, z + (P_Random() - P_Random()) / 64, MT.BLOOD);
  th.momz = 2; th.tics -= P_Random() & 3; if (th.tics < 1) th.tics = 1;
  if (damage <= 12 && damage >= 9) setMobjState(th, S.BLOOD2); else if (damage < 9) setMobjState(th, S.BLOOD3);
}

// ---- missiles ----
function checkMissileSpawn(th) {
  th.tics -= P_Random() & 3; if (th.tics < 1) th.tics = 1;
  th.x += th.momx / 2; th.y += th.momy / 2; th.z += th.momz / 2;
  if (!tryMove(th, th.x, th.y)) explodeMissile(th);
}
function explodeMissile(mo) {
  mo.momx = mo.momy = mo.momz = 0;
  setMobjState(mo, mo.info.deathstate);
  mo.tics -= P_Random() & 3; if (mo.tics < 1) mo.tics = 1;
  mo.flags &= ~MF_MISSILE;
  if (mo.info.deathsound) S_StartSound(mo, mo.info.deathsound);
}
function spawnMissile(source, dest, type) {
  const th = spawnMobj(source.x, source.y, source.z + 32, type);
  if (th.info.seesound) S_StartSound(th, th.info.seesound);
  th.target = source;
  let an = pointToAngle(source.x, source.y, dest.x, dest.y);
  if (dest.flags & MF_SHADOW) an = normAngle(an + ((P_Random() - P_Random()) << 20) * BAM);
  th.angle = an;
  const sp = th.info.speed;
  th.momx = sp * Math.cos(an); th.momy = sp * Math.sin(an);
  const dist = Math.max(1, Math.floor(approxDist(dest.x - source.x, dest.y - source.y) / sp));
  th.momz = (dest.z - source.z) / dist;
  checkMissileSpawn(th);
  return th;
}
function spawnPlayerMissile(source, type) {
  let an = source.angle, slope = aimLineAttack(source, an, 16 * 64);
  if (!linetarget) {
    an = normAngle(an + (1 << 26) * BAM); slope = aimLineAttack(source, an, 16 * 64);
    if (!linetarget) { an = normAngle(an - (2 << 26) * BAM); slope = aimLineAttack(source, an, 16 * 64); }
    if (!linetarget) { an = source.angle; slope = 0; }
  }
  const th = spawnMobj(source.x, source.y, source.z + 32, type);
  if (th.info.seesound) S_StartSound(th, th.info.seesound);
  th.target = source; th.angle = an;
  const sp = th.info.speed;
  th.momx = sp * Math.cos(an); th.momy = sp * Math.sin(an); th.momz = sp * slope;
  checkMissileSpawn(th);
}

// ---- P_RadiusAttack ----
function radiusAttack(spot, source, damage) {
  for (const th of mobjs) {
    if (th.removed || !(th.flags & MF_SHOOTABLE)) continue;
    if (th.type === MT.CYBORG || th.type === MT.SPIDER) continue;
    let dist = Math.max(Math.abs(th.x - spot.x), Math.abs(th.y - spot.y)) - th.radius;
    if (dist < 0) dist = 0;
    if (dist >= damage) continue;
    if (checkSight(th, spot)) damageMobj(th, spot, source, Math.floor(damage - dist));
  }
}

// ---- P_UseLines ----
let usething;
function useTraverse(it) {
  const li = it.line;
  if (!li.special) {
    lineOpening(li);
    if (opening.range <= 0) { S_StartSound(usething, SFX.noway); return false; }
    return true;
  }
  const side = pointOnLineSide(usething.x, usething.y, li);
  if (side === 1) return false;
  useSpecialLine(usething, li, side);
  return false;
}
function useLines(pl) {
  usething = pl.mo;
  const a = pl.mo.angle;
  pathTraverse(pl.mo.x, pl.mo.y, pl.mo.x + USERANGE * Math.cos(a), pl.mo.y + USERANGE * Math.sin(a), PT_ADDLINES, useTraverse);
}

// ---- P_TeleportMove (telefrag) ----
function teleportMove(th, x, y) {
  const r = th.radius, ss = pointInSubsector(x, y);
  for (const m of mobjs) {
    if (m.removed || m === th || !(m.flags & MF_SHOOTABLE)) continue;
    const bd = m.radius + r;
    if (Math.abs(m.x - x) >= bd || Math.abs(m.y - y) >= bd) continue;
    if (!th.player) return false;
    damageMobj(m, th, th, 10000);
  }
  th.floorz = ss.sector.floorheight; th.ceilingz = ss.sector.ceilingheight;
  unsetThingPosition(th); th.x = x; th.y = y; setThingPosition(th);
  return true;
}

// ---- P_ChangeSector (crushers, moving floors) ----
function changeSector(sec, crush) {
  let nofit = false;
  const bb = sec.bbox;
  for (const th of mobjs) {
    if (th.removed || (th.flags & MF_NOBLOCKMAP)) continue;
    if (th.x + th.radius < bb[2] - MAXRADIUS || th.x - th.radius > bb[3] + MAXRADIUS || th.y + th.radius < bb[1] - MAXRADIUS || th.y - th.radius > bb[0] + MAXRADIUS) continue;
    if (thingHeightClip(th)) continue;
    if (th.health <= 0) { setMobjState(th, S.GIBS); th.flags &= ~MF_SOLID; th.height = 0; th.radius = 0; continue; }
    if (th.flags & MF_DROPPED) { removeMobj(th); continue; }
    if (!(th.flags & MF_SHOOTABLE)) continue;
    nofit = true;
    if (crush && !(G.leveltime & 3)) {
      damageMobj(th, null, null, 10);
      const mo = spawnMobj(th.x, th.y, th.z + th.height / 2, MT.BLOOD);
      mo.momx = (P_Random() - P_Random()) / 16; mo.momy = (P_Random() - P_Random()) / 16;
    }
  }
  return nofit;
}

// ---- P_NoiseAlert ----
function recursiveSound(sec, soundblocks, target) {
  if (sec.validcount === validcount && sec.soundtraversed <= soundblocks + 1) return;
  sec.validcount = validcount; sec.soundtraversed = soundblocks + 1; sec.soundtarget = target;
  for (const ln of sec.lines) {
    if (!(ln.flags & ML_TWOSIDED)) continue;
    lineOpening(ln);
    if (opening.range <= 0) continue;
    const other = ln.frontsector === sec ? ln.backsector : ln.frontsector;
    if (ln.flags & ML_SOUNDBLOCK) { if (!soundblocks) recursiveSound(other, 1, target); }
    else recursiveSound(other, soundblocks, target);
  }
}
function noiseAlert(target, emitter) { validcount++; recursiveSound(emitter.subsector.sector, 0, target); }
