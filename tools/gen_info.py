"""Generate engine/info.js from the original linuxdoom-1.10 C source.

Extracts the tables that define the game's behaviour so the JS port uses the
exact original data: states, mobjinfo, sprite names, sounds, weapons, strings,
switch/animation lists and the random number table.

Run:  python3 doom/tools/gen_info.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "DOOM-master" / "linuxdoom-1.10"
OUT = ROOT / "engine" / "info.js"


def read(name):
    return (SRC / name).read_text(encoding="latin-1")


def strip_comments(s):
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return re.sub(r"//[^\n]*", "", s)


def enum_names(text, typename):
    end = re.search(r"\}\s*" + typename + r"\s*;", text).start()
    start = text.rindex("{", 0, text.rindex("typedef", 0, end) + 40)
    body = strip_comments(text[start + 1:end])
    return [x.split("=")[0].strip() for x in body.split(",") if x.strip()]


info_h = read("info.h")
info_c = read("info.c")
mobj_h = strip_comments(read("p_mobj.h"))

sprnames = enum_names(info_h, "spritenum_t")
statenames = enum_names(info_h, "statenum_t")
mobjtypes = enum_names(info_h, "mobjtype_t")
sprites = [n[4:] for n in sprnames if n != "NUMSPRITES"]
statenames = [n for n in statenames if n != "NUMSTATES"]
mobjtypes = [n for n in mobjtypes if n != "NUMMOBJTYPES"]
state_idx = {n: i for i, n in enumerate(statenames)}

flags = {k: int(v, 0) for k, v in re.findall(r"(MF_\w+)\s*=\s*(0x[0-9a-fA-F]+|\d+)", mobj_h)}

sounds_c = strip_comments(read("sounds.c"))
sfx_block = sounds_c[sounds_c.index("S_sfx[]"):]
sfx = re.findall(r'\{\s*"(\w+)",\s*\w+,\s*(\d+)', sfx_block)
sfx_names = [n for n, _ in sfx]
sfx_pri = [int(p) for _, p in sfx]
sfx_idx = {"sfx_" + n: i for i, n in enumerate(sfx_names)}
sfx_idx["sfx_None"] = 0

# --- states
body = strip_comments(info_c[re.search(r"state_t\s+states", info_c).start():re.search(r"mobjinfo_t\s+mobjinfo", info_c).start()])
states = []
for spr, frame, tics, act, nxt, m1, m2 in re.findall(
        r"\{\s*SPR_(\w+)\s*,\s*([^,]+),\s*(-?\d+)\s*,\s*\{\s*(\w+)\s*\}\s*,\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}", body):
    fr = eval(frame.replace("FF_FULLBRIGHT", "0x8000").replace("|", "|"))
    states.append([sprites.index(spr), fr, int(tics), None if act == "NULL" else act, state_idx[nxt], int(m1), int(m2)])
assert len(states) == len(statenames), (len(states), len(statenames))

# --- mobjinfo
FIELDS = ["doomednum", "spawnstate", "spawnhealth", "seestate", "seesound", "reactiontime", "attacksound",
          "painstate", "painchance", "painsound", "meleestate", "missilestate", "deathstate", "xdeathstate",
          "deathsound", "speed", "radius", "height", "mass", "damage", "activesound", "flags", "raisestate"]
body = strip_comments(info_c[re.search(r"mobjinfo_t\s+mobjinfo", info_c).start():])
entries = re.findall(r"\{([^{}]*)\}", body)


def val(tok):
    tok = tok.strip()
    if tok.startswith("S_"):
        return state_idx[tok]
    if tok.startswith("sfx_"):
        return sfx_idx[tok]
    if "MF_" in tok:
        return sum(flags[f.strip()] for f in tok.split("|")) if tok != "0" else 0
    return eval(tok.replace("FRACUNIT", "1"))


mobjinfo = []
for e in entries:
    toks = [t for t in e.split(",") if t.strip()]
    if len(toks) != len(FIELDS):
        continue
    d = {f: val(t) for f, t in zip(FIELDS, toks)}
    mobjinfo.append(d)
assert len(mobjinfo) == len(mobjtypes), (len(mobjinfo), len(mobjtypes))
# fixed-point speeds for missiles are given as N*FRACUNIT -> already converted; monsters use plain ints.

# --- weapons
items = strip_comments(read("d_items.c"))
wbody = items[re.search(r"weaponinfo\[NUMWEAPONS\]", items).start():]
AMMO = {"am_clip": 0, "am_shell": 1, "am_cell": 2, "am_misl": 3, "am_noammo": 5}
weapons = []
for e in re.findall(r"\{([^{}]*)\}", wbody):
    t = [x.strip() for x in e.split(",") if x.strip()]
    if len(t) == 6:
        weapons.append({"ammo": AMMO[t[0]], "upstate": state_idx[t[1]], "downstate": state_idx[t[2]],
                        "readystate": state_idx[t[3]], "atkstate": state_idx[t[4]], "flashstate": state_idx[t[5]]})

# --- strings (simple #define NAME "..." possibly concatenated)
strings = {}
eng = read("d_englsh.h")
for name, rest in re.findall(r'#define\s+(\w+)\s+(?:\\\s*)?((?:"(?:[^"\\]|\\.)*"\s*(?:\\\s*)?)+)', eng):
    parts = re.findall(r'"((?:[^"\\]|\\.)*)"', rest)
    strings[name] = "".join(parts).encode().decode("unicode_escape")

# --- switches / anims
sw = strip_comments(read("p_switch.c"))
switches = [[a, b, int(c)] for a, b, c in re.findall(r'\{\s*"(\w+)",\s*"(\w+)",\s*(\d+)\s*\}', sw)]
sp = strip_comments(read("p_spec.c"))
anims = [[t == "true", a, b, int(s)] for t, a, b, s in
         re.findall(r'\{\s*(true|false),\s*"(\w+)",\s*"(\w+)",\s*(\d+)\s*\}', sp)]

rnd = strip_comments(read("m_random.c"))
rndtable = [int(x) for x in re.findall(r"\d+", rnd[rnd.index("rndtable[256]") + 13:rnd.index("};")])]
assert len(rndtable) == 256

data = {
    "sprnames": sprites, "statenames": statenames, "states": states, "mobjtypes": mobjtypes,
    "mobjinfo": mobjinfo, "flags": flags, "sfx": sfx_names, "sfxpri": sfx_pri, "weapons": weapons,
    "strings": strings, "switches": switches, "anims": anims, "rndtable": rndtable,
}
OUT.parent.mkdir(exist_ok=True)
OUT.write_text("// GENERATED by tools/gen_info.py from linuxdoom-1.10 source. Do not edit.\nconst INFO=" +
               json.dumps(data, separators=(",", ":")) + ";\n")
print(f"states={len(states)} mobjinfo={len(mobjinfo)} sfx={len(sfx_names)} weapons={len(weapons)} "
      f"strings={len(strings)} switches={len(switches)} anims={len(anims)} -> {OUT}")
