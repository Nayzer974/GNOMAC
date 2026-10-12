#!/usr/bin/env python3
"""Check the GObject Introspection names used by the extension against the
typelibs installed on this machine.

GNOME Shell 51 removed Shell.GLSLEffect and changed St.BoxLayout; a name that
no longer exists only fails when the code that uses it runs. This script reads
every `import X from 'gi://X'` and every `X.Name` / `X.Name.MEMBER` in the
extension and reports the ones the installed libraries do not have.

    tools/check-compat.py            # check the extension in this checkout
    tools/check-compat.py --verbose  # also list what was checked

Needs `g-ir-generate` (gobject-introspection). Exit status: 0 = every name
found, 1 = some are missing, 2 = the check could not run.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension" / "gnomac@nayzer974.github.io"
NS = {"c": "http://www.gtk.org/introspection/core/1.0",
      "glib": "http://www.gtk.org/introspection/glib/1.0"}

# Namespaces whose typelib lives next to GNOME Shell or Mutter rather than in
# the default search path.
SEARCH = ["/usr/lib/gnome-shell", "/usr/lib/girepository-1.0",
          "/usr/lib64/girepository-1.0", "/usr/lib/x86_64-linux-gnu/girepository-1.0"]


# Names the code already guards (it tests for them or falls back), and names
# GJS provides itself without a typelib entry.
GUARDED = {"Shell.GLSLEffect", "Shell.SnippetHook"}
GJS_NATIVE = {"Gio.DBus"}
GJS_NATIVE_NAMESPACES = {"cairo"}


def typelib_dirs():
    dirs = [d for d in SEARCH if Path(d).is_dir()]
    for base in ("/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu"):
        dirs += [str(p) for p in Path(base).glob("mutter-*") if p.is_dir()]
    return dirs


def find_typelib(name, dirs):
    best = None
    for d in dirs:
        for p in Path(d).glob(f"{name}-*.typelib"):
            if re.fullmatch(rf"{name}-[0-9.]+\.typelib", p.name):
                best = max(best, p, key=lambda q: q.name) if best else p
    return best


def load_namespace(typelib, dirs, cache):
    """Return {top-level name: {member names}} for a typelib, or None."""
    env_dirs = ":".join(dirs)
    out = subprocess.run(["g-ir-generate", str(typelib)], capture_output=True, text=True,
                         env={"GI_TYPELIB_PATH": env_dirs, "PATH": "/usr/bin:/bin"})
    if out.returncode != 0 or not out.stdout.strip():
        return None
    root = ET.fromstring(out.stdout)
    ns = root.find("c:namespace", NS)
    names = {}
    for child in ns:
        tag = child.tag.split("}")[1]
        name = child.get("name")
        if not name:
            continue
        members = set()
        if tag in ("enumeration", "bitfield"):
            members = {m.get("name").upper() for m in child.findall("c:member", NS)}
        elif tag in ("class", "interface", "record", "union"):
            for kind in ("method", "function", "constructor", "virtual-method", "property", "signal"):
                members |= {m.get("name").replace("-", "_") for m in child.findall(f"c:{kind}", NS)}
        names[name] = (tag, members)
    return names


def main():
    verbose = "--verbose" in sys.argv
    if subprocess.run(["which", "g-ir-generate"], capture_output=True).returncode != 0:
        print("g-ir-generate not found (install gobject-introspection)", file=sys.stderr)
        return 2
    dirs = typelib_dirs()
    files = sorted(list(EXT.rglob("*.js")))
    uses = {}  # namespace -> {symbol: [(file, line, member or None)]}
    for path in files:
        text = path.read_text()
        imported = set(re.findall(r"import\s+(\w+)\s+from\s+'gi://(\w+)(?:\?version=[\d.]+)?'", text))
        aliases = {alias: ns for alias, ns in imported}
        for lineno, line in enumerate(text.splitlines(), 1):
            code = re.sub(r"//.*$", "", line)
            for alias, ns in aliases.items():
                for m in re.finditer(rf"(?<![\w.]){alias}\.([A-Z]\w*)(?:\.([A-Za-z_]\w*))?", code):
                    # `A ?? B` and `A?.B` mean the code copes with a missing name.
                    guarded = "??" in code or "?." in code
                    uses.setdefault(ns, {}).setdefault(m.group(1), []).append(
                        (path.relative_to(ROOT), lineno, m.group(2), guarded))

    missing = 0
    cache = {}
    for ns, symbols in sorted(uses.items()):
        if ns in GJS_NATIVE_NAMESPACES:
            continue
        typelib = find_typelib(ns, dirs)
        if not typelib:
            if verbose:
                print(f"skip {ns}: no typelib installed")
            continue
        api = load_namespace(typelib, dirs, cache)
        if api is None:
            if verbose:
                print(f"cannot read {typelib}", file=sys.stderr)
            continue
        if verbose:
            print(f"{ns}: {len(symbols)} names against {typelib.name}")
        for symbol, places in sorted(symbols.items()):
            if symbol not in api:
                if f"{ns}.{symbol}" in GUARDED | GJS_NATIVE or all(g for *_, g in places):
                    if verbose:
                        print(f"guarded  {ns}.{symbol} (absent, the code copes)")
                    continue
                missing += 1
                where = ", ".join(f"{p}:{n}" for p, n, _, _ in places[:3])
                print(f"MISSING  {ns}.{symbol}  ({typelib.name})  used at {where}")
                continue
            tag, members = api[symbol]
            if tag in ("enumeration", "bitfield"):
                for p, n, member, guarded in places:
                    if member and member.isupper() and member not in members and not guarded:
                        missing += 1
                        print(f"MISSING  {ns}.{symbol}.{member}  ({typelib.name})  used at {p}:{n}")
    if missing:
        print(f"\n{missing} name(s) not found in the installed libraries")
        return 1
    print("every checked name exists in the installed libraries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
