"""DOOM in Streamlit: a JavaScript port of the linuxdoom-1.10 engine (see engine/) running real WAD data.

The WAD is read from this folder (DOOM.WAD, DOOM1.WAD, ...) or uploaded. Only the selected episode's maps
plus shared graphics/sounds are sent to the browser, gzipped, to keep the component payload small.
"""
import base64
import gzip
import re
import struct
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

APP_DIR = Path(__file__).parent
ENGINE_FILES = ["info", "wad", "level", "render", "mobj", "inter", "user", "enemy", "spec", "hud", "sound", "game"]
SKILLS = ["I'm too young to die.", "Hey, not too rough.", "Hurt me plenty.", "Ultra-Violence.", "Nightmare!"]
MAP_NAMES = {
    1: ["Hangar", "Nuclear Plant", "Toxin Refinery", "Command Control", "Phobos Lab",
        "Central Processing", "Computer Station", "Phobos Anomaly", "Military Base"],
    2: ["Deimos Anomaly", "Containment Area", "Refinery", "Deimos Lab", "Command Center",
        "Halls of the Damned", "Spawning Vats", "Tower of Babel", "Fortress of Mystery"],
    3: ["Hell Keep", "Slough of Despair", "Pandemonium", "House of Pain", "Unholy Cathedral",
        "Mt. Erebus", "Limbo", "Dis", "Warrens"],
}
MAP_LUMPS = 10  # THINGS..BLOCKMAP following each ExMy marker

st.set_page_config(page_title="DOOM", page_icon=":skull:", layout="wide")


def parse_wad(data: bytes):
    if data[:4] not in (b"IWAD", b"PWAD"):
        raise ValueError("Not a WAD file")
    n, ofs = struct.unpack("<ii", data[4:12])
    lumps = []
    for i in range(n):
        pos, size, name = struct.unpack("<ii8s", data[ofs + 16 * i: ofs + 16 * i + 16])
        lumps.append((name.rstrip(b"\0").decode("latin-1").upper(), pos, size))
    return lumps


@st.cache_data(show_spinner=False, max_entries=8)
def wad_maps(data: bytes):
    return sorted({nm for nm, _, _ in parse_wad(data) if re.fullmatch(r"E\dM\d", nm)})


@st.cache_data(show_spinner="Preparing WAD...", max_entries=8)
def trimmed_wad_b64(data: bytes, episode: int) -> str:
    """Rebuild a WAD with only `episode`'s maps; drop music, PC-speaker sounds and demos. Gzip + base64."""
    lumps = parse_wad(data)
    keep, skip = [], 0
    for nm, pos, size in lumps:
        if skip:
            skip -= 1
            continue
        m = re.fullmatch(r"E(\d)M\d", nm)
        if m and int(m[1]) != episode:
            skip = MAP_LUMPS
            continue
        if nm.startswith(("D_", "DP", "DEMO")) or nm == "GENMIDI":
            continue
        keep.append((nm, data[pos: pos + size]))
    body = bytearray()
    directory = bytearray()
    offset = 12
    for nm, chunk in keep:
        directory += struct.pack("<ii8s", offset, len(chunk), nm.encode("latin-1"))
        body += chunk
        offset += len(chunk)
    out = data[:4] + struct.pack("<ii", len(keep), offset) + bytes(body) + bytes(directory)
    return base64.b64encode(gzip.compress(out, 6)).decode("ascii")


@st.cache_data(show_spinner=False)
def engine_js(mtimes: tuple) -> str:
    return "\n;\n".join((APP_DIR / "engine" / f"{f}.js").read_text(encoding="utf-8") for f in ENGINE_FILES)


def local_wads():
    return sorted(p for p in APP_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".wad")


GAME_HTML = r"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#000;overflow:hidden;color:#c00;font:14px monospace}
#wrap{display:flex;justify-content:center;align-items:center;height:100vh}
canvas{image-rendering:pixelated;width:min(100vw,calc(100vh*4/3));aspect-ratio:4/3;outline:none;cursor:crosshair}
#msg{position:absolute;top:45%;width:100%;text-align:center}
</style></head><body><div id="wrap"><canvas id="c" width="320" height="200" tabindex="0"></canvas></div>
<div id="msg">Loading WAD...</div>
<script>__ENGINE__</script>
<script>
(async () => {
  const msg = document.getElementById('msg');
  try {
    const b64 = "__WAD__";
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    const wad = new Uint8Array(await new Response(stream).arrayBuffer());
    DOOM.bootData(wad);
    msg.remove();
    const cv = document.getElementById('c');
    DOOM.INPUT.mouseSens = __SENS__;
    DOOM.startBrowser(cv, { skill: __SKILL__, episode: __EPISODE__, map: __MAP__ });
    cv.focus();
  } catch (e) { msg.textContent = 'Error: ' + e.message; console.error(e); }
})();
</script></body></html>"""

st.title("DOOM")

wad_bytes, wad_label = None, None
wads = local_wads()
with st.sidebar:
    st.header("Game")
    if wads:
        choice = st.selectbox("WAD", wads, format_func=lambda p: p.name)
        wad_bytes, wad_label = choice.read_bytes(), choice.name
    up = st.file_uploader("Upload a WAD" if not wads else "...or upload another WAD", type=["wad"])
    if up is not None:
        wad_bytes, wad_label = up.getvalue(), up.name

if wad_bytes is None:
    st.info("Add `DOOM.WAD` / `DOOM1.WAD` next to this app, or upload one in the sidebar. "
            "The shareware DOOM1.WAD is freely distributable.")
    st.stop()

try:
    maps = wad_maps(wad_bytes)
except ValueError as e:
    st.error(f"{wad_label}: {e}")
    st.stop()
if not maps:
    st.error(f"{wad_label} has no Doom 1 (ExMy) maps. Doom II WADs are not supported by this port.")
    st.stop()

with st.sidebar:
    episodes = sorted({int(m[1]) for m in maps})
    episode = st.selectbox("Episode", episodes, format_func=lambda e: f"Episode {e}" + {1: ": Knee-Deep in the Dead", 2: ": The Shores of Hell", 3: ": Inferno"}.get(e, ""))
    ep_maps = [int(m[3]) for m in maps if int(m[1]) == episode]
    mapnum = st.selectbox("Map", ep_maps, format_func=lambda m: f"E{episode}M{m}: " + (MAP_NAMES.get(episode, [""] * 9)[m - 1] if episode in MAP_NAMES else ""))
    skill = st.selectbox("Skill", range(5), index=2, format_func=lambda i: SKILLS[i])
    sens = st.slider("Mouse sensitivity", 1, 15, 5)
    st.markdown(
        """
**Controls** (click the game to capture the mouse)
- `↑ ↓` / `W S` move, `← →` / `A D` turn, `Q E` or `, .` strafe, `Alt`+turn strafe
- `Shift` run, `Ctrl` / left click fire, `Space` use / open
- `1`–`7` weapons, `Tab` automap (`+`/`-` zoom), `P` pause
- Cheats: `iddqd` `idkfa` `idclip` `iddt`
"""
    )

engine = engine_js(tuple((APP_DIR / "engine" / f"{f}.js").stat().st_mtime for f in ENGINE_FILES))
html = (GAME_HTML.replace("__ENGINE__", engine.replace("</script", "<\\/script"))
        .replace("__SKILL__", str(skill)).replace("__EPISODE__", str(episode)).replace("__MAP__", str(mapnum))
        .replace("__SENS__", str(sens)).replace("__WAD__", trimmed_wad_b64(wad_bytes, episode)))
components.html(html, height=640)
st.caption(f"Engine: JavaScript port of id Software's linuxdoom-1.10 source (GPL). Data: {wad_label}.")
