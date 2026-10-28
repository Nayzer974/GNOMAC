#!/usr/bin/env python3
"""Builds the map of GNOMAC from the code itself: docs/MAP.md (for people) and
docs/map.json (for programs and AI agents).

Nothing in the map is written by hand: module list and flags come from
extension.js, descriptions from the header comment of each file, settings from
the GSettings schema, "who uses what" from the imports and from the keys read in
the code. Because it is generated, it cannot drift from the code:
`tools/check.sh` runs `gen-map.py --check` and fails when the two files are
stale.

    python3 tools/gen-map.py            write docs/MAP.md and docs/map.json
    python3 tools/gen-map.py --check    exit 1 if they are not up to date
    make map                            same as the first line
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / 'extension' / 'gnomac@nayzer974.github.io'
OUT_MD = ROOT / 'docs' / 'MAP.md'
OUT_JSON = ROOT / 'docs' / 'map.json'

rel = lambda p: str(Path(p).relative_to(ROOT))
read = lambda p: Path(p).read_text(encoding='utf-8')


# ---------------------------------------------------------------- helpers

def header(path):
    """What a file says about itself at the top: the module docstring of a
    Python file, else the first block of '//' or '#' comments. A line made only
    of dashes or equals signs, a shebang and 'set -e' style lines are skipped."""
    text = read(path)
    if str(path).endswith('.css'):
        block = re.match(r'\s*/\*(.*?)\*/', text, re.S)
        if block:
            body = re.sub(r'^\s*\*? ?', '', block.group(1), flags=re.M)
            return re.sub(r'\s+', ' ', body.split('\n\n')[0]).strip()
        return ''
    doc = re.match(r'\s*(?:#![^\n]*\n)?\s*(?:"""|\'\'\')(.*?)(?:"""|\'\'\')', text, re.S)
    if doc and str(path).endswith('.py'):
        paragraph = doc.group(1).strip().split('\n\n')[0]
        return re.sub(r'\s+', ' ', paragraph).strip()
    out = []
    for line in text.splitlines()[:60]:
        s = line.strip()
        if s.startswith('#!'):
            continue
        m = re.match(r'^(//|#)\s?(.*)$', s)
        if m:
            body = m.group(2).strip()
            if re.fullmatch(r'[-=_ ]{3,}', body):
                continue
            if body == '' and out:
                break
            if body:
                out.append(body)
        elif out:
            break
    return re.sub(r'\s+', ' ', ' '.join(out)).strip()


def short(text, n=230):
    """The first sentence (or the first n characters) of a description."""
    m = re.match(r'(.{40,%d}?\.)(\s|$)' % n, text)
    if m:
        return m.group(1)
    return text if len(text) <= n else text[:n].rsplit(' ', 1)[0] + '…'


def imports_of(path):
    """Local imports of a JS file: [(relative path)]."""
    found = []
    for m in re.finditer(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)""", read(path)):
        target = (Path(path).parent / (m.group(1) or m.group(2))).resolve()
        if target.exists():
            found.append(rel(target))
    return sorted(set(found))


def exports_of(path):
    names = re.findall(r'^export\s+(?:default\s+)?(?:async\s+)?(?:class|function\*?|const|let)\s+([A-Za-z_$][\w$]*)', read(path), re.M)
    return sorted(set(names))


def is_pure(path):
    """No GNOME library at all: it can run under plain node, outside the shell."""
    return not re.search(r"""from\s+['"](gi://|resource://)""", read(path))


SETTER_RE = re.compile(r"""(?:get|set)_(?:boolean|int|string|double|strv|value|enum|uint)\(\s*['"]([a-z0-9-]+)['"]""")
CHANGED_RE = re.compile(r"""changed::([a-z0-9-]+)""")


def settings_used(path, schema_keys):
    text = read(path)
    used = set(SETTER_RE.findall(text)) | set(CHANGED_RE.findall(text))
    # Keys held in constants or lists: any known key name written as a string.
    for key in schema_keys:
        if re.search(r"""['"`]%s['"`]""" % re.escape(key), text):
            used.add(key)
    return sorted(k for k in used if k in schema_keys)


def shortcuts_of(path, schema):
    text = read(path)
    consts = dict(re.findall(r"""const\s+([A-Z_]+)\s*=\s*['"]([a-z0-9-]+-shortcut)['"]""", text))
    keys = set(re.findall(r"""addKeybinding\(\s*['"]([a-z0-9-]+)['"]""", text))
    for name in re.findall(r"""addKeybinding\(\s*([A-Z_]+)\b""", text):
        if name in consts:
            keys.add(consts[name])
    # keybindings declared in a table and bound in a loop
    for key in re.findall(r"""['"]([a-z0-9-]+-shortcut)['"]""", text):
        if key in schema:
            keys.add(key)
    return sorted(k for k in keys if k in schema)


def registered_name(path):
    """`this._extension.foo = this` : how other modules reach this one."""
    return sorted(set(re.findall(r'this\._extension\.([A-Za-z]+)\s*=\s*this', read(path))))


# ------------------------------------------------------------------ schema

def parse_schema():
    schema_file = next((EXT / 'schemas').glob('*.gschema.xml'))
    text = read(schema_file)
    keys = {}
    for m in re.finditer(r'<key\s+name="([^"]+)"\s+type="([^"]+)"[^>]*>(.*?)</key>', text, re.S):
        name, typ, body = m.groups()
        default = re.search(r'<default>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</default>', body, re.S)
        summary = re.search(r'<summary>(.*?)</summary>', body, re.S)
        keys[name] = {
            'type': typ,
            'default': (default.group(1).strip() if default else ''),
            'summary': (summary.group(1).strip() if summary else ''),
        }
    return schema_file, keys


def key_group(name):
    if name.endswith('-shortcut'):
        return 'shortcuts'
    return name.split('-')[0] if name.split('-')[0] in (
        'enable', 'island', 'prayer', 'dock', 'glass', 'theme', 'boot', 'widgets', 'widget', 'desktop',
        'pomodoro', 'update', 'weather', 'menu', 'panel', 'window', 'stage', 'whatsnew', 'spotlight',
        'launchpad', 'clipboard', 'adaptive', 'reduce') else 'other'


# ----------------------------------------------------------------- modules

def parse_modules(schema):
    """The MODULES table of extension.js."""
    text = read(EXT / 'extension.js')
    imports = {}
    for m in re.finditer(r"import\s+\{([^}]+)\}\s+from\s+'(\./[^']+)'", text):
        for name in (n.strip() for n in m.group(1).split(',')):
            imports[name] = rel((EXT / m.group(2)).resolve())
    table = re.search(r'const MODULES = \[(.*?)\n\];', text, re.S).group(1)
    modules = []
    for line in table.splitlines():
        m = re.search(r"\{key:\s*'([^']+)',\s*Module:\s*(\w+)(?:,\s*([^}]*))?\}", line)
        if not m:
            continue
        key, cls, flags = m.groups()
        flags = dict(re.findall(r'(\w+):\s*(true|false)', flags or ''))
        modules.append({
            'class': cls,
            'file': imports[cls],
            'setting': key,
            'keepAlive': flags.get('keepAlive') == 'true',
            'runsWhileLocked': flags.get('locked') == 'true',
            'greeterOnly': flags.get('greeter') == 'true',
        })
    schema_keys = set(schema)
    for mod in modules:
        path = ROOT / mod['file']
        mod['description'] = header(path)
        mod['imports'] = [i for i in imports_of(path)]
        mod['settings'] = settings_used(path, schema_keys)
        mod['shortcuts'] = shortcuts_of(path, schema)
        mod['reachableAs'] = registered_name(path)
    return modules


# --------------------------------------------------------------------- lib

def parse_libs(schema):
    files = sorted((EXT / 'lib').glob('*.js'))
    infos = {}
    for f in files:
        infos[rel(f)] = {
            'file': rel(f),
            'description': header(f),
            'exports': exports_of(f),
            'pure': is_pure(f),
            'imports': imports_of(f),
            'settings': settings_used(f, set(schema)),
        }
    # who imports whom
    importers = {k: set() for k in infos}
    sources = sorted((EXT / 'modules').glob('*.js')) + [EXT / 'extension.js', EXT / 'prefs.js'] + files
    for src in sources:
        for target in imports_of(src):
            if target in importers and rel(src) != target:
                importers[target].add(rel(src))
    for k, v in infos.items():
        v['usedBy'] = sorted(importers[k])
    return list(infos.values())


# --------------------------------------------------------------------- css

def parse_css():
    """The sections of the stylesheet, by title (no line numbers: they change with
    every edit and would make the map stale; `grep -n` finds a title at once)."""
    path = EXT / 'stylesheet.css'
    titles = []
    for line in read(path).splitlines():
        m = re.match(r'^/\*\s*-{3,}\s*(.+?)\s*-{3,}\s*\*/\s*$', line)
        if m:
            titles.append(m.group(1))
    return {'file': rel(path), 'sections': titles}


# ------------------------------------------------------------- the rest

def first_line(path):
    h = header(path)
    return short(h, 200) if h else ''


def parse_tools():
    out = []
    for f in sorted((ROOT / 'tools').iterdir()):
        if f.is_file() and f.suffix in ('.sh', '.py', '.js', '.mjs'):
            out.append({'file': rel(f), 'description': first_line(f)})
    return out


def parse_install():
    out = []
    for name in ['install.sh', 'uninstall.sh', 'get.sh', 'ez-install.sh', 'Makefile',
                 'scripts/state.py', 'scripts/update.sh',
                 'gdm/install-gdm.sh', 'gdm/sync-login.sh', 'gdm/sync-units.sh', 'gdm/login.css', 'gdm/login.conf',
                 '.github/workflows/ci.yml']:
        p = ROOT / name
        if p.exists():
            out.append({'file': name, 'description': first_line(p)})
    for d in ['theme/gtk-3.0', 'theme/gtk-4.0', 'plymouth/gnomac']:
        p = ROOT / d
        if p.exists():
            out.append({'file': d + '/', 'description': ', '.join(sorted(x.name for x in p.iterdir()))})
    return out


def parse_docs():
    out = []
    for f in sorted((ROOT / 'docs').glob('*.md')):
        if f.name == 'MAP.md':
            continue
        title = next((l.lstrip('# ').strip() for l in read(f).splitlines() if l.startswith('# ')), f.name)
        out.append({'file': rel(f), 'title': title})
    for name in ['README.md', 'ARCHITECTURE.md', 'AGENTS.md']:
        p = ROOT / name
        if p.exists():
            title = next((l.lstrip('# ').strip() for l in read(p).splitlines() if l.startswith('# ')), name)
            out.insert(0, {'file': name, 'title': re.sub(r'<[^>]+>', '', title) or name})
    return out


# ------------------------------------------------------------------ output

def build():
    schema_file, schema = parse_schema()
    modules = parse_modules(schema)
    libs = parse_libs(schema)
    keys = []
    all_js = [EXT / 'extension.js', EXT / 'prefs.js'] + sorted((EXT / 'modules').glob('*.js')) + sorted((EXT / 'lib').glob('*.js'))
    texts = {rel(f): read(f) for f in all_js}
    for name, info in schema.items():
        used = sorted(f for f, t in texts.items() if re.search(r"""['"`]%s['"`]""" % re.escape(name), t))
        keys.append({'name': name, 'group': key_group(name), **info, 'usedIn': used})
    return {
        'about': 'Generated by tools/gen-map.py from the code. Do not edit by hand: run `make map`.',
        'entryPoints': {
            'extension': rel(EXT / 'extension.js'),
            'preferences': rel(EXT / 'prefs.js'),
            'schema': rel(schema_file),
            'stylesheet': rel(EXT / 'stylesheet.css'),
            'releaseNotes': rel(EXT / 'whatsnew.json'),
        },
        'modules': modules,
        'lib': libs,
        'settings': keys,
        'css': parse_css(),
        'tools': parse_tools(),
        'installAndSystem': parse_install(),
        'docs': parse_docs(),
    }


def md_escape(text):
    return text.replace('|', '\\|')


def link(path, label=None):
    return f'[`{label or path.split("/")[-1]}`](../{path})'


def render(data):
    L = []
    w = L.append
    w('# Carte de GNOMAC')
    w('')
    w('> **Fichier généré** par `tools/gen-map.py` à partir du code : ne le modifie pas à la main, lance `make map`.')
    w('> `tools/check.sh` échoue si cette carte n\'est pas à jour. La version lisible par un programme est '
      '[`map.json`](map.json). Les descriptions viennent des commentaires d\'en-tête de chaque fichier (en anglais).')
    w('')
    w('Pour comprendre **comment ça marche** : [`ARCHITECTURE.md`](../ARCHITECTURE.md). Pour **modifier** quelque chose : '
      '[`docs/MODIFY.md`](MODIFY.md). Pour un agent IA : [`AGENTS.md`](../AGENTS.md).')
    w('')
    w('## Sommaire')
    w('')
    for t, a in [('Points d\'entrée', 'points-dentrée'), ('Modules (ce que l\'utilisateur voit)', 'modules'),
                 ('Bibliothèques (`lib/`)', 'bibliothèques-lib'), ('Réglages', 'réglages'),
                 ('Feuille de style', 'feuille-de-style'), ('Outils et tests', 'outils-et-tests'),
                 ('Installation, système, CI', 'installation-système-ci'), ('Documentation', 'documentation')]:
        w(f'- [{t}](#{a})')
    w('')

    w('## Points d\'entrée')
    w('')
    ep = data['entryPoints']
    w('| Quoi | Fichier |')
    w('|---|---|')
    for label, key in [('L\'extension (cycle de vie, liste des modules)', 'extension'), ('La fenêtre de préférences', 'preferences'),
                       ('Le schéma des réglages (GSettings)', 'schema'), ('Tout le CSS', 'stylesheet'),
                       ('Les notes de version (fenêtre « Nouveautés »)', 'releaseNotes')]:
        w(f'| {label} | {link(ep[key], ep[key].replace("extension/gnomac@nayzer974.github.io/", ""))} |')
    w('')

    w('## Modules')
    w('')
    w('Un module = une fonctionnalité visible, avec `enable()` et `disable()`, créé par `extension.js`. '
      '**Interrupteur** : le réglage GSettings qui l\'active. **Reste construit pendant le verrouillage** (`keepAlive`) : il n\'est pas '
      'reconstruit au déverrouillage. **Tourne verrouillé** : il fonctionne même écran verrouillé. '
      '**Atteint via** : le nom sous lequel les autres modules le trouvent (`extension.<nom>`).')
    w('')
    w('| Module | Fichier | Interrupteur | Reste construit | Atteint via | Raccourcis |')
    w('|---|---|---|:-:|---|---|')
    for m in data['modules']:
        flags = '✓' if m['keepAlive'] else ''
        if m['runsWhileLocked']:
            flags = 'tourne verrouillé'
        if m['greeterOnly']:
            flags = 'écran de connexion seulement'
        reach = ', '.join(f'`extension.{n}`' for n in m['reachableAs'])
        keys = ', '.join(f'`{k}`' for k in m['shortcuts'])
        w(f'| **{m["class"]}** | {link(m["file"])} | `{m["setting"]}` | {flags} | {reach} | {keys} |')
    w('')
    w('### Ce que fait chaque module')
    w('')
    for m in data['modules']:
        w(f'#### {m["class"]}')
        w('')
        w(f'{md_escape(short(m["description"], 420))}')
        w('')
        uses_lib = [i for i in m['imports'] if '/lib/' in i]
        details = []
        if uses_lib:
            details.append('**Utilise** ' + ', '.join(f'`{i.split("/")[-1]}`' for i in uses_lib))
        if m['settings']:
            details.append('**Réglages lus** ' + ', '.join(f'`{k}`' for k in m['settings']))
        if details:
            w('- ' + '\n- '.join(details))
            w('')

    w('## Bibliothèques (`lib/`)')
    w('')
    w('Code partagé. **Pur** = n\'utilise aucune bibliothèque GNOME : il se teste avec `node`, hors du shell. '
      '**Utilisé par** : les fichiers qui l\'importent.')
    w('')
    w('| Fichier | Pur | Rôle | Utilisé par |')
    w('|---|:-:|---|---|')
    for lib in data['lib']:
        users = ', '.join(f'`{u.split("/")[-1]}`' for u in lib['usedBy'][:6]) + (' …' if len(lib['usedBy']) > 6 else '')
        w(f'| {link(lib["file"])} | {"✓" if lib["pure"] else ""} | {md_escape(short(lib["description"], 170))} | {users} |')
    w('')

    w('## Réglages')
    w('')
    w('Tous les réglages de l\'extension (`org.gnome.shell.extensions.gnomac`). **Lu dans** : les fichiers où la clé apparaît.')
    w('Changer un réglage reconstruit les modules, sauf les clés listées dans `extension.js` (`_settings.connect(\'changed\'…)`).')
    w('')
    groups = {}
    for k in data['settings']:
        groups.setdefault(k['group'], []).append(k)
    order = ['enable', 'shortcuts'] + sorted(g for g in groups if g not in ('enable', 'shortcuts', 'other')) + ['other']
    titles = {'enable': 'Interrupteurs des modules', 'shortcuts': 'Raccourcis clavier', 'other': 'Autres'}
    for g in order:
        if g not in groups:
            continue
        w(f'### {titles.get(g, g.capitalize())}')
        w('')
        w('| Clé | Type | Défaut | Rôle | Lu dans |')
        w('|---|---|---|---|---|')
        for k in groups[g]:
            used = ', '.join(f'`{u.split("/")[-1]}`' for u in k['usedIn'][:4]) + (' …' if len(k['usedIn']) > 4 else '')
            default = k['default'] if len(k['default']) <= 40 else k['default'][:37] + '…'
            w(f'| `{k["name"]}` | `{k["type"]}` | `{md_escape(default)}` | {md_escape(k["summary"])} | {used} |')
        w('')

    unread = [k for k in data['settings'] if not k['usedIn']]
    if unread:
        w('### Déclarés mais jamais lus')
        w('')
        w('Ces clés sont dans le schéma mais aucun fichier ne les lit : du code mort, à supprimer ou à brancher.')
        w('')
        for k in unread:
            w(f'- `{k["name"]}` : {k["summary"]}')
        w('')

    w('## Feuille de style')
    w('')
    css = data['css']
    w(f'{link(css["file"], "stylesheet.css")} : un seul fichier, découpé en sections (`grep -n "/\\* ------" stylesheet.css` donne les lignes) :')
    w('')
    for title in css['sections']:
        w(f'- {title}')
    w('')
    w('Les classes de GNOMAC commencent par `gnomac-`. L\'utilisateur peut aussi restyler sans toucher au code : '
      '[`docs/THEMING.md`](THEMING.md).')
    w('')

    w('## Outils et tests')
    w('')
    w('| Fichier | Rôle |')
    w('|---|---|')
    for t in data['tools']:
        w(f'| {link(t["file"])} | {md_escape(t["description"])} |')
    w('')

    w('## Installation, système, CI')
    w('')
    w('| Fichier | Rôle |')
    w('|---|---|')
    for t in data['installAndSystem']:
        w(f'| `{t["file"]}` | {md_escape(t["description"])} |')
    w('')

    w('## Documentation')
    w('')
    for d in data['docs']:
        w(f'- [{d["title"]}](../{d["file"]}) — `{d["file"]}`')
    w('')
    return '\n'.join(L)


def main():
    check = '--check' in sys.argv
    data = build()
    md = render(data) + '\n'
    js = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if check:
        stale = [p.name for p, new in ((OUT_MD, md), (OUT_JSON, js)) if not p.exists() or read(p) != new]
        if stale:
            print(f'the map is out of date ({", ".join(stale)}): run `make map` and commit the result', file=sys.stderr)
            return 1
        print('the map is up to date')
        return 0
    OUT_MD.write_text(md, encoding='utf-8')
    OUT_JSON.write_text(js, encoding='utf-8')
    print(f'wrote {rel(OUT_MD)} ({len(md.splitlines())} lines) and {rel(OUT_JSON)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
