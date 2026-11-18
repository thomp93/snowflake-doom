// ---- w_wad.c + r_data.c : WAD directory, palette, patches, textures, flats, sprites ----
const TD = new TextDecoder('latin1');

class Wad {
  constructor(buf) {
    this.buf = buf;
    const dv = this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const id = TD.decode(buf.subarray(0, 4));
    if (id !== 'IWAD' && id !== 'PWAD') throw new Error('Not a WAD file');
    const n = dv.getInt32(4, true), ofs = dv.getInt32(8, true);
    this.lumps = [];
    this.byName = new Map();
    for (let i = 0; i < n; i++) {
      const p = ofs + i * 16;
      const name = lumpName(buf, p + 8);
      this.lumps.push({ name, pos: dv.getInt32(p, true), size: dv.getInt32(p + 4, true) });
      this.byName.set(name, i);
    }
  }
  num(name) { const i = this.byName.get(name.toUpperCase()); return i === undefined ? -1 : i; }
  has(name) { return this.num(name) >= 0; }
  data(i) { if (typeof i === 'string') { const n = this.num(i); if (n < 0) throw new Error('Lump not found: ' + i); i = n; }
    const l = this.lumps[i]; return this.buf.subarray(l.pos, l.pos + l.size); }
  // lumps between markers (S_START/S_END, F_START/F_END), also matching SS_/FF_ variants
  between(start, end) {
    const out = []; let inside = false;
    for (let i = 0; i < this.lumps.length; i++) {
      const nm = this.lumps[i].name;
      if (nm === start || nm === start[0] + start) { inside = true; continue; }
      if (nm === end || nm === end[0] + end) { inside = false; continue; }
      if (inside && this.lumps[i].size > 0) out.push(i);
    }
    return out;
  }
}

function lumpName(buf, p) {
  let s = '';
  for (let i = 0; i < 8; i++) { const c = buf[p + i]; if (!c) break; s += String.fromCharCode(c); }
  return s.toUpperCase();
}
const i16 = (b, p) => (b[p] | (b[p + 1] << 8)) << 16 >> 16;
const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const i32 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24);

// Patch: column-major Int16Array (w*h), -1 = transparent
function decodePatch(b) {
  const w = i16(b, 0), h = i16(b, 2), lo = i16(b, 4), to = i16(b, 6);
  const px = new Int16Array(w * h).fill(-1);
  for (let x = 0; x < w; x++) {
    let p = i32(b, 8 + x * 4);
    while (p < b.length && b[p] !== 0xff) {
      const top = b[p], len = b[p + 1];
      for (let k = 0; k < len; k++) { const y = top + k; if (y < h) px[x * h + y] = b[p + 3 + k]; }
      p += len + 4;
    }
  }
  return { w, h, lo, to, px };
}

class GfxData {
  constructor(wad) {
    this.wad = wad;
    const pal = wad.data('PLAYPAL');
    this.palettes = [];
    for (let p = 0; p < 14; p++) {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        const o = p * 768 + i * 3;
        t[i] = 0xff000000 | (pal[o + 2] << 16) | (pal[o + 1] << 8) | pal[o];
      }
      this.palettes.push(t);
    }
    this.colormaps = wad.data('COLORMAP');
    this.patchCache = new Map();
    this.loadTextures();
    this.loadFlats();
    this.loadSprites();
  }
  patch(name) {
    let p = this.patchCache.get(name);
    if (p === undefined) { const n = this.wad.num(name); p = n < 0 ? null : decodePatch(this.wad.data(n)); this.patchCache.set(name, p); }
    return p;
  }
  patchByNum(n) {
    const key = '#' + n; let p = this.patchCache.get(key);
    if (!p) { p = decodePatch(this.wad.data(n)); this.patchCache.set(key, p); }
    return p;
  }
  loadTextures() {
    const w = this.wad, pn = w.data('PNAMES'), np = i32(pn, 0), pnums = [];
    for (let i = 0; i < np; i++) pnums.push(w.num(lumpName(pn, 4 + i * 8)));
    this.textures = [{ name: '-', w: 8, h: 128, patches: [], px: null }];
    this.texByName = new Map([['-', 0]]);
    for (const tl of ['TEXTURE1', 'TEXTURE2']) {
      if (!w.has(tl)) continue;
      const b = w.data(tl), n = i32(b, 0);
      for (let i = 0; i < n; i++) {
        const o = i32(b, 4 + i * 4), name = lumpName(b, o);
        const t = { name, w: i16(b, o + 12), h: i16(b, o + 14), patches: [], px: null };
        const pc = i16(b, o + 20);
        for (let k = 0; k < pc; k++) {
          const q = o + 22 + k * 10;
          t.patches.push({ x: i16(b, q), y: i16(b, q + 2), lump: pnums[i16(b, q + 4)] });
        }
        if (!this.texByName.has(name)) { this.texByName.set(name, this.textures.length); this.textures.push(t); }
      }
    }
    this.texTranslation = new Int32Array(this.textures.length).map((_, i) => i);
  }
  texNum(name) { name = (name || '-').toUpperCase(); if (name === '-' || name === '') return 0; const n = this.texByName.get(name); return n === undefined ? 0 : n; }
  // composite texture -> column-major Int16Array; -1 transparent (masked midtextures)
  texture(n) {
    const t = this.textures[n];
    if (!t.px) {
      t.px = new Int16Array(t.w * t.h).fill(-1);
      for (const pp of t.patches) {
        if (pp.lump < 0) continue;
        const p = this.patchByNum(pp.lump);
        for (let x = 0; x < p.w; x++) {
          const tx = pp.x + x; if (tx < 0 || tx >= t.w) continue;
          for (let y = 0; y < p.h; y++) {
            const ty = pp.y + y, c = p.px[x * p.h + y];
            if (ty >= 0 && ty < t.h && c >= 0) t.px[tx * t.h + ty] = c;
          }
        }
      }
    }
    return t;
  }
  loadFlats() {
    const ids = this.wad.between('F_START', 'F_END');
    this.flats = ids.map(i => ({ name: this.wad.lumps[i].name, lump: i, px: null }));
    this.flatByName = new Map(this.flats.map((f, i) => [f.name, i]));
    this.flatTranslation = new Int32Array(this.flats.length).map((_, i) => i);
    this.skyflat = this.flatByName.get('F_SKY1') ?? -1;
  }
  flatNum(name) { const n = this.flatByName.get(name.toUpperCase()); return n === undefined ? 0 : n; }
  flat(n) { const f = this.flats[n]; if (!f.px) f.px = this.wad.data(f.lump); return f.px; }
  // r_things.c R_InitSpriteDefs
  loadSprites() {
    const ids = this.wad.between('S_START', 'S_END'), by = new Map();
    for (const i of ids) {
      const nm = this.wad.lumps[i].name, key = nm.slice(0, 4);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push([i, nm]);
    }
    this.sprites = INFO.sprnames.map(spr => {
      const frames = [];
      for (const [lump, nm] of by.get(spr) || []) {
        const put = (fc, rc, flip) => {
          const f = fc.charCodeAt(0) - 65, r = rc.charCodeAt(0) - 48;
          const fr = frames[f] || (frames[f] = { rotate: false, lump: new Int32Array(8).fill(-1), flip: new Uint8Array(8) });
          if (r === 0) { fr.rotate = false; fr.lump.fill(lump); fr.flip.fill(flip); }
          else { fr.rotate = true; fr.lump[r - 1] = lump; fr.flip[r - 1] = flip; }
        };
        put(nm[4], nm[5], 0);
        if (nm.length >= 8) put(nm[6], nm[7], 1);
      }
      return frames;
    });
  }
}
