// ---- s_sound.c / i_sound.c : DMX sound effects via WebAudio ----
const SND = { ctx: null, buffers: new Map(), channels: [], volume: 0.6 };
const S_CLIPPING_DIST = 1200, S_CLOSE_DIST = 160, S_ATTENUATOR = S_CLIPPING_DIST - S_CLOSE_DIST, S_STEREO_SWING = 96;

function S_Init() {
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return;
  try { SND.ctx = new (typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext)(); } catch (e) { SND.ctx = null; }
}
function S_Resume() { if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume(); }
function sfxBuffer(id) {
  if (SND.buffers.has(id)) return SND.buffers.get(id);
  let buf = null;
  const n = gfx.wad.num('DS' + INFO.sfx[id].toUpperCase());
  if (n >= 0) {
    const d = gfx.wad.data(n);
    if (d.length > 8 && u16(d, 0) === 3) {
      const rate = u16(d, 2) || 11025, count = Math.min(d.length - 8, i32(d, 4));
      const start = 8 + 16, len = Math.max(1, count - 32);   // DMX pads 16 bytes either side
      buf = SND.ctx.createBuffer(1, len, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = ((d[start + i] ?? 128) - 128) / 128;
    }
  }
  SND.buffers.set(id, buf);
  return buf;
}
// S_AdjustSoundParams
function soundParams(origin) {
  const pl = players[0];
  if (!origin || !pl || !pl.mo || origin === pl.mo) return { vol: 1, sep: 0 };
  const lis = pl.mo, dx = origin.x - lis.x, dy = origin.y - lis.y;
  const dist = approxDist(dx, dy);
  if (dist > S_CLIPPING_DIST && G.map !== 8) return null;
  let angle = normAngle(pointToAngle(lis.x, lis.y, origin.x, origin.y) - lis.angle);
  const sep = -(S_STEREO_SWING * Math.sin(angle)) / 128;
  let vol = dist < S_CLOSE_DIST ? 1 : (S_CLIPPING_DIST - dist) / S_ATTENUATOR;
  if (G.map === 8) vol = Math.max(vol, 15 / 15 * 0.5);
  return { vol: Math.max(0, Math.min(1, vol)), sep: Math.max(-1, Math.min(1, sep)) };
}
function S_StartSound(origin, id) {
  if (!SND.ctx || !id || !gfx) return;
  const p = soundParams(origin);
  if (!p || p.vol <= 0) return;
  S_StopSound(origin);
  const buf = sfxBuffer(id);
  if (!buf) return;
  const src = SND.ctx.createBufferSource(), gain = SND.ctx.createGain();
  src.buffer = buf; gain.gain.value = p.vol * SND.volume;
  let node = gain;
  if (SND.ctx.createStereoPanner) { const pan = SND.ctx.createStereoPanner(); pan.pan.value = p.sep; gain.connect(pan); node = pan; }
  src.connect(gain); node.connect(SND.ctx.destination);
  const ch = { origin, src, gain, id };
  src.onended = () => { SND.channels = SND.channels.filter(c => c !== ch); };
  SND.channels.push(ch);
  if (SND.channels.length > 8) { const old = SND.channels.shift(); try { old.src.stop(); } catch (e) { } }
  src.start();
}
function S_StopSound(origin) {
  if (!SND.ctx || !origin) return;
  for (const c of SND.channels) if (c.origin === origin) { try { c.src.stop(); } catch (e) { } }
  SND.channels = SND.channels.filter(c => c.origin !== origin);
}
// keep volume/pan up to date as things move (S_UpdateSounds)
function S_UpdateSounds() {
  if (!SND.ctx) return;
  for (const c of SND.channels) {
    if (!c.origin) continue;
    const p = soundParams(c.origin);
    if (!p) { try { c.src.stop(); } catch (e) { } continue; }
    c.gain.gain.value = p.vol * SND.volume;
  }
}
