// Headless engine test: node doom/tools/test_engine.js [maps...]
// Loads every Doom 1 map from doom/DOOM.WAD, simulates gameplay tics, and writes PNG screenshots to /tmp/doomshots.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const ORDER = ['info', 'wad', 'level', 'render', 'mobj', 'inter', 'user', 'enemy', 'spec', 'hud', 'sound', 'game'];
const src = ORDER.map(f => fs.readFileSync(path.join(ROOT, 'engine', f + '.js'), 'utf8')).join('\n;\n');
new Function(src)();
const D = globalThis.DOOM;

function png(file, idx, pal) {
  const w = 320, h = 200, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pal[idx[y * w + x]], o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = c & 255; raw[o + 1] = (c >> 8) & 255; raw[o + 2] = (c >> 16) & 255;
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const wadPath = process.env.WAD || path.join(ROOT, 'DOOM.WAD');
D.bootData(new Uint8Array(fs.readFileSync(wadPath)));
const out = '/tmp/doomshots'; fs.mkdirSync(out, { recursive: true });
let maps = process.argv.slice(2);
if (!maps.length) for (let e = 1; e <= 3; e++) for (let m = 1; m <= 9; m++) maps.push(`E${e}M${m}`);
let fails = 0;
for (const name of maps) {
  const e = +name[1], m = +name[3];
  if (!D.gfx.wad.has(name)) continue;
  const t0 = Date.now();
  try {
    D.initNew(2, e, m);
    D.drawScreen();
    png(`${out}/${name}_start.png`, D.R.fb, D.gfx.palettes[0]);
    const pl = D.players[0];
    pl.cheats |= 2;                                  // god mode so the run survives
    const ks = D.keys;
    for (let t = 0; t < 35 * 20; t++) {             // 20 seconds: walk, turn, fire, use
      ks.clear();
      ks.add('ArrowUp'); if ((t >> 5) % 3 === 0) ks.add('ArrowLeft');
      if (t % 9 < 3) ks.add('ControlLeft');
      if (t % 40 === 0) ks.add('Space');
      if (t === 100) D.INPUT.weapon = 2;
      D.gameTick();
      if (D.gamestate !== 'level') break;
    }
    D.drawScreen();
    png(`${out}/${name}_play.png`, D.R.fb, D.gfx.palettes[0]);
    const alive = D.mobjs.filter(x => !x.removed);
    console.log(`${name}: ok  ${Date.now() - t0}ms  things=${alive.length} kills=${pl.killcount}/${D.G.totalkills} pos=(${pl.mo.x | 0},${pl.mo.y | 0}) hp=${pl.health} state=${D.gamestate}`);
  } catch (err) { fails++; console.log(`${name}: FAIL ${err.stack}`); }
}
// render speed
const first = maps.find(n => D.gfx.wad.has(n));
D.initNew(2, +first[1], +first[3]);
let t0 = Date.now(); for (let i = 0; i < 100; i++) D.drawScreen();
console.log(`render: ${((Date.now() - t0) / 100).toFixed(2)} ms/frame`);
// intermission + finale screens
D.exitLevel(false); D.doCompleted(); for (let i = 0; i < 200; i++) D.gameTick(); D.drawScreen();
png(`${out}/intermission.png`, D.R.fb, D.gfx.palettes[0]);
D.gamestate = 'title'; D.drawScreen(); png(`${out}/title.png`, D.R.fb, D.gfx.palettes[0]);
process.exit(fails ? 1 : 0);
