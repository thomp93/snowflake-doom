// ---- r_main.c / r_bsp.c / r_segs.c / r_plane.c / r_things.c / r_sky.c : software renderer ----
const SCREENWIDTH = 320, SCREENHEIGHT = 200, SBARHEIGHT = 32;
const LIGHTLEVELS = 16, NUMCOLORMAPS = 32, MAXLIGHTSCALE = 48, MAXLIGHTZ = 128, INVERSECOLORMAP = 32;
const FUZZTABLE = [1, -1, 1, -1, 1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, 1, 1, -1,
  1, -1, 1, 1, -1, -1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1, -1, 1, 1, -1, 1].map(v => v * SCREENWIDTH);

const R = {
  fb: new Uint8Array(SCREENWIDTH * SCREENHEIGHT),
  viewwidth: SCREENWIDTH, viewheight: SCREENHEIGHT - SBARHEIGHT,
  centerx: 160, centery: 84, projection: 160,
  xtoviewangle: new Float64Array(SCREENWIDTH + 1), distscale: new Float64Array(SCREENWIDTH), xcos: new Float64Array(SCREENWIDTH),
  colcos: new Float64Array(SCREENWIDTH), colsin: new Float64Array(SCREENWIDTH),
  ceilingclip: new Int16Array(SCREENWIDTH), floorclip: new Int16Array(SCREENWIDTH),
  scalelight: [], zlight: [], skytexture: 0, fuzzpos: 0,
};
(function initTables() {
  for (let x = 0; x <= SCREENWIDTH; x++) R.xtoviewangle[x] = Math.atan((R.centerx - (x + 0.5)) / R.projection);
  for (let x = 0; x < SCREENWIDTH; x++) { R.xcos[x] = Math.cos(R.xtoviewangle[x]); R.distscale[x] = 1 / R.xcos[x]; }
  for (let i = 0; i < LIGHTLEVELS; i++) {
    const startmap = ((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS;
    const sl = new Uint8Array(MAXLIGHTSCALE), zl = new Uint8Array(MAXLIGHTZ);
    for (let j = 0; j < MAXLIGHTSCALE; j++) sl[j] = Math.max(0, Math.min(NUMCOLORMAPS - 1, Math.floor(startmap - j / 2)));
    for (let j = 0; j < MAXLIGHTZ; j++) {
      const scale = Math.floor(160 / (j + 1));
      zl[j] = Math.max(0, Math.min(NUMCOLORMAPS - 1, Math.floor(startmap - scale / 2)));
    }
    R.scalelight.push(sl); R.zlight.push(zl);
  }
})();

let gfx = null;
let viewx, viewy, viewz, viewangle, viewcos, viewsin, extralight, fixedcolormap;
let solidsegs, drawsegs, vissprites, rframe = 0;
const clipangle = Math.PI / 4;

function angleToX(a) {
  if (a > Math.PI) a -= TAU;
  const sx = R.centerx - Math.tan(a) * R.projection;
  return Math.max(0, Math.min(R.viewwidth, Math.ceil(sx - 0.5)));
}

function renderPlayerView(player) {
  const mo = player.mo;
  viewx = mo.x; viewy = mo.y; viewz = player.viewz; viewangle = mo.angle;
  viewcos = Math.cos(viewangle); viewsin = Math.sin(viewangle);
  extralight = player.extralight;
  fixedcolormap = player.fixedcolormap ? player.fixedcolormap : -1;
  rframe++;
  for (let x = 0; x < R.viewwidth; x++) {
    const a = viewangle + R.xtoviewangle[x];
    R.colcos[x] = Math.cos(a); R.colsin[x] = Math.sin(a);
  }
  R.ceilingclip.fill(-1); R.floorclip.fill(R.viewheight);
  solidsegs = [{ first: -0x7fffffff, last: -1 }, { first: R.viewwidth, last: 0x7fffffff }];
  drawsegs = []; vissprites = [];
  validcount++;
  if (level.nodes.length) renderBSPNode(level.nodes.length - 1); else renderSubsector(0);
  drawMasked();
  drawPlayerSprites(player);
}

// ---- BSP traversal ----
function renderBSPNode(bsp) {
  while (!(bsp & NF_SUBSECTOR)) {
    if (solidsegs.length === 1) return;
    const n = level.nodes[bsp], side = pointOnDivlineSide(viewx, viewy, n);
    renderBSPNode(n.children[side]);
    if (!checkBBox(n.bbox[side ^ 1])) return;
    bsp = n.children[side ^ 1];
  }
  renderSubsector(bsp & ~NF_SUBSECTOR);
}
const CHECKCOORD = [[3, 0, 2, 1], [3, 0, 2, 0], [3, 1, 2, 0], [0, 0, 0, 0], [2, 0, 2, 1], [0, 0, 0, 0], [3, 1, 3, 0], [0, 0, 0, 0], [2, 0, 3, 1], [2, 1, 3, 1], [2, 1, 3, 0]];
function checkBBox(bb) {
  const boxx = viewx <= bb[2] ? 0 : viewx < bb[3] ? 1 : 2;
  const boxy = viewy >= bb[0] ? 0 : viewy > bb[1] ? 1 : 2;
  const bp = boxy * 4 + boxx;
  if (bp === 5) return true;
  const c = CHECKCOORD[bp];
  let a1 = normAngle(pointToAngle(viewx, viewy, bb[c[0]], bb[c[1]]) - viewangle);
  let a2 = normAngle(pointToAngle(viewx, viewy, bb[c[2]], bb[c[3]]) - viewangle);
  const span = normAngle(a1 - a2);
  if (span >= Math.PI) return true;
  let tspan = normAngle(a1 + clipangle);
  if (tspan > 2 * clipangle) { tspan -= 2 * clipangle; if (tspan >= span) return false; a1 = clipangle; }
  tspan = normAngle(clipangle - a2);
  if (tspan > 2 * clipangle) { tspan -= 2 * clipangle; if (tspan >= span) return false; a2 = -clipangle; }
  const sx1 = angleToX(a1); let sx2 = angleToX(a2);
  if (sx1 === sx2) return false;
  sx2--;
  let s = 0;
  while (solidsegs[s].last < sx2) s++;
  return !(sx1 >= solidsegs[s].first && sx2 <= solidsegs[s].last);
}

let curline, frontsector, backsector;
function renderSubsector(num) {
  const sub = level.subsectors[num];
  frontsector = sub.sector;
  addSprites(frontsector);
  for (let i = 0; i < sub.numlines; i++) addLine(level.segs[sub.firstline + i]);
}

function addLine(seg) {
  curline = seg;
  const angle1 = pointToAngle(viewx, viewy, seg.v1.x, seg.v1.y), angle2 = pointToAngle(viewx, viewy, seg.v2.x, seg.v2.y);
  const span = normAngle(angle1 - angle2);
  if (span >= Math.PI) return;
  let a1 = normAngle(angle1 - viewangle), a2 = normAngle(angle2 - viewangle);
  let tspan = normAngle(a1 + clipangle);
  if (tspan > 2 * clipangle) { tspan -= 2 * clipangle; if (tspan >= span) return; a1 = clipangle; }
  tspan = normAngle(clipangle - a2);
  if (tspan > 2 * clipangle) { tspan -= 2 * clipangle; if (tspan >= span) return; a2 = -clipangle; }
  const x1 = angleToX(a1), x2 = angleToX(a2);
  if (x1 >= x2) return;
  backsector = seg.backsector;
  if (!backsector) return clipSolidWallSegment(x1, x2 - 1);
  if (backsector.ceilingheight <= frontsector.floorheight || backsector.floorheight >= frontsector.ceilingheight)
    return clipSolidWallSegment(x1, x2 - 1);
  if (backsector.ceilingheight !== frontsector.ceilingheight || backsector.floorheight !== frontsector.floorheight)
    return clipPassWallSegment(x1, x2 - 1);
  if (backsector.ceilingpic === frontsector.ceilingpic && backsector.floorpic === frontsector.floorpic &&
    backsector.lightlevel === frontsector.lightlevel && seg.sidedef.midtexture === 0) return;
  clipPassWallSegment(x1, x2 - 1);
}

function clipSolidWallSegment(first, last) {
  const ss = solidsegs;
  let start = 0;
  while (ss[start].last < first - 1) start++;
  if (first < ss[start].first) {
    if (last < ss[start].first - 1) { storeWallRange(first, last); ss.splice(start, 0, { first, last }); return; }
    storeWallRange(first, ss[start].first - 1);
    ss[start].first = first;
  }
  if (last <= ss[start].last) return;
  let next = start;
  let crunch = false;
  while (last >= ss[next + 1].first - 1) {
    storeWallRange(ss[next].last + 1, ss[next + 1].first - 1);
    next++;
    if (last <= ss[next].last) { ss[start].last = ss[next].last; crunch = true; break; }
  }
  if (!crunch) { storeWallRange(ss[next].last + 1, last); ss[start].last = last; }
  if (next !== start) ss.splice(start + 1, next - start);
}
function clipPassWallSegment(first, last) {
  const ss = solidsegs;
  let start = 0;
  while (ss[start].last < first - 1) start++;
  if (first < ss[start].first) {
    if (last < ss[start].first - 1) { storeWallRange(first, last); return; }
    storeWallRange(first, ss[start].first - 1);
  }
  if (last <= ss[start].last) return;
  while (last >= ss[start + 1].first - 1) {
    storeWallRange(ss[start].last + 1, ss[start + 1].first - 1);
    start++;
    if (last <= ss[start].last) return;
  }
  storeWallRange(ss[start].last + 1, last);
}

// ---- walls (R_StoreWallRange + R_RenderSegLoop) ----
function wallLightNum(seg, sector) {
  let ln = (sector.lightlevel >> 4) + extralight;
  if (seg.v1.y === seg.v2.y) ln--; else if (seg.v1.x === seg.v2.x) ln++;
  return Math.max(0, Math.min(LIGHTLEVELS - 1, ln));
}
function storeWallRange(start, stop) {
  if (start > stop) return;
  const seg = curline, side = seg.sidedef, line = seg.linedef, fs = frontsector, bs = backsector;
  line.flags |= ML_MAPPED;
  const tt = gfx.texTranslation;
  const sdx = seg.v2.x - seg.v1.x, sdy = seg.v2.y - seg.v1.y, seglen = Math.hypot(sdx, sdy);
  const ox = seg.v1.x - viewx, oy = seg.v1.y - viewy;
  const worldtop = fs.ceilingheight - viewz, worldbottom = fs.floorheight - viewz;
  let midtex = 0, toptex = 0, bottomtex = 0, maskedtex = 0;
  let rw_midtexturemid = 0, rw_toptexturemid = 0, rw_bottomtexturemid = 0, worldhigh = 0, worldlow = 0;
  let markfloor = fs.floorheight < viewz, markceiling = fs.ceilingheight > viewz || fs.ceilingpic === gfx.skyflat;
  if (!bs) {
    midtex = tt[side.midtexture];
    if (midtex) {
      const th = gfx.textures[midtex].h;
      rw_midtexturemid = (line.flags & ML_DONTPEGBOTTOM ? fs.floorheight + th - viewz : worldtop) + side.rowoffset;
    }
  } else {
    worldhigh = bs.ceilingheight - viewz; worldlow = bs.floorheight - viewz;
    let wtop = worldtop;
    if (fs.ceilingpic === gfx.skyflat && bs.ceilingpic === gfx.skyflat) wtop = worldhigh;   // hack: no upper wall between skies
    if (worldhigh < wtop) {
      toptex = tt[side.toptexture];
      const th = toptex ? gfx.textures[toptex].h : 0;
      rw_toptexturemid = (line.flags & ML_DONTPEGTOP ? worldtop : bs.ceilingheight + th - viewz) + side.rowoffset;
    }
    if (worldlow > worldbottom) {
      bottomtex = tt[side.bottomtexture];
      rw_bottomtexturemid = (line.flags & ML_DONTPEGBOTTOM ? worldtop : worldlow) + side.rowoffset;
    }
    if (side.midtexture) maskedtex = tt[side.midtexture];
    storeWallRange.wtop = wtop;
  }
  const solid = !bs || bs.ceilingheight <= fs.floorheight || bs.floorheight >= fs.ceilingheight;
  const lightnum = wallLightNum(seg, fs), lights = R.scalelight[lightnum];
  const n = stop - start + 1;
  const ds = { x1: start, x2: stop, scale: new Float32Array(n), sprtop: new Int16Array(n), sprbot: new Int16Array(n), masked: null, solid };
  if (maskedtex) {
    const t = gfx.texture(maskedtex);
    ds.masked = {
      tex: t, cols: new Float32Array(n), done: new Uint8Array(n), lightnum,
      texmid: (line.flags & ML_DONTPEGBOTTOM ? Math.max(fs.floorheight, bs.floorheight) + t.h - viewz : Math.min(fs.ceilingheight, bs.ceilingheight) - viewz) + side.rowoffset,
    };
  }
  const mt = midtex ? gfx.texture(midtex) : null, tp = toptex ? gfx.texture(toptex) : null, bt = bottomtex ? gfx.texture(bottomtex) : null;
  const wtop = bs ? storeWallRange.wtop : worldtop;
  const vh = R.viewheight, cy = R.centery;
  for (let x = start; x <= stop; x++) {
    const c = R.colcos[x], s = R.colsin[x];
    const det = sdx * s - c * sdy;
    let t, u;
    if (Math.abs(det) < 1e-9) { t = Math.hypot(ox, oy); u = 0; }
    else { t = (sdx * oy - ox * sdy) / det; u = (c * oy - s * ox) / det; }
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    let z = t * R.xcos[x];
    let scale = z > 0 ? R.projection / z : 64;
    if (scale > 64) scale = 64; if (scale < 1 / 256) scale = 1 / 256;
    const iscale = 1 / scale;
    const texcol = Math.floor(u * seglen + seg.offset + side.textureoffset);
    const cmap = fixedcolormap >= 0 ? fixedcolormap : lights[Math.min(MAXLIGHTSCALE - 1, Math.floor(scale * 16))];
    const cc = R.ceilingclip[x], fc = R.floorclip[x];
    let yl = Math.ceil(cy - wtop * scale); if (yl < cc + 1) yl = cc + 1;
    if (markceiling) { const top = cc + 1, bottom = Math.min(yl - 1, fc - 1); if (top <= bottom) drawPlaneCol(x, top, bottom, fs, true); }
    let yh = Math.floor(cy - worldbottom * scale); if (yh >= fc) yh = fc - 1;
    if (markfloor) { const top = Math.max(yh + 1, cc + 1), bottom = fc - 1; if (top <= bottom) drawPlaneCol(x, top, bottom, fs, false); }
    ds.scale[x - start] = scale;
    if (!bs) {
      if (mt) drawWallCol(x, yl, yh, mt, texcol, rw_midtexturemid, iscale, cmap);
      R.ceilingclip[x] = vh; R.floorclip[x] = -1;
    } else {
      if (worldhigh < wtop) {
        let mid = Math.floor(cy - worldhigh * scale); if (mid >= fc) mid = fc - 1;
        if (mid >= yl) { if (tp) drawWallCol(x, yl, mid, tp, texcol, rw_toptexturemid, iscale, cmap); R.ceilingclip[x] = mid; }
        else R.ceilingclip[x] = yl - 1;
      } else R.ceilingclip[x] = yl - 1;
      if (worldlow > worldbottom) {
        let mid = Math.ceil(cy - worldlow * scale); if (mid <= R.ceilingclip[x]) mid = R.ceilingclip[x] + 1;
        if (mid <= yh) { if (bt) drawWallCol(x, mid, yh, bt, texcol, rw_bottomtexturemid, iscale, cmap); R.floorclip[x] = mid; }
        else R.floorclip[x] = yh + 1;
      } else R.floorclip[x] = yh + 1;
      if (solid) { R.ceilingclip[x] = vh; R.floorclip[x] = -1; }
      if (ds.masked) ds.masked.cols[x - start] = texcol;
    }
    ds.sprtop[x - start] = R.ceilingclip[x]; ds.sprbot[x - start] = R.floorclip[x];
  }
  drawsegs.push(ds);
}

function drawWallCol(x, yl, yh, t, col, texmid, iscale, cmap) {
  if (yl > yh) return;
  const fb = R.fb, cm = gfx.colormaps, cmo = cmap * 256, h = t.h, w = t.w, px = t.px;
  col %= w; if (col < 0) col += w;
  const base = col * h;
  let frac = texmid + (yl - R.centery) * iscale;
  for (let y = yl; y <= yh; y++, frac += iscale) {
    let row = Math.floor(frac) % h; if (row < 0) row += h;
    const c = px[base + row];
    fb[y * SCREENWIDTH + x] = cm[cmo + (c < 0 ? 0 : c)];
  }
}

function drawPlaneCol(x, y1, y2, sector, ceiling) {
  const fb = R.fb, cm = gfx.colormaps;
  const pic = gfx.flatTranslation[ceiling ? sector.ceilingpic : sector.floorpic];
  if (pic === gfx.skyflat) return drawSkyCol(x, y1, y2);
  const flat = gfx.flat(pic), h = Math.abs((ceiling ? sector.ceilingheight : sector.floorheight) - viewz);
  const ln = Math.max(0, Math.min(LIGHTLEVELS - 1, (sector.lightlevel >> 4) + extralight)), zl = R.zlight[ln];
  const c = R.colcos[x], s = R.colsin[x], ds = R.distscale[x];
  for (let y = y1; y <= y2; y++) {
    const dy = Math.abs(y - R.centery + 0.5);
    const dist = h * R.projection / dy, len = dist * ds;
    const xf = Math.floor(viewx + c * len) & 63, yf = Math.floor(-viewy - s * len) & 63;
    const cmap = fixedcolormap >= 0 ? fixedcolormap : zl[Math.min(MAXLIGHTZ - 1, Math.floor(dist / 16))];
    fb[y * SCREENWIDTH + x] = cm[cmap * 256 + flat[yf * 64 + xf]];
  }
}
function drawSkyCol(x, y1, y2) {
  const t = gfx.texture(gfx.texTranslation[R.skytexture]), fb = R.fb, cm = gfx.colormaps;
  const ang = normAngle(viewangle + R.xtoviewangle[x]);
  let col = Math.floor(ang / TAU * 1024) % t.w;
  const base = col * t.h;
  for (let y = y1; y <= y2; y++) {
    let row = (100 + y - R.centery) % t.h; if (row < 0) row += t.h;
    const c = t.px[base + row];
    fb[y * SCREENWIDTH + x] = cm[c < 0 ? 0 : c];
  }
}

// ---- sprites (R_AddSprites / R_ProjectSprite) ----
function addSprites(sec) {
  if (sec.validcount === validcount) return;
  sec.validcount = validcount;
  const ln = Math.max(0, Math.min(LIGHTLEVELS - 1, (sec.lightlevel >> 4) + extralight));
  for (const th of sec.thinglist) projectSprite(th, R.scalelight[ln]);
}
function projectSprite(th, lights) {
  const trx = th.x - viewx, try_ = th.y - viewy;
  const tz = trx * viewcos + try_ * viewsin;
  if (tz < 4) return;
  const xscale = R.projection / tz;
  let tx = trx * viewsin - try_ * viewcos;
  if (Math.abs(tx) > tz * 4) return;
  const frames = gfx.sprites[th.sprite], fr = frames && frames[th.frame & 0x7fff];
  if (!fr) return;
  let lump, flip;
  if (fr.rotate) {
    const ang = pointToAngle(viewx, viewy, th.x, th.y);
    const rot = Math.floor(normAngle(ang - th.angle + ANG45 / 2 * 9) / ANG45) & 7;
    lump = fr.lump[rot]; flip = fr.flip[rot];
  } else { lump = fr.lump[0]; flip = fr.flip[0]; }
  if (lump < 0) return;
  const p = gfx.patchByNum(lump);
  tx -= flip ? p.w - p.lo : p.lo;
  const x1 = Math.floor(R.centerx + tx * xscale);
  if (x1 > R.viewwidth) return;
  const x2 = Math.floor(R.centerx + (tx + p.w) * xscale) - 1;
  if (x2 < 0) return;
  let cmap;
  if (th.flags & MF_SHADOW) cmap = -2;
  else if (fixedcolormap >= 0) cmap = fixedcolormap;
  else if (th.frame & 0x8000) cmap = 0;
  else cmap = lights[Math.min(MAXLIGHTSCALE - 1, Math.floor(xscale * 16))];
  vissprites.push({ x1: Math.max(0, x1), x2: Math.min(R.viewwidth - 1, x2), sx1: x1, scale: xscale, gz: th.z, gzt: th.z + p.to,
    texmid: th.z + p.to - viewz, patch: p, flip, cmap, iscale: 1 / xscale });
}

function drawMasked() {
  vissprites.sort((a, b) => a.scale - b.scale);
  for (const v of vissprites) drawSprite(v);
  for (let i = drawsegs.length - 1; i >= 0; i--) { const ds = drawsegs[i]; if (ds.masked) renderMaskedSegRange(ds, ds.x1, ds.x2); }
}

function renderMaskedSegRange(ds, x1, x2) {
  const m = ds.masked, t = m.tex, fb = R.fb, cm = gfx.colormaps, lights = R.scalelight[m.lightnum];
  for (let x = x1; x <= x2; x++) {
    const i = x - ds.x1;
    if (m.done[i]) continue;
    m.done[i] = 1;
    const scale = ds.scale[i], iscale = 1 / scale;
    let col = Math.floor(m.cols[i]) % t.w; if (col < 0) col += t.w;
    const cmap = fixedcolormap >= 0 ? fixedcolormap : lights[Math.min(MAXLIGHTSCALE - 1, Math.floor(scale * 16))];
    const top = R.centery - m.texmid * scale;
    let yl = Math.ceil(top), yh = Math.ceil(top + t.h * scale) - 1;
    if (yl <= ds.sprtop[i]) yl = ds.sprtop[i] + 1;
    if (yh >= ds.sprbot[i]) yh = ds.sprbot[i] - 1;
    const base = col * t.h;
    for (let y = yl; y <= yh; y++) {
      const row = Math.floor(m.texmid + (y - R.centery) * iscale);
      if (row < 0 || row >= t.h) continue;
      const c = t.px[base + row];
      if (c >= 0) fb[y * SCREENWIDTH + x] = cm[cmap * 256 + c];
    }
  }
}

const clipbot = new Int16Array(SCREENWIDTH), cliptop = new Int16Array(SCREENWIDTH);
function drawSprite(v) {
  for (let x = v.x1; x <= v.x2; x++) { clipbot[x] = -2; cliptop[x] = -2; }
  for (let i = drawsegs.length - 1; i >= 0; i--) {
    const ds = drawsegs[i];
    if (ds.x1 > v.x2 || ds.x2 < v.x1) continue;
    const r1 = Math.max(ds.x1, v.x1), r2 = Math.min(ds.x2, v.x2);
    let behind = true;
    for (let x = r1; x <= r2; x++) if (ds.scale[x - ds.x1] >= v.scale) { behind = false; break; }
    if (behind) { if (ds.masked) renderMaskedSegRange(ds, r1, r2); continue; }
    for (let x = r1; x <= r2; x++) {
      if (ds.scale[x - ds.x1] < v.scale) continue;   // this column of the wall is behind the sprite
      if (clipbot[x] === -2) clipbot[x] = ds.sprbot[x - ds.x1];
      if (cliptop[x] === -2) cliptop[x] = ds.sprtop[x - ds.x1];
    }
  }
  for (let x = v.x1; x <= v.x2; x++) { if (clipbot[x] === -2) clipbot[x] = R.viewheight; if (cliptop[x] === -2) cliptop[x] = -1; }
  drawVisSprite(v, cliptop, clipbot);
}

function drawVisSprite(v, ctop, cbot) {
  const p = v.patch, fb = R.fb, cm = gfx.colormaps, sprtop = R.centery - v.texmid * v.scale;
  let frac = v.flip ? p.w - 1e-6 : 0;
  const step = v.flip ? -v.iscale : v.iscale;
  frac += step * (v.x1 - v.sx1);
  for (let x = v.x1; x <= v.x2; x++, frac += step) {
    const col = Math.floor(frac);
    if (col < 0 || col >= p.w) continue;
    let yl = Math.ceil(sprtop), yh = Math.ceil(sprtop + p.h * v.scale) - 1;
    if (yl <= ctop[x]) yl = ctop[x] + 1;
    if (yh >= cbot[x]) yh = cbot[x] - 1;
    const base = col * p.h;
    for (let y = yl; y <= yh; y++) {
      const row = Math.floor((y - sprtop) * v.iscale);
      if (row < 0 || row >= p.h) continue;
      const c = p.px[base + row];
      if (c < 0) continue;
      const o = y * SCREENWIDTH + x;
      if (v.cmap === -2) {   // R_DrawFuzzColumn
        if (y <= 0 || y >= R.viewheight - 1) continue;
        fb[o] = cm[6 * 256 + fb[o + FUZZTABLE[R.fuzzpos]]];
        R.fuzzpos = (R.fuzzpos + 1) % FUZZTABLE.length;
      } else fb[o] = cm[v.cmap * 256 + c];
    }
  }
}

// ---- player weapon sprites (R_DrawPlayerSprites) ----
const screenheightarray = new Int16Array(SCREENWIDTH), negonearray = new Int16Array(SCREENWIDTH).fill(-1);
function drawPlayerSprites(pl) {
  screenheightarray.fill(R.viewheight);
  const ln = Math.max(0, Math.min(LIGHTLEVELS - 1, (pl.mo.subsector.sector.lightlevel >> 4) + extralight));
  for (const psp of pl.psprites) {
    if (!psp.state) continue;
    const st = psp.state, frames = gfx.sprites[st.sprite], fr = frames && frames[st.frame & 0x7fff];
    if (!fr) continue;
    const p = gfx.patchByNum(fr.lump[0]), flip = fr.flip[0];
    let tx = psp.sx - 160 - p.lo;
    const x1 = Math.floor(R.centerx + tx);
    if (x1 > R.viewwidth) continue;
    const x2 = Math.floor(R.centerx + tx + p.w) - 1;
    if (x2 < 0) continue;
    let cmap;
    if (pl.powers[pw_invisibility] > 4 * 32 || (pl.powers[pw_invisibility] & 8)) cmap = -2;
    else if (fixedcolormap >= 0) cmap = fixedcolormap;
    else if (st.frame & 0x8000) cmap = 0;
    else cmap = R.scalelight[ln][MAXLIGHTSCALE - 1];
    drawVisSprite({ x1: Math.max(0, x1), x2: Math.min(R.viewwidth - 1, x2), sx1: x1, scale: 1, iscale: 1,
      texmid: 100 + 0.5 - (psp.sy - p.to), patch: p, flip, cmap }, negonearray, screenheightarray);
  }
}
