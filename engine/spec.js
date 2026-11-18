// ---- p_spec.c / p_doors.c / p_plats.c / p_floor.c / p_ceilng.c / p_lights.c / p_switch.c / p_telept.c ----
const TICRATE = 35, VDOORSPEED = 2, VDOORWAIT = 150, PLATSPEED = 1, PLATWAIT = 3, FLOORSPEED = 1, CEILSPEED = 1;
const FASTDARK = 15, SLOWDARK = 35, STROBEBRIGHT = 5, GLOWSPEED = 8, BUTTONTIME = 35;
let activeplats = [], activeceilings = [], buttons = [], scrollers = [], anims = [], switchlist = [];

const sectorsByTag = tag => level.sectors.filter(s => s.tag === tag);
function nextSector(ln, sec) { if (!(ln.flags & ML_TWOSIDED)) return null; return ln.frontsector === sec ? ln.backsector : ln.frontsector; }
function neighbours(sec) { const out = []; for (const ln of sec.lines) { const o = nextSector(ln, sec); if (o) out.push(o); } return out; }
const lowestFloorSurrounding = s => Math.min(s.floorheight, ...neighbours(s).map(o => o.floorheight));
const highestFloorSurrounding = s => Math.max(-500, ...neighbours(s).map(o => o.floorheight));
const lowestCeilingSurrounding = s => Math.min(32767, ...neighbours(s).map(o => o.ceilingheight));
const highestCeilingSurrounding = s => Math.max(0, ...neighbours(s).map(o => o.ceilingheight));
const minSurroundingLight = (s, max) => Math.min(max, ...neighbours(s).map(o => o.lightlevel));
function nextHighestFloor(s, h) { const hs = neighbours(s).map(o => o.floorheight).filter(f => f > h); return hs.length ? Math.min(...hs) : h; }
const sndSec = (sec, id) => S_StartSound(sec.soundorg, id);

// T_MovePlane: returns 'ok' | 'crushed' | 'pastdest'
function movePlane(sec, speed, dest, crush, ceiling, dir) {
  const key = ceiling ? 'ceilingheight' : 'floorheight', last = sec[key];
  if (dir < 0) {
    if (sec[key] - speed < dest) { sec[key] = dest; if (changeSector(sec, crush)) { sec[key] = last; changeSector(sec, crush); } return 'pastdest'; }
    sec[key] -= speed;
    if (changeSector(sec, crush)) {
      if (ceiling && crush) return 'crushed';
      sec[key] = last; changeSector(sec, crush); return 'crushed';
    }
  } else {
    if (sec[key] + speed > dest) { sec[key] = dest; if (changeSector(sec, crush)) { sec[key] = last; changeSector(sec, crush); } return 'pastdest'; }
    sec[key] += speed;
    if (changeSector(sec, crush) && !ceiling) {
      if (crush) return 'crushed';
      sec[key] = last; changeSector(sec, crush); return 'crushed';
    }
  }
  return 'ok';
}

// ---- doors ----
function doorThinker(sec, type, props) {
  const d = Object.assign({ sector: sec, type, topwait: VDOORWAIT, speed: VDOORSPEED, direction: 1, topheight: 0, topcountdown: 0, think() { verticalDoor(this); } }, props);
  sec.specialdata = d; return addThinker(d);
}
function verticalDoor(d) {
  const sec = d.sector;
  switch (d.direction) {
    case 0:
      if (!--d.topcountdown) {
        if (d.type === 'blazeRaise') { d.direction = -1; sndSec(sec, SFX.bdcls); }
        else if (d.type === 'normal') { d.direction = -1; sndSec(sec, SFX.dorcls); }
        else if (d.type === 'close30ThenOpen') { d.direction = 1; sndSec(sec, SFX.doropn); }
      }
      break;
    case 2:
      if (!--d.topcountdown && d.type === 'raiseIn5Mins') { d.direction = 1; d.type = 'normal'; sndSec(sec, SFX.doropn); }
      break;
    case -1: {
      const res = movePlane(sec, d.speed, sec.floorheight, false, true, -1);
      if (res === 'pastdest') {
        if (d.type === 'blazeRaise' || d.type === 'blazeClose') { sec.specialdata = null; removeThinker(d); sndSec(sec, SFX.bdcls); }
        else if (d.type === 'normal' || d.type === 'close') { sec.specialdata = null; removeThinker(d); }
        else if (d.type === 'close30ThenOpen') { d.direction = 0; d.topcountdown = TICRATE * 30; }
      } else if (res === 'crushed' && d.type !== 'blazeClose' && d.type !== 'close') { d.direction = 1; sndSec(sec, SFX.doropn); }
      break;
    }
    case 1: {
      const res = movePlane(sec, d.speed, d.topheight, false, true, 1);
      if (res === 'pastdest') {
        if (d.type === 'blazeRaise' || d.type === 'normal') { d.direction = 0; d.topcountdown = d.topwait; }
        else { sec.specialdata = null; removeThinker(d); }
      }
      break;
    }
  }
}
function doDoor(line, type) {
  let rtn = false;
  for (const sec of sectorsByTag(line.tag)) {
    if (sec.specialdata) continue;
    rtn = true;
    const d = doorThinker(sec, type, {});
    switch (type) {
      case 'blazeClose': d.topheight = lowestCeilingSurrounding(sec) - 4; d.direction = -1; d.speed = VDOORSPEED * 4; sndSec(sec, SFX.bdcls); break;
      case 'close': d.topheight = lowestCeilingSurrounding(sec) - 4; d.direction = -1; sndSec(sec, SFX.dorcls); break;
      case 'close30ThenOpen': d.topheight = sec.ceilingheight; d.direction = -1; sndSec(sec, SFX.dorcls); break;
      case 'blazeRaise': case 'blazeOpen':
        d.direction = 1; d.topheight = lowestCeilingSurrounding(sec) - 4; d.speed = VDOORSPEED * 4;
        if (d.topheight !== sec.ceilingheight) sndSec(sec, SFX.bdopn); break;
      default:
        d.direction = 1; d.topheight = lowestCeilingSurrounding(sec) - 4;
        if (d.topheight !== sec.ceilingheight) sndSec(sec, SFX.doropn);
    }
  }
  return rtn;
}
function hasKey(pl, card, skull) { return pl.cards[card] || pl.cards[skull]; }
function lockedFail(pl, msg) { pl.message = msg; S_StartSound(null, SFX.oof); return false; }
function doLockedDoor(line, type, thing) {
  const pl = thing.player; if (!pl) return false;
  if ((line.special === 99 || line.special === 133) && !hasKey(pl, it_bluecard, it_blueskull)) return lockedFail(pl, TXT.PD_BLUEO);
  if ((line.special === 134 || line.special === 135) && !hasKey(pl, it_redcard, it_redskull)) return lockedFail(pl, TXT.PD_REDO);
  if ((line.special === 136 || line.special === 137) && !hasKey(pl, it_yellowcard, it_yellowskull)) return lockedFail(pl, TXT.PD_YELLOWO);
  return doDoor(line, type);
}
function evVerticalDoor(line, thing) {
  const pl = thing.player;
  switch (line.special) {
    case 26: case 32: if (!pl) return; if (!hasKey(pl, it_bluecard, it_blueskull)) return lockedFail(pl, TXT.PD_BLUEK); break;
    case 27: case 34: if (!pl) return; if (!hasKey(pl, it_yellowcard, it_yellowskull)) return lockedFail(pl, TXT.PD_YELLOWK); break;
    case 28: case 33: if (!pl) return; if (!hasKey(pl, it_redcard, it_redskull)) return lockedFail(pl, TXT.PD_REDK); break;
  }
  if (line.sidenum[1] < 0) return;
  const sec = level.sides[line.sidenum[1]].sector;
  if (sec.specialdata) {
    const d = sec.specialdata;
    if ([1, 26, 27, 28, 117].includes(line.special) && isDoor(d)) {
      if (d.direction === -1) d.direction = 1;
      else { if (!pl) return; d.direction = -1; }
    }
    return;
  }
  sndSec(sec, line.special === 117 || line.special === 118 ? SFX.bdopn : SFX.doropn);
  const d = doorThinker(sec, 'normal', {});
  switch (line.special) {
    case 31: case 32: case 33: case 34: d.type = 'open'; line.special = 0; break;
    case 117: d.type = 'blazeRaise'; d.speed = VDOORSPEED * 4; break;
    case 118: d.type = 'blazeOpen'; line.special = 0; d.speed = VDOORSPEED * 4; break;
  }
  d.topheight = lowestCeilingSurrounding(sec) - 4;
}
function isDoor(t) { return t && t.type && ['normal', 'close30ThenOpen', 'close', 'open', 'raiseIn5Mins', 'blazeRaise', 'blazeOpen', 'blazeClose'].includes(t.type) && 'topcountdown' in t; }

// ---- plats ----
function platThink(p) {
  const sec = p.sector;
  if (p.status === 'up') {
    const res = movePlane(sec, p.speed, p.high, p.crush, false, 1);
    if ((p.type === 'raiseAndChange' || p.type === 'raiseToNearestAndChange') && !(G.leveltime & 7)) sndSec(sec, SFX.stnmov);
    if (res === 'crushed' && !p.crush) { p.count = p.wait; p.status = 'down'; sndSec(sec, SFX.pstart); }
    else if (res === 'pastdest') {
      p.count = p.wait; p.status = 'waiting'; sndSec(sec, SFX.pstop);
      if (p.type !== 'perpetualRaise') removeActivePlat(p);
    }
  } else if (p.status === 'down') {
    if (movePlane(sec, p.speed, p.low, false, false, -1) === 'pastdest') { p.count = p.wait; p.status = 'waiting'; sndSec(sec, SFX.pstop); }
  } else if (p.status === 'waiting') {
    if (!--p.count) { p.status = sec.floorheight === p.low ? 'up' : 'down'; sndSec(sec, SFX.pstart); }
  }
}
function removeActivePlat(p) { p.sector.specialdata = null; removeThinker(p); activeplats = activeplats.filter(x => x !== p); }
function activateInStasis(tag) { for (const p of activeplats) if (p.tag === tag && p.status === 'in_stasis') { p.status = p.oldstatus; p.frozen = false; } }
function stopPlat(line) { for (const p of activeplats) if (p.status !== 'in_stasis' && p.tag === line.tag) { p.oldstatus = p.status; p.status = 'in_stasis'; p.frozen = true; } }
function doPlat(line, type, amount) {
  let rtn = false;
  if (type === 'perpetualRaise') activateInStasis(line.tag);
  for (const sec of sectorsByTag(line.tag)) {
    if (sec.specialdata) continue;
    rtn = true;
    const p = { sector: sec, type, crush: false, tag: line.tag, speed: PLATSPEED, low: 0, high: 0, wait: 0, count: 0, status: 'up', think() { platThink(this); } };
    sec.specialdata = p; addThinker(p);
    switch (type) {
      case 'raiseToNearestAndChange':
        p.speed = PLATSPEED / 2; sec.floorpic = line.frontsector.floorpic; p.high = nextHighestFloor(sec, sec.floorheight);
        sec.special = 0; sndSec(sec, SFX.stnmov); break;
      case 'raiseAndChange':
        p.speed = PLATSPEED / 2; sec.floorpic = line.frontsector.floorpic; p.high = sec.floorheight + amount; sndSec(sec, SFX.stnmov); break;
      case 'downWaitUpStay': case 'blazeDWUS':
        p.speed = PLATSPEED * (type === 'blazeDWUS' ? 8 : 4); p.low = Math.min(lowestFloorSurrounding(sec), sec.floorheight);
        p.high = sec.floorheight; p.wait = TICRATE * PLATWAIT; p.status = 'down'; sndSec(sec, SFX.pstart); break;
      case 'perpetualRaise':
        p.speed = PLATSPEED * 4; p.low = Math.min(lowestFloorSurrounding(sec), sec.floorheight);
        p.high = Math.max(highestFloorSurrounding(sec), sec.floorheight); p.wait = TICRATE * PLATWAIT;
        p.status = (P_Random() & 1) ? 'down' : 'up'; sndSec(sec, SFX.pstart); break;
    }
    activeplats.push(p);
  }
  return rtn;
}

// ---- floors ----
function floorThink(f) {
  const sec = f.sector;
  const res = movePlane(sec, f.speed, f.dest, f.crush, false, f.direction);
  if (!(G.leveltime & 7)) sndSec(sec, SFX.stnmov);
  if (res === 'pastdest') {
    sec.specialdata = null;
    if ((f.direction === 1 && f.type === 'donutRaise') || (f.direction === -1 && f.type === 'lowerAndChange')) { sec.special = f.newspecial; sec.floorpic = f.texture; }
    removeThinker(f);
    sndSec(sec, SFX.pstop);
  }
}
function newFloor(sec, props) {
  const f = Object.assign({ sector: sec, crush: false, direction: 1, speed: FLOORSPEED, dest: sec.floorheight, newspecial: 0, texture: sec.floorpic, think() { floorThink(this); } }, props);
  sec.specialdata = f; return addThinker(f);
}
function doFloor(line, type) {
  let rtn = false;
  for (const sec of sectorsByTag(line.tag)) {
    if (sec.specialdata) continue;
    rtn = true;
    const f = newFloor(sec, { type });
    switch (type) {
      case 'lowerFloor': f.direction = -1; f.dest = highestFloorSurrounding(sec); break;
      case 'lowerFloorToLowest': f.direction = -1; f.dest = lowestFloorSurrounding(sec); break;
      case 'turboLower': f.direction = -1; f.speed = FLOORSPEED * 4; f.dest = highestFloorSurrounding(sec); if (f.dest !== sec.floorheight) f.dest += 8; break;
      case 'raiseFloorCrush': case 'raiseFloor':
        f.crush = type === 'raiseFloorCrush';
        f.dest = Math.min(lowestCeilingSurrounding(sec), sec.ceilingheight) - (f.crush ? 8 : 0); break;
      case 'raiseFloorTurbo': f.speed = FLOORSPEED * 4; f.dest = nextHighestFloor(sec, sec.floorheight); break;
      case 'raiseFloorToNearest': f.dest = nextHighestFloor(sec, sec.floorheight); break;
      case 'raiseFloor24': f.dest = sec.floorheight + 24; break;
      case 'raiseFloor512': f.dest = sec.floorheight + 512; break;
      case 'raiseFloor24AndChange': f.dest = sec.floorheight + 24; sec.floorpic = line.frontsector.floorpic; sec.special = line.frontsector.special; break;
      case 'raiseToTexture': {
        let minsize = 32767;
        for (const ln of sec.lines) {
          if (!(ln.flags & ML_TWOSIDED)) continue;
          for (const sn of ln.sidenum) {
            const bt = level.sides[sn].bottomtexture;
            if (bt && gfx.textures[bt].h < minsize) minsize = gfx.textures[bt].h;
          }
        }
        f.dest = sec.floorheight + minsize; break;
      }
      case 'lowerAndChange':
        f.direction = -1; f.dest = lowestFloorSurrounding(sec); f.texture = sec.floorpic;
        for (const ln of sec.lines) {
          if (!(ln.flags & ML_TWOSIDED)) continue;
          const o = nextSector(ln, sec);
          if (o && o.floorheight === f.dest) { f.texture = o.floorpic; f.newspecial = o.special; break; }
        }
        break;
    }
  }
  return rtn;
}
function buildStairs(line, type) {
  let rtn = false;
  const speed = type === 'build8' ? FLOORSPEED / 4 : FLOORSPEED * 4, stairsize = type === 'build8' ? 8 : 16;
  for (let sec of sectorsByTag(line.tag)) {
    if (sec.specialdata) continue;
    rtn = true;
    let height = sec.floorheight + stairsize;
    newFloor(sec, { type: 'stairs', speed, dest: height });
    const texture = sec.floorpic;
    let ok;
    do {
      ok = false;
      for (const ln of sec.lines) {
        if (!(ln.flags & ML_TWOSIDED) || ln.frontsector !== sec) continue;
        const tsec = ln.backsector;
        if (tsec.floorpic !== texture) continue;
        height += stairsize;
        if (tsec.specialdata) continue;
        sec = tsec;
        newFloor(sec, { type: 'stairs', speed, dest: height });
        ok = true; break;
      }
    } while (ok);
  }
  return rtn;
}
function doDonut(line) {
  let rtn = false;
  for (const s1 of sectorsByTag(line.tag)) {
    if (s1.specialdata) continue;
    rtn = true;
    const s2 = nextSector(s1.lines[0], s1);
    if (!s2) continue;
    for (const ln of s2.lines) {
      if (!(ln.flags & ML_TWOSIDED) || ln.backsector === s1) continue;
      const s3 = ln.backsector;
      newFloor(s2, { type: 'donutRaise', speed: FLOORSPEED / 2, texture: s3.floorpic, newspecial: 0, dest: s3.floorheight });
      newFloor(s1, { type: 'lowerFloor', direction: -1, speed: FLOORSPEED / 2, dest: s3.floorheight });
      break;
    }
  }
  return rtn;
}

// ---- ceilings ----
function ceilingThink(c) {
  const sec = c.sector;
  if (c.direction === 1) {
    const res = movePlane(sec, c.speed, c.topheight, false, true, 1);
    if (!(G.leveltime & 7) && c.type !== 'silentCrushAndRaise') sndSec(sec, SFX.stnmov);
    if (res === 'pastdest') {
      if (c.type === 'raiseToHighest') removeActiveCeiling(c);
      else if (c.type === 'silentCrushAndRaise' || c.type === 'fastCrushAndRaise' || c.type === 'crushAndRaise') {
        if (c.type === 'silentCrushAndRaise') sndSec(sec, SFX.pstop);
        c.direction = -1;
      }
    }
  } else if (c.direction === -1) {
    const res = movePlane(sec, c.speed, c.bottomheight, c.crush, true, -1);
    if (!(G.leveltime & 7) && c.type !== 'silentCrushAndRaise') sndSec(sec, SFX.stnmov);
    if (res === 'pastdest') {
      if (c.type === 'silentCrushAndRaise' || c.type === 'crushAndRaise' || c.type === 'fastCrushAndRaise') {
        if (c.type === 'silentCrushAndRaise') sndSec(sec, SFX.pstop);
        if (c.type !== 'fastCrushAndRaise') c.speed = CEILSPEED;
        c.direction = 1;
      } else if (c.type === 'lowerAndCrush' || c.type === 'lowerToFloor') removeActiveCeiling(c);
    } else if (res === 'crushed' && (c.type === 'silentCrushAndRaise' || c.type === 'crushAndRaise' || c.type === 'lowerAndCrush')) c.speed = CEILSPEED / 8;
  }
}
function removeActiveCeiling(c) { c.sector.specialdata = null; removeThinker(c); activeceilings = activeceilings.filter(x => x !== c); }
function doCeiling(line, type) {
  let rtn = false;
  if (type === 'fastCrushAndRaise' || type === 'silentCrushAndRaise' || type === 'crushAndRaise')
    for (const c of activeceilings) if (c.tag === line.tag && c.direction === 0) c.direction = c.olddirection;
  for (const sec of sectorsByTag(line.tag)) {
    if (sec.specialdata) continue;
    rtn = true;
    const c = { sector: sec, type, tag: line.tag, crush: false, speed: CEILSPEED, direction: -1, topheight: sec.ceilingheight, bottomheight: sec.floorheight, olddirection: 0, think() { ceilingThink(this); } };
    sec.specialdata = c; addThinker(c);
    switch (type) {
      case 'fastCrushAndRaise': c.crush = true; c.bottomheight = sec.floorheight + 8; c.speed = CEILSPEED * 2; break;
      case 'silentCrushAndRaise': case 'crushAndRaise': c.crush = true; c.bottomheight = sec.floorheight + 8; break;
      case 'lowerAndCrush': c.bottomheight = sec.floorheight + 8; break;
      case 'lowerToFloor': c.bottomheight = sec.floorheight; break;
      case 'raiseToHighest': c.topheight = highestCeilingSurrounding(sec); c.direction = 1; break;
    }
    activeceilings.push(c);
  }
  return rtn;
}
function ceilingCrushStop(line) {
  let rtn = false;
  for (const c of activeceilings) if (c.tag === line.tag && c.direction !== 0) { c.olddirection = c.direction; c.direction = 0; rtn = true; }
  return rtn;
}

// ---- lights ----
function spawnLightFlash(sec) {
  sec.special = 0;
  const l = { sector: sec, maxlight: sec.lightlevel, minlight: minSurroundingLight(sec, sec.lightlevel), maxtime: 64, mintime: 7, count: (P_Random() & 64) + 1,
    think() { if (--this.count) return; if (sec.lightlevel === this.maxlight) { sec.lightlevel = this.minlight; this.count = (P_Random() & this.mintime) + 1; } else { sec.lightlevel = this.maxlight; this.count = (P_Random() & this.maxtime) + 1; } } };
  addThinker(l);
}
function spawnStrobeFlash(sec, darktime, inSync) {
  const l = { sector: sec, darktime, brighttime: STROBEBRIGHT, maxlight: sec.lightlevel, minlight: minSurroundingLight(sec, sec.lightlevel), count: inSync ? 1 : (P_Random() & 7) + 1,
    think() { if (--this.count) return; if (sec.lightlevel === this.minlight) { sec.lightlevel = this.maxlight; this.count = this.brighttime; } else { sec.lightlevel = this.minlight; this.count = this.darktime; } } };
  if (l.minlight === l.maxlight) l.minlight = 0;
  sec.special = 0;
  addThinker(l);
}
function spawnGlowingLight(sec) {
  const l = { sector: sec, minlight: minSurroundingLight(sec, sec.lightlevel), maxlight: sec.lightlevel, direction: -1,
    think() {
      if (this.direction === -1) { sec.lightlevel -= GLOWSPEED; if (sec.lightlevel <= this.minlight) { sec.lightlevel += GLOWSPEED; this.direction = 1; } }
      else { sec.lightlevel += GLOWSPEED; if (sec.lightlevel >= this.maxlight) { sec.lightlevel -= GLOWSPEED; this.direction = -1; } }
    } };
  sec.special = 0; addThinker(l);
}
function spawnFireFlicker(sec) {
  sec.special = 0;
  const l = { maxlight: sec.lightlevel, minlight: minSurroundingLight(sec, sec.lightlevel) + 16, count: 4,
    think() { if (--this.count) return; const amt = (P_Random() & 3) * 16; sec.lightlevel = sec.lightlevel - amt < this.minlight ? this.minlight : this.maxlight - amt; this.count = 4; } };
  addThinker(l);
}
function startLightStrobing(line) { for (const s of sectorsByTag(line.tag)) if (!s.specialdata) spawnStrobeFlash(s, SLOWDARK, 0); }
function turnTagLightsOff(line) { for (const s of sectorsByTag(line.tag)) s.lightlevel = Math.min(s.lightlevel, ...neighbours(s).map(o => o.lightlevel)); }
function lightTurnOn(line, bright) {
  for (const s of sectorsByTag(line.tag)) {
    if (!bright) for (const o of neighbours(s)) if (o.lightlevel > bright) bright = o.lightlevel;
    s.lightlevel = bright;
  }
}

// ---- teleport ----
function teleport(line, side, thing) {
  if (thing.flags & MF_MISSILE) return false;
  if (side === 1) return false;
  for (const sec of sectorsByTag(line.tag)) {
    for (const m of mobjs) {
      if (m.removed || m.type !== MT.TELEPORTMAN || m.subsector.sector !== sec) continue;
      const ox = thing.x, oy = thing.y, oz = thing.z;
      if (!teleportMove(thing, m.x, m.y)) return false;
      thing.z = thing.floorz;
      if (thing.player) thing.player.viewz = thing.z + thing.player.viewheight;
      S_StartSound(spawnMobj(ox, oy, oz, MT.TFOG), SFX.telept);
      S_StartSound(spawnMobj(m.x + 20 * Math.cos(m.angle), m.y + 20 * Math.sin(m.angle), thing.z, MT.TFOG), SFX.telept);
      if (thing.player) thing.reactiontime = 18;
      thing.angle = m.angle; thing.momx = thing.momy = thing.momz = 0;
      return true;
    }
  }
  return false;
}

// ---- switches ----
function initSwitchList() {
  switchlist = [];
  const episode = gfx.wad.has('TEXTURE2') ? 2 : 1;
  for (const [a, b, ep] of INFO.switches) {
    if (ep > episode || !gfx.texByName.has(a) || !gfx.texByName.has(b)) continue;
    switchlist.push(gfx.texNum(a), gfx.texNum(b));
  }
}
function changeSwitchTexture(line, useAgain) {
  if (!useAgain) line.special = 0;
  const side = level.sides[line.sidenum[0]];
  const sound = line.special === 11 ? SFX.swtchx : SFX.swtchn;
  for (const where of ['toptexture', 'midtexture', 'bottomtexture']) {
    const i = switchlist.indexOf(side[where]);
    if (i < 0) continue;
    S_StartSound(line.frontsector.soundorg, sound);
    side[where] = switchlist[i ^ 1];
    if (useAgain) buttons.push({ line, side, where, tex: switchlist[i], timer: BUTTONTIME });
    return;
  }
}

// ---- line triggers ----
const WALK = {   // special: [action, once]
  2: ['door', 'open', 1], 3: ['door', 'close', 1], 4: ['door', 'normal', 1], 5: ['floor', 'raiseFloor', 1], 6: ['ceil', 'fastCrushAndRaise', 1],
  8: ['stairs', 'build8', 1], 10: ['plat', 'downWaitUpStay', 1], 12: ['light', 0, 1], 13: ['light', 255, 1], 16: ['door', 'close30ThenOpen', 1],
  17: ['strobe', 0, 1], 19: ['floor', 'lowerFloor', 1], 22: ['plat', 'raiseToNearestAndChange', 1], 25: ['ceil', 'crushAndRaise', 1],
  30: ['floor', 'raiseToTexture', 1], 35: ['light', 35, 1], 36: ['floor', 'turboLower', 1], 37: ['floor', 'lowerAndChange', 1],
  38: ['floor', 'lowerFloorToLowest', 1], 39: ['tele', 0, 1], 40: ['ceilfloor', 0, 1], 44: ['ceil', 'lowerAndCrush', 1], 52: ['exit', false, 0],
  53: ['plat', 'perpetualRaise', 1], 54: ['platstop', 0, 1], 56: ['floor', 'raiseFloorCrush', 1], 57: ['crushstop', 0, 1], 58: ['floor', 'raiseFloor24', 1],
  59: ['floor', 'raiseFloor24AndChange', 1], 104: ['lightsoff', 0, 1], 108: ['door', 'blazeRaise', 1], 109: ['door', 'blazeOpen', 1],
  100: ['stairs', 'turbo16', 1], 110: ['door', 'blazeClose', 1], 119: ['floor', 'raiseFloorToNearest', 1], 121: ['plat', 'blazeDWUS', 1],
  124: ['exit', true, 0], 125: ['tele', 0, 1], 130: ['floor', 'raiseFloorTurbo', 1], 141: ['ceil', 'silentCrushAndRaise', 1],
  72: ['ceil', 'lowerAndCrush', 0], 73: ['ceil', 'crushAndRaise', 0], 74: ['crushstop', 0, 0], 75: ['door', 'close', 0], 76: ['door', 'close30ThenOpen', 0],
  77: ['ceil', 'fastCrushAndRaise', 0], 79: ['light', 35, 0], 80: ['light', 0, 0], 81: ['light', 255, 0], 82: ['floor', 'lowerFloorToLowest', 0],
  83: ['floor', 'lowerFloor', 0], 84: ['floor', 'lowerAndChange', 0], 86: ['door', 'open', 0], 87: ['plat', 'perpetualRaise', 0], 88: ['plat', 'downWaitUpStay', 0],
  89: ['platstop', 0, 0], 90: ['door', 'normal', 0], 91: ['floor', 'raiseFloor', 0], 92: ['floor', 'raiseFloor24', 0], 93: ['floor', 'raiseFloor24AndChange', 0],
  94: ['floor', 'raiseFloorCrush', 0], 95: ['plat', 'raiseToNearestAndChange', 0], 96: ['floor', 'raiseToTexture', 0], 97: ['tele', 0, 0],
  98: ['floor', 'turboLower', 0], 105: ['door', 'blazeRaise', 0], 106: ['door', 'blazeOpen', 0], 107: ['door', 'blazeClose', 0],
  120: ['plat', 'blazeDWUS', 0], 126: ['tele', 0, 0], 128: ['floor', 'raiseFloorToNearest', 0], 129: ['floor', 'raiseFloorTurbo', 0],
};
function runAction(kind, arg, line, side, thing) {
  switch (kind) {
    case 'door': return doDoor(line, arg);
    case 'floor': return doFloor(line, arg);
    case 'ceil': return doCeiling(line, arg);
    case 'plat': return doPlat(line, arg, 0);
    case 'stairs': return buildStairs(line, arg);
    case 'light': lightTurnOn(line, arg); return true;
    case 'strobe': startLightStrobing(line); return true;
    case 'lightsoff': turnTagLightsOff(line); return true;
    case 'tele': return teleport(line, side, thing);
    case 'ceilfloor': doCeiling(line, 'raiseToHighest'); doFloor(line, 'lowerFloorToLowest'); return true;
    case 'platstop': stopPlat(line); return true;
    case 'crushstop': return ceilingCrushStop(line);
    case 'exit': exitLevel(arg); return true;
  }
}
function crossSpecialLine(line, side, thing) {
  if (!thing.player) {
    if ([MT.ROCKET, MT.PLASMA, MT.BFG, MT.TROOPSHOT, MT.HEADSHOT, MT.BRUISERSHOT].includes(thing.type)) return;
    if (![39, 97, 125, 126, 4, 10, 88].includes(line.special)) return;
  }
  if ((line.special === 125 || line.special === 126) && thing.player) return;
  const w = WALK[line.special];
  if (!w) return;
  if (w[0] === 'exit' && !thing.player) return;
  const ok = runAction(w[0], w[1], line, side, thing);
  if (w[2] && (w[0] !== 'tele' || ok)) line.special = 0;
}
const USE = {   // special: [action, arg, useAgain]
  7: ['stairs', 'build8', 0], 9: ['donut', 0, 0], 11: ['exit', false, 0], 14: ['platamt', 32, 0], 15: ['platamt', 24, 0], 18: ['floor', 'raiseFloorToNearest', 0],
  20: ['plat', 'raiseToNearestAndChange', 0], 21: ['plat', 'downWaitUpStay', 0], 23: ['floor', 'lowerFloorToLowest', 0], 29: ['door', 'normal', 0],
  41: ['ceil', 'lowerToFloor', 0], 71: ['floor', 'turboLower', 0], 49: ['ceil', 'crushAndRaise', 0], 50: ['door', 'close', 0], 51: ['exit', true, 0],
  55: ['floor', 'raiseFloorCrush', 0], 101: ['floor', 'raiseFloor', 0], 102: ['floor', 'lowerFloor', 0], 103: ['door', 'open', 0],
  111: ['door', 'blazeRaise', 0], 112: ['door', 'blazeOpen', 0], 113: ['door', 'blazeClose', 0], 122: ['plat', 'blazeDWUS', 0], 127: ['stairs', 'turbo16', 0],
  131: ['floor', 'raiseFloorTurbo', 0], 133: ['locked', 'blazeOpen', 0], 135: ['locked', 'blazeOpen', 0], 137: ['locked', 'blazeOpen', 0], 140: ['floor', 'raiseFloor512', 0],
  42: ['door', 'close', 1], 43: ['ceil', 'lowerToFloor', 1], 45: ['floor', 'lowerFloor', 1], 60: ['floor', 'lowerFloorToLowest', 1], 61: ['door', 'open', 1],
  62: ['plat1', 'downWaitUpStay', 1], 63: ['door', 'normal', 1], 64: ['floor', 'raiseFloor', 1], 66: ['platamt', 24, 1], 67: ['platamt', 32, 1],
  65: ['floor', 'raiseFloorCrush', 1], 68: ['plat', 'raiseToNearestAndChange', 1], 69: ['floor', 'raiseFloorToNearest', 1], 70: ['floor', 'turboLower', 1],
  114: ['door', 'blazeRaise', 1], 115: ['door', 'blazeOpen', 1], 116: ['door', 'blazeClose', 1], 123: ['plat', 'blazeDWUS', 1], 132: ['floor', 'raiseFloorTurbo', 1],
  99: ['locked', 'blazeOpen', 1], 134: ['locked', 'blazeOpen', 1], 136: ['locked', 'blazeOpen', 1], 138: ['light', 255, 1], 139: ['light', 35, 1],
};
function useSpecialLine(thing, line, side) {
  if (side) return false;
  if (!thing.player) {
    if (line.flags & ML_SECRET) return false;
    if (![1, 32, 33, 34].includes(line.special)) return false;
  }
  const sp = line.special;
  if ([1, 26, 27, 28, 31, 32, 33, 34, 117, 118].includes(sp)) { evVerticalDoor(line, thing); return true; }
  const u = USE[sp];
  if (!u) return true;
  let ok;
  switch (u[0]) {
    case 'donut': ok = doDonut(line); break;
    case 'platamt': ok = doPlat(line, 'raiseAndChange', u[1]); break;
    case 'plat1': ok = doPlat(line, u[1], 1); break;
    case 'locked': ok = doLockedDoor(line, u[1], thing); break;
    case 'exit': changeSwitchTexture(line, 0); exitLevel(u[1]); return true;
    case 'light': lightTurnOn(line, u[1]); ok = true; break;
    default: ok = runAction(u[0], u[1], line, side, thing);
  }
  if (ok) changeSwitchTexture(line, u[2]);
  return true;
}
function shootSpecialLine(thing, line) {
  if (!thing.player && line.special !== 46) return;
  switch (line.special) {
    case 24: doFloor(line, 'raiseFloor'); changeSwitchTexture(line, 0); break;
    case 46: doDoor(line, 'open'); changeSwitchTexture(line, 1); break;
    case 47: doPlat(line, 'raiseToNearestAndChange', 0); changeSwitchTexture(line, 0); break;
  }
}

// ---- P_SpawnSpecials / P_UpdateSpecials / P_InitPicAnims ----
function initPicAnims() {
  anims = [];
  for (const [istex, end, start, speed] of INFO.anims) {
    let base, pic;
    if (istex) { if (!gfx.texByName.has(start) || !gfx.texByName.has(end)) continue; base = gfx.texNum(start); pic = gfx.texNum(end); }
    else { if (!gfx.flatByName.has(start) || !gfx.flatByName.has(end)) continue; base = gfx.flatNum(start); pic = gfx.flatNum(end); }
    if (pic - base + 1 >= 2) anims.push({ istex, base, num: pic - base + 1, speed });
  }
}
function spawnSpecials() {
  activeplats = []; activeceilings = []; buttons = []; scrollers = [];
  gfx.texTranslation.forEach((_, i) => gfx.texTranslation[i] = i);
  gfx.flatTranslation.forEach((_, i) => gfx.flatTranslation[i] = i);
  for (const sec of level.sectors) {
    switch (sec.special) {
      case 1: spawnLightFlash(sec); break;
      case 2: spawnStrobeFlash(sec, FASTDARK, 0); break;
      case 3: spawnStrobeFlash(sec, SLOWDARK, 0); break;
      case 4: spawnStrobeFlash(sec, FASTDARK, 0); sec.special = 4; break;
      case 8: spawnGlowingLight(sec); break;
      case 9: G.totalsecret++; break;
      case 10: doorThinker(sec, 'normal', { direction: 0, topcountdown: 30 * TICRATE }); sec.special = 0; break;
      case 12: spawnStrobeFlash(sec, SLOWDARK, 1); break;
      case 13: spawnStrobeFlash(sec, FASTDARK, 1); break;
      case 14: doorThinker(sec, 'raiseIn5Mins', { direction: 2, topheight: lowestCeilingSurrounding(sec) - 4, topcountdown: 5 * 60 * TICRATE }); sec.special = 0; break;
      case 17: spawnFireFlicker(sec); break;
    }
  }
  for (const ln of level.lines) if (ln.special === 48) scrollers.push(ln);
}
function updateSpecials() {
  for (const a of anims) for (let i = a.base; i < a.base + a.num; i++) {
    const pic = a.base + ((Math.floor(G.leveltime / a.speed) + i) % a.num);
    if (a.istex) gfx.texTranslation[i] = pic; else gfx.flatTranslation[i] = pic;
  }
  for (const ln of scrollers) level.sides[ln.sidenum[0]].textureoffset += 1;
  for (const b of buttons) {
    if (--b.timer) continue;
    b.side[b.where] = b.tex;
    S_StartSound(b.line.frontsector.soundorg, SFX.swtchn);
  }
  buttons = buttons.filter(b => b.timer > 0);
}
