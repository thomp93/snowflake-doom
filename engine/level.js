// ---- p_setup.c / p_maputl.c / p_sight.c : level data and geometry queries ----
const ML_BLOCKING = 1, ML_BLOCKMONSTERS = 2, ML_TWOSIDED = 4, ML_DONTPEGTOP = 8, ML_DONTPEGBOTTOM = 16,
  ML_SECRET = 32, ML_SOUNDBLOCK = 64, ML_DONTDRAW = 128, ML_MAPPED = 256;
const NF_SUBSECTOR = 0x8000;
const ST_HORIZONTAL = 0, ST_VERTICAL = 1, ST_POSITIVE = 2, ST_NEGATIVE = 3;
const MAXRADIUS = 32;

let level = null;      // current map
let validcount = 1;

function loadLevel(wad, gfx, mapname) {
  const base = wad.num(mapname);
  if (base < 0) throw new Error('Map not found: ' + mapname);
  const L = (k) => wad.data(base + k);   // THINGS=1 LINEDEFS=2 SIDEDEFS=3 VERTEXES=4 SEGS=5 SSECTORS=6 NODES=7 SECTORS=8 REJECT=9 BLOCKMAP=10
  const lv = { name: mapname, vertexes: [], sectors: [], sides: [], lines: [], segs: [], subsectors: [], nodes: [] };

  let b = L(4);
  for (let p = 0; p + 4 <= b.length; p += 4) lv.vertexes.push({ x: i16(b, p), y: i16(b, p + 2) });

  b = L(8);
  for (let p = 0; p + 26 <= b.length; p += 26) {
    lv.sectors.push({
      id: lv.sectors.length, floorheight: i16(b, p), ceilingheight: i16(b, p + 2),
      floorpic: gfx.flatNum(lumpName(b, p + 4)), ceilingpic: gfx.flatNum(lumpName(b, p + 12)),
      lightlevel: i16(b, p + 20), special: i16(b, p + 22), tag: i16(b, p + 24),
      lines: [], thinglist: new Set(), specialdata: null, soundtarget: null, soundtraversed: 0,
      validcount: 0, bbox: [-Infinity, Infinity, Infinity, -Infinity], soundorg: { x: 0, y: 0, z: 0 },
    });
  }

  b = L(3);
  for (let p = 0; p + 30 <= b.length; p += 30) {
    lv.sides.push({
      textureoffset: i16(b, p), rowoffset: i16(b, p + 2),
      toptexture: gfx.texNum(lumpName(b, p + 4)), bottomtexture: gfx.texNum(lumpName(b, p + 12)),
      midtexture: gfx.texNum(lumpName(b, p + 20)), sector: lv.sectors[i16(b, p + 28)],
    });
  }

  b = L(2);
  for (let p = 0; p + 14 <= b.length; p += 14) {
    const v1 = lv.vertexes[u16(b, p)], v2 = lv.vertexes[u16(b, p + 2)];
    const s0 = u16(b, p + 10), s1 = u16(b, p + 12);
    const ln = {
      id: lv.lines.length, v1, v2, dx: v2.x - v1.x, dy: v2.y - v1.y, flags: i16(b, p + 4), special: i16(b, p + 6), tag: i16(b, p + 8),
      sidenum: [s0 === 0xffff ? -1 : s0, s1 === 0xffff ? -1 : s1], validcount: 0, specialdata: null,
      bbox: [Math.max(v1.y, v2.y), Math.min(v1.y, v2.y), Math.min(v1.x, v2.x), Math.max(v1.x, v2.x)], // top,bottom,left,right
    };
    ln.slopetype = !ln.dx ? ST_VERTICAL : !ln.dy ? ST_HORIZONTAL : (ln.dy / ln.dx > 0 ? ST_POSITIVE : ST_NEGATIVE);
    ln.frontsector = ln.sidenum[0] >= 0 ? lv.sides[ln.sidenum[0]].sector : null;
    ln.backsector = ln.sidenum[1] >= 0 ? lv.sides[ln.sidenum[1]].sector : null;
    lv.lines.push(ln);
  }

  b = L(5);
  for (let p = 0; p + 12 <= b.length; p += 12) {
    const ln = lv.lines[u16(b, p + 6)], side = i16(b, p + 8);
    const sd = lv.sides[ln.sidenum[side]];
    lv.segs.push({
      v1: lv.vertexes[u16(b, p)], v2: lv.vertexes[u16(b, p + 2)], offset: i16(b, p + 10), linedef: ln, sidedef: sd,
      frontsector: sd.sector, backsector: (ln.flags & ML_TWOSIDED) && ln.sidenum[side ^ 1] >= 0 ? lv.sides[ln.sidenum[side ^ 1]].sector : null,
    });
  }

  b = L(6);
  for (let p = 0; p + 4 <= b.length; p += 4) {
    const n = u16(b, p), first = u16(b, p + 2);
    lv.subsectors.push({ numlines: n, firstline: first, sector: lv.segs[first].sidedef.sector });
  }

  b = L(7);
  for (let p = 0; p + 28 <= b.length; p += 28) {
    const bb = k => [i16(b, p + 8 + k * 8), i16(b, p + 10 + k * 8), i16(b, p + 12 + k * 8), i16(b, p + 14 + k * 8)];
    lv.nodes.push({ x: i16(b, p), y: i16(b, p + 2), dx: i16(b, p + 4), dy: i16(b, p + 6), bbox: [bb(0), bb(1)], children: [u16(b, p + 24), u16(b, p + 26)] });
  }

  lv.reject = L(9);
  b = L(10);
  lv.bmaporgx = i16(b, 0); lv.bmaporgy = i16(b, 2); lv.bmapwidth = i16(b, 4); lv.bmapheight = i16(b, 6);
  lv.blocklines = [];
  for (let i = 0; i < lv.bmapwidth * lv.bmapheight; i++) {
    let p = u16(b, 8 + i * 2) * 2 + 2;     // skip leading 0
    const list = [];
    for (; p + 1 < b.length; p += 2) { const v = i16(b, p); if (v === -1) break; if (lv.lines[v]) list.push(lv.lines[v]); }
    lv.blocklines.push(list);
  }

  // P_GroupLines
  for (const ln of lv.lines) {
    for (const s of [ln.frontsector, ln.backsector]) {
      if (!s || s.lines.includes(ln)) continue;
      s.lines.push(ln);
      for (const v of [ln.v1, ln.v2]) {
        s.bbox[0] = Math.max(s.bbox[0], v.y); s.bbox[1] = Math.min(s.bbox[1], v.y);
        s.bbox[2] = Math.min(s.bbox[2], v.x); s.bbox[3] = Math.max(s.bbox[3], v.x);
      }
    }
  }
  for (const s of lv.sectors) { s.soundorg.x = (s.bbox[2] + s.bbox[3]) / 2; s.soundorg.y = (s.bbox[0] + s.bbox[1]) / 2; }

  b = L(1);
  lv.things = [];
  for (let p = 0; p + 10 <= b.length; p += 10)
    lv.things.push({ x: i16(b, p), y: i16(b, p + 2), angle: i16(b, p + 4), type: i16(b, p + 6), options: i16(b, p + 8) });
  return lv;
}

// ---- geometry helpers (p_maputl.c) ----
function pointOnLineSide(x, y, ln) {
  if (!ln.dx) return x <= ln.v1.x ? (ln.dy > 0 ? 1 : 0) : (ln.dy < 0 ? 1 : 0);
  if (!ln.dy) return y <= ln.v1.y ? (ln.dx < 0 ? 1 : 0) : (ln.dx > 0 ? 1 : 0);
  const left = ln.dy * (x - ln.v1.x), right = (y - ln.v1.y) * ln.dx;
  return right < left ? 0 : 1;
}
function boxOnLineSide(box, ln) {   // box: [top,bottom,left,right]
  let p1, p2;
  switch (ln.slopetype) {
    case ST_HORIZONTAL: p1 = box[0] > ln.v1.y ? 1 : 0; p2 = box[1] > ln.v1.y ? 1 : 0; if (ln.dx < 0) { p1 ^= 1; p2 ^= 1; } break;
    case ST_VERTICAL: p1 = box[3] < ln.v1.x ? 1 : 0; p2 = box[2] < ln.v1.x ? 1 : 0; if (ln.dy < 0) { p1 ^= 1; p2 ^= 1; } break;
    case ST_POSITIVE: p1 = pointOnLineSide(box[2], box[0], ln); p2 = pointOnLineSide(box[3], box[1], ln); break;
    default: p1 = pointOnLineSide(box[3], box[0], ln); p2 = pointOnLineSide(box[2], box[1], ln); break;
  }
  return p1 === p2 ? p1 : -1;
}
function pointOnDivlineSide(x, y, dl) {
  if (!dl.dx) return x <= dl.x ? (dl.dy > 0 ? 1 : 0) : (dl.dy < 0 ? 1 : 0);
  if (!dl.dy) return y <= dl.y ? (dl.dx < 0 ? 1 : 0) : (dl.dx > 0 ? 1 : 0);
  const left = dl.dy * (x - dl.x), right = (y - dl.y) * dl.dx;
  return right < left ? 0 : 1;
}
function interceptVector(v2, v1) {   // fraction along v2 where it crosses v1
  const den = v1.dy * v2.dx - v1.dx * v2.dy;
  if (den === 0) return 0;
  return ((v1.x - v2.x) * v1.dy + (v2.y - v1.y) * v1.dx) / den;
}
const opening = { top: 0, bottom: 0, range: 0, lowfloor: 0 };
function lineOpening(ln) {
  if (ln.sidenum[1] < 0) { opening.range = 0; return; }
  const f = ln.frontsector, k = ln.backsector;
  opening.top = Math.min(f.ceilingheight, k.ceilingheight);
  if (f.floorheight > k.floorheight) { opening.bottom = f.floorheight; opening.lowfloor = k.floorheight; }
  else { opening.bottom = k.floorheight; opening.lowfloor = f.floorheight; }
  opening.range = opening.top - opening.bottom;
}
function pointInSubsector(x, y) {
  const nodes = level.nodes;
  if (!nodes.length) return level.subsectors[0];
  let n = nodes.length - 1;
  while (!(n & NF_SUBSECTOR)) {
    const nd = nodes[n];
    n = nd.children[pointOnDivlineSide(x, y, nd)];
  }
  return level.subsectors[n & ~NF_SUBSECTOR];
}
function approxDist(dx, dy) { dx = Math.abs(dx); dy = Math.abs(dy); return dx + dy - Math.min(dx, dy) / 2; }
function pointToAngle(x1, y1, x2, y2) { return normAngle(Math.atan2(y2 - y1, x2 - x1)); }
const TAU = Math.PI * 2, ANG45 = Math.PI / 4, ANG90 = Math.PI / 2, ANG180 = Math.PI, ANG270 = Math.PI * 1.5;
function normAngle(a) { a %= TAU; return a < 0 ? a + TAU : a; }

// lines in blockmap cells around a box
function blockRange(box) {
  return [Math.floor((box[2] - level.bmaporgx - MAXRADIUS) / 128), Math.floor((box[3] - level.bmaporgx + MAXRADIUS) / 128),
    Math.floor((box[1] - level.bmaporgy - MAXRADIUS) / 128), Math.floor((box[0] - level.bmaporgy + MAXRADIUS) / 128)];
}
function blockLinesIterator(bx, by, fn) {
  if (bx < 0 || by < 0 || bx >= level.bmapwidth || by >= level.bmapheight) return true;
  for (const ln of level.blocklines[by * level.bmapwidth + bx]) {
    if (ln.validcount === validcount) continue;
    ln.validcount = validcount;
    if (!fn(ln)) return false;
  }
  return true;
}

// P_PathTraverse: intercepts along a trace, sorted by fraction
const PT_ADDLINES = 1, PT_ADDTHINGS = 2;
const trace = { x: 0, y: 0, dx: 0, dy: 0 };
function pathTraverse(x1, y1, x2, y2, flags, fn) {
  validcount++;
  trace.x = x1; trace.y = y1; trace.dx = x2 - x1; trace.dy = y2 - y1;
  const ic = [];
  if (flags & PT_ADDLINES) {
    // walk blockmap cells along the line (supercover)
    const ox = level.bmaporgx, oy = level.bmaporgy;
    let cx = Math.floor((x1 - ox) / 128), cy = Math.floor((y1 - oy) / 128);
    const ex = Math.floor((x2 - ox) / 128), ey = Math.floor((y2 - oy) / 128);
    const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
    const tdx = sx ? 128 / Math.abs(x2 - x1) : Infinity, tdy = sy ? 128 / Math.abs(y2 - y1) : Infinity;
    let tmx = sx ? (sx > 0 ? (ox + (cx + 1) * 128 - x1) : (x1 - ox - cx * 128)) / Math.abs(x2 - x1) : Infinity;
    let tmy = sy ? (sy > 0 ? (oy + (cy + 1) * 128 - y1) : (y1 - oy - cy * 128)) / Math.abs(y2 - y1) : Infinity;
    const addLine = ln => {
      const s1 = pointOnDivlineSide(ln.v1.x, ln.v1.y, trace), s2 = pointOnDivlineSide(ln.v2.x, ln.v2.y, trace);
      if (s1 === s2) return true;
      const frac = interceptVector(trace, { x: ln.v1.x, y: ln.v1.y, dx: ln.dx, dy: ln.dy });
      if (frac < 0) return true;
      ic.push({ frac, line: ln });
      return true;
    };
    for (let n = 0; n < 512; n++) {
      // check neighbours too so lines exactly on cell borders are not missed
      blockLinesIterator(cx, cy, addLine);
      if (cx === ex && cy === ey) break;
      if (tmx < tmy) { tmx += tdx; cx += sx; } else if (tmy < tmx) { tmy += tdy; cy += sy; }
      else { blockLinesIterator(cx + sx, cy, addLine); blockLinesIterator(cx, cy + sy, addLine); tmx += tdx; tmy += tdy; cx += sx; cy += sy; }
    }
  }
  if (flags & PT_ADDTHINGS) {
    const tracepositive = (trace.dx > 0) === (trace.dy > 0) ? false : true;
    const minx = Math.min(x1, x2) - MAXRADIUS, maxx = Math.max(x1, x2) + MAXRADIUS, miny = Math.min(y1, y2) - MAXRADIUS, maxy = Math.max(y1, y2) + MAXRADIUS;
    for (const th of mobjs) {
      if (th.removed || th.x < minx || th.x > maxx || th.y < miny || th.y > maxy) continue;
      const r = th.radius;
      let ax, ay, bx, by;
      if (!tracepositive) { ax = th.x - r; ay = th.y + r; bx = th.x + r; by = th.y - r; }
      else { ax = th.x - r; ay = th.y - r; bx = th.x + r; by = th.y + r; }
      const s1 = pointOnDivlineSide(ax, ay, trace), s2 = pointOnDivlineSide(bx, by, trace);
      if (s1 === s2) continue;
      const frac = interceptVector(trace, { x: ax, y: ay, dx: bx - ax, dy: by - ay });
      if (frac < 0) continue;
      ic.push({ frac, thing: th });
    }
  }
  ic.sort((a, b) => a.frac - b.frac);
  for (const it of ic) { if (it.frac > 1) break; if (!fn(it)) return false; }
  return true;
}

// ---- p_sight.c ----
let sightzstart, topslope, bottomslope;
const strace = { x: 0, y: 0, dx: 0, dy: 0 };
let t2x, t2y;
function divlineSide(x, y, n) {
  if (!n.dx) { if (x === n.x) return 2; if (x <= n.x) return n.dy > 0 ? 1 : 0; return n.dy < 0 ? 1 : 0; }
  if (!n.dy) { if (y === n.y) return 2; if (y <= n.y) return n.dx < 0 ? 1 : 0; return n.dx > 0 ? 1 : 0; }
  const left = n.dy * (x - n.x), right = (y - n.y) * n.dx;
  if (right < left) return 0;
  return left === right ? 2 : 1;
}
function crossSubsector(num) {
  const ss = level.subsectors[num];
  for (let i = 0; i < ss.numlines; i++) {
    const seg = level.segs[ss.firstline + i], ln = seg.linedef;
    if (ln.validcount === validcount) continue;
    ln.validcount = validcount;
    const v1 = ln.v1, v2 = ln.v2;
    if (divlineSide(v1.x, v1.y, strace) === divlineSide(v2.x, v2.y, strace)) continue;
    const dl = { x: v1.x, y: v1.y, dx: v2.x - v1.x, dy: v2.y - v1.y };
    if (divlineSide(strace.x, strace.y, dl) === divlineSide(t2x, t2y, dl)) continue;
    if (!(ln.flags & ML_TWOSIDED) || !seg.backsector) return false;
    const f = seg.frontsector, k = seg.backsector;
    if (f.floorheight === k.floorheight && f.ceilingheight === k.ceilingheight) continue;
    const otop = Math.min(f.ceilingheight, k.ceilingheight), obot = Math.max(f.floorheight, k.floorheight);
    if (obot >= otop) return false;
    const frac = interceptVector(strace, dl);
    if (f.floorheight !== k.floorheight) { const s = (obot - sightzstart) / frac; if (s > bottomslope) bottomslope = s; }
    if (f.ceilingheight !== k.ceilingheight) { const s = (otop - sightzstart) / frac; if (s < topslope) topslope = s; }
    if (topslope <= bottomslope) return false;
  }
  return true;
}
function crossBSPNode(bsp) {
  if (bsp & NF_SUBSECTOR) return crossSubsector(bsp === -1 ? 0 : bsp & ~NF_SUBSECTOR);
  const n = level.nodes[bsp];
  let side = divlineSide(strace.x, strace.y, n); if (side === 2) side = 0;
  if (!crossBSPNode(n.children[side])) return false;
  if (side === divlineSide(t2x, t2y, n)) return true;
  return crossBSPNode(n.children[side ^ 1]);
}
function checkSight(t1, t2) {
  const s1 = t1.subsector.sector.id, s2 = t2.subsector.sector.id, pnum = s1 * level.sectors.length + s2;
  if (level.reject.length && (level.reject[pnum >> 3] & (1 << (pnum & 7)))) return false;
  validcount++;
  sightzstart = t1.z + t1.height - t1.height / 4;
  topslope = t2.z + t2.height - sightzstart;
  bottomslope = t2.z - sightzstart;
  strace.x = t1.x; strace.y = t1.y; t2x = t2.x; t2y = t2.y;
  strace.dx = t2.x - t1.x; strace.dy = t2.y - t1.y;
  if (!level.nodes.length) return true;
  return crossBSPNode(level.nodes.length - 1);
}
