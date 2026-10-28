# AGENTS.md — GNOMAC for coding agents

GNOMAC gives GNOME Shell 50+ (Wayland) the look and feel of macOS 27: one GNOME Shell extension (GJS, ES modules) made of independent **modules**, plus a GTK theme, a Plymouth theme and a GDM login screen. Read this file first; it is short on purpose.

The user-facing docs are in **French** (`README.md`, `docs/`, `ARCHITECTURE.md`); code, comments and commit messages are in **English**; UI strings are bilingual through `t('English', 'Français')`.

## Read in this order

1. **`docs/map.json`** (or `docs/MAP.md`): the generated map of everything. Modules with their enabling setting and flags, every `lib/` file with its role and who imports it, every setting with the files that read it, tools, install scripts. **Use it instead of grepping blindly.**
2. **`ARCHITECTURE.md`**: how it works: lifecycle, session modes, start-up and unlock, the shared engine, settings, tests.
3. **`docs/MODIFY.md`**: recipes ("add a setting", "add a module", "add a shortcut", "add a Spotlight action", "add a widget"…) with the exact files.

`docs/MAP.md` and `docs/map.json` are **generated** by `tools/gen-map.py`. Never edit them by hand; run `make map` after changing the structure (a module, an import, a setting, a header comment). `tools/check.sh` fails when they are stale.

## Layout

```
extension/gnomac@nayzer974.github.io/
  extension.js        lifecycle + the MODULES table (one line per module)
  modules/            one file per feature: class with constructor(extension), enable(), disable()
  lib/                shared code: glass material, animations, display layouts, calculators…
  schemas/…xml        every setting (source of truth)      prefs.js   preferences window (GTK, French)
  stylesheet.css      all the CSS (classes start with gnomac-)      whatsnew.json   release notes
theme/ plymouth/ gdm/ install.sh uninstall.sh scripts/    system side
tools/                tests, the smoke test harness, the map generator
```

## Commands

```bash
make check     # static checks + pure tests + installer test + GNOME API name check (tools/check.sh)
make smoke     # a real headless GNOME Shell with this checkout's extension, driven by a script
make map       # regenerate docs/MAP.md and docs/map.json
SMOKE_MONITORS='1920x1080 1280x800' make smoke     # several displays
SMOKE_DRIVER=tools/probes/shortcuts.js tools/smoke-test.sh   # your own scenario (tools/probe-kit.js)
```

The smoke test runs in a **throw-away session** (own D-Bus, own settings, own data directory): the user's real session is untouched. It can take 2–3 minutes; pass a larger limit as the first argument when the machine is busy (`tools/smoke-test.sh 280`).

## Rules of the house

- **Verify every change twice**: `make check` **and** `make smoke`. The first catches what is visible without GNOME; the second catches what only shows at run time (a destroyed object, a signal never disconnected, a dead shortcut).
- **Do not commit, push, deploy or install unless the user asks.** The extension cannot be reloaded on Wayland: the user has to log out and back in to load an installed change.
- **Never rewrite published history** (no force push). Fix a mistake with a new commit.
- **No change without a way to see it fail.** For a bug, reproduce it first (a smoke scenario, a node test), then fix it, then show the same scenario passing. A test that was never seen failing proves nothing.
- Every source file starts with a **header comment** saying what it is for (the map shows it). Keep it true when the file changes.
- **Clean up in `disable()`**: actors, signals (`connect` ids), GLib timers and idle sources, keybindings, D-Bus subscriptions, monkey-patches. The smoke test disables and re-enables every module and fails on the leftovers.
- **Numbers shared by several places go in tokens** (`lib/glassTokens.js`, `lib/motionTokens.js`), not in components. **Pure logic goes in a file with no `gi://` import** so that `node` can test it.
- Style: 4 spaces, single quotes, semicolons; comments say **why**, in English; settings are `kebab-case`; CSS classes start with `gnomac-`; a module is `PascalCase` in a `camelCase.js` file.

## Gotchas learned the hard way (GNOME Shell 51)

- **Modal grabs and action modes decide whether keyboard shortcuts work.** A window that calls `Main.pushModal(…, {actionMode: Shell.ActionMode.POPUP})` makes the shell ignore every shortcut not registered with `POPUP`. A shortcut that opens such a window must also declare `POPUP` (to close it), and info windows should use `NORMAL | POPUP`. After a panel closes, `Main.modalCount` must be 0 (the smoke test checks it).
- **Do not change a `Shell.BlurEffect` after its first frame** (radius, brightness, `enabled`): with two displays the main one turned black. Keep the effect constant and fade a second layer over it (see `LockScreen`: constant frost + `addCrispLayer`).
- **Never call the shell's own D-Bus services synchronously** from inside the shell (`call_sync` on `org.gnome.Mutter.DisplayConfig`): it deadlocks. Use the async `call` (see `lib/display.js`).
- **Pointer events do not reach `global.stage` `captured-event` while the screen is locked.** Poll (`global.display.get_current_monitor()`) instead.
- **Time-based animations are eaten by a stall that happens at their start**: draw the thing once, invisibly, before animating (`prewarmDesktop` in `lib/reveal.js`). The first frame of a glass surface compiles shaders and builds textures (hundreds of milliseconds).
- **API changes in GNOME 51** that bit us: `St.BoxLayout` takes `orientation: Clutter.Orientation.VERTICAL` (no `vertical`); `Clutter.get_default_backend()` is gone (`global.stage.context.get_backend()`); `Shell.GLSLEffect` is gone (`lib/shaderEffect.js`); `St.ThemeContext.scale_factor`. `tools/check-compat.py` reports names the installed libraries do not have.
- **A destroyed actor still has a JS wrapper**: touching it logs "already disposed". Drop references on `destroy`, and guard callbacks that can run after (`if (!this._root) return;`). Do not destroy a button from inside its own `clicked` handler: do it on the next idle.
- **Idle cost must stay near zero.** Measured: about 4 ms of CPU per second and 2 painted frames in 30 s at rest with everything on. Do not add timers faster than one second that run at rest, do not repaint without a reason, throttle pointer-driven work (`lib/throttle.js`), and drive continuous motion from the one shared ticker (`getTicker()` in `lib/spring.js`) rather than a timer or `Clutter.Timeline` of your own (a one-off tween, like the start-up's, is fine if `disable()` stops it).
- **Modules are built in slices at login** (`_start(…, {sliced: true})`): a module's `enable()` must not block for more than a few milliseconds; defer heavy work (decoding a picture, reading a folder) with an idle or an async call.
- `console.log` goes to the journal (`journalctl --user -b | grep GNOMAC`). Use `logError(e, 'GNOMAC …')` for caught errors worth seeing.
- Several other extensions may be loaded next to GNOMAC on the user's machine and may bind the same keys or patch the same shell parts.

## Working from a shell

- In zsh, `$var:ext` is a history modifier: write `${var}:path` (for example `git show "${commit}:path"`).
- Do not run heavy things in parallel on a small machine: the headless shell, a browser and an agent together have run it out of memory. Run one smoke test at a time.
- Screenshots of the headless shell (`GNOMAC_SMOKE_SHOT=dir`) are real renders on the real GPU; a black left half on a two-display screenshot was a real bug, not an artifact.

## Where things are decided (quick index)

| Question | Look at |
|---|---|
| Which modules exist, which run while locked | `MODULES` in `extension.js`, or `docs/map.json` → `modules` |
| What a setting does and who reads it | `docs/map.json` → `settings[].usedIn` |
| How the unlock and start-up animations work | `lib/reveal.js`, `modules/bootShutdown.js`, `modules/lockScreen.js` |
| How the glass is drawn | `lib/glass.js`, `lib/glassTokens.js`, `docs/liquid-glass.md` |
| How animations are timed | `lib/spring.js`, `lib/motionTokens.js`, `docs/motion.md` |
| Multi-display layouts | `lib/displayLayout.js` (pure, tested by `tools/test-display-layout.mjs`) |
| Release notes | `extension/…/whatsnew.json` |
