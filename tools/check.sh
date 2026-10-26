#!/usr/bin/env bash
# Static checks, the same ones the CI runs. Nothing is installed or changed.
#
#   tools/check.sh
#
# JavaScript syntax, shell syntax (and shellcheck when installed), Python
# syntax, the GSettings schema, the JSON files, and the names used from
# GNOME's libraries (tools/check-compat.py). Exit status 1 if any check fails.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="$ROOT/extension/gnomac@nayzer974.github.io"
cd "$ROOT" || exit 2

failed=0
fail() { echo "  FAIL: $*"; failed=1; }
step() { echo "== $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step "JavaScript syntax"
if command -v node >/dev/null; then
    n=0
    while IFS= read -r -d '' file; do
        # GJS modules are ES modules: check them as .mjs.
        cp "$file" "$TMP/check.mjs"
        node --check "$TMP/check.mjs" 2>"$TMP/err" || { fail "${file#"$ROOT"/}"; head -5 "$TMP/err"; }
        n=$((n + 1))
    done < <(find "$EXT" tools -name '*.js' -print0)
    echo "  $n files"
else
    echo "  node not found, skipped"
fi

step "Shell scripts"
n=0
while IFS= read -r -d '' file; do
    bash -n "$file" 2>"$TMP/err" || { fail "${file#"$ROOT"/}"; head -5 "$TMP/err"; }
    n=$((n + 1))
done < <(find . -name '*.sh' -not -path './.git/*' -not -path './.claude/*' -print0)
echo "  $n files"
if command -v shellcheck >/dev/null; then
    find . -name '*.sh' -not -path './.git/*' -not -path './.claude/*' -print0 \
        | xargs -0 shellcheck -S error || fail "shellcheck"
else
    echo "  shellcheck not found, skipped"
fi

step "Python syntax"
n=0
while IFS= read -r -d '' file; do
    python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$file" 2>"$TMP/err" \
        || { fail "${file#"$ROOT"/}"; head -5 "$TMP/err"; }
    n=$((n + 1))
done < <(find . -name '*.py' -not -path './.git/*' -not -path './.claude/*' -print0)
echo "  $n files"

step "GSettings schema"
if command -v glib-compile-schemas >/dev/null; then
    glib-compile-schemas --strict --dry-run "$EXT/schemas" || fail "schema"
else
    echo "  glib-compile-schemas not found, skipped"
fi

step "JSON files"
for file in "$EXT/metadata.json" "$EXT/whatsnew.json"; do
    python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$file" || fail "${file#"$ROOT"/}"
done

step "Prayer times"
if command -v node >/dev/null; then
    node tools/test-prayer.mjs | tail -1 || fail "tools/test-prayer.mjs"
    node tools/test-prayer.mjs >/dev/null || fail "tools/test-prayer.mjs"
else
    echo "  node not found, skipped"
fi
if [[ "${CHECK_GJS:-1}" != 1 ]]; then
    echo "  schedule test skipped (CHECK_GJS=0)"
elif command -v gjs >/dev/null; then
    TZ=Europe/Paris gjs -m tools/test-prayer-schedule.js | tail -1
    TZ=Europe/Paris gjs -m tools/test-prayer-schedule.js >/dev/null || fail "tools/test-prayer-schedule.js"
else
    echo "  gjs not found, schedule test skipped"
fi

step "Island logic, display layouts, weather switch, covers"
if command -v node >/dev/null; then
    node tools/test-island-logic.mjs >/dev/null || fail "tools/test-island-logic.mjs"
    node tools/test-throttle.mjs >/dev/null || fail "tools/test-throttle.mjs"
    node tools/test-display-layout.mjs >/dev/null || fail "tools/test-display-layout.mjs"
    node tools/test-island-logic.mjs | tail -1
fi
if [[ "${CHECK_GJS:-1}" == 1 ]] && command -v gjs >/dev/null; then
    for t in test-island-logic test-weather test-cover; do
        gjs -m "tools/$t.js" >"$TMP/$t.log" 2>&1 || { fail "tools/$t.js"; tail -8 "$TMP/$t.log"; continue; }
        echo "  $t: $(tail -n 1 "$TMP/$t.log")"
    done
else
    echo "  gjs tests skipped"
fi

step "Installer and login screen sync (isolated home)"
if [[ "${CHECK_GJS:-1}" == 1 ]]; then
    tools/test-install.sh >"$TMP/install.log" 2>&1 || { fail "tools/test-install.sh"; grep FAIL "$TMP/install.log"; }
    tail -n 1 "$TMP/install.log"
else
    echo "  skipped (CHECK_GJS=0)"
fi

step "Names used from GNOME's libraries"
if [[ "${CHECK_COMPAT:-1}" != 1 ]]; then
    echo "  skipped (CHECK_COMPAT=0)"
elif command -v g-ir-generate >/dev/null; then
    python3 tools/check-compat.py || fail "check-compat"
else
    echo "  g-ir-generate not found, skipped"
fi

echo
if (( failed )); then
    echo "CHECKS FAILED"
    exit 1
fi
echo "all checks passed"
