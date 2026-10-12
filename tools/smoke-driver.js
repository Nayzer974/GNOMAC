// Test driver for tools/smoke-test.sh. It is copied into a throw-away copy of
// the extension and run inside a headless GNOME Shell: it opens and closes
// every panel that has an open/close pair, turns each module off and on again,
// and then reloads everything a few times in a row. Failures are printed with
// the prefix "GNOMAC-SMOKE: FAIL"; the shell log is checked by smoke-test.sh.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// With GNOMAC_SMOKE_SHOT=/some/dir the driver saves screenshots of the
// virtual screen there (the shell runs on the real GPU, only without a monitor).
async function shot(name, log) {
    const dir = GLib.getenv('GNOMAC_SMOKE_SHOT');
    if (!dir)
        return;
    try {
        const file = Gio.File.new_for_path(`${dir}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
        log(`screenshot ${name}`);
    } catch (e) {
        log(`note: screenshot ${name} failed (${e})`);
    }
}

// Longest time the main loop went without running a short timer: a stall
// shows up as a long gap (the frame clock is driven from the same loop).
function gapMeter() {
    let last = GLib.get_monotonic_time();
    let max = 0;
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8, () => {
        const now = GLib.get_monotonic_time();
        max = Math.max(max, (now - last) / 1000);
        last = now;
        return GLib.SOURCE_CONTINUE;
    });
    return {
        stop() {
            GLib.source_remove(id);
            return Math.round(max);
        },
    };
}

const normalWindows = () => global.get_window_actors().map(a => a.meta_window)
    .filter(w => w.get_window_type() === Meta.WindowType.NORMAL);

const PAIRS = [['open', 'close'], ['openPalette', 'closePalette'], ['toggle', 'toggle']];

export async function run(extension) {
    const log = message => console.log(`GNOMAC-SMOKE: ${message}`);
    const procs = [];
    try {
        const names = () => extension._modules.map(m => m.constructor.name);
        log(`modules: ${names().join(', ')}`);

        // 1. Every panel that can be opened and closed.
        for (const module of [...extension._modules]) {
            for (const [open, close] of PAIRS) {
                if (typeof module[open] !== 'function' || typeof module[close] !== 'function')
                    continue;
                try {
                    module[open]();
                    await wait(900);
                    module[close]();
                    await wait(600);
                    log(`${module.constructor.name}.${open}/${close} ok`);
                } catch (e) {
                    log(`FAIL ${module.constructor.name}.${open}: ${e}\n${e.stack ?? ''}`);
                }
                break;
            }
        }

        await shot('1-desktop', log);

        // 1a. Real windows (two terminals), for the window animations.
        try {
            for (let i = 0; i < 2; i++)
                procs.push(Gio.Subprocess.new(['kgx'], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE));
            for (let i = 0; i < 40 && normalWindows().length < 2; i++)
                await wait(250);
            await wait(1500);
            log(`${normalWindows().length} windows opened`);
        } catch (e) {
            log(`note: no test windows (${e})`);
        }
        const windows = normalWindows();
        if (windows.length) {
            await shot('1a-windows', log);
            try {
                const meter = gapMeter();
                windows[0].minimize();
                await wait(1200);
                const minimized = windows[0].minimized;
                windows[0].unminimize();
                await wait(1200);
                log(`minimize ${minimized ? 'ok' : 'FAIL did not minimize'}, restore ${windows[0].minimized ? 'FAIL still minimized' : 'ok'}; longest main-loop gap ${meter.stop()} ms`);

                const meter2 = gapMeter();
                windows[1 % windows.length].maximize(Meta.MaximizeFlags?.BOTH ?? 3);
                await wait(900);
                windows[1 % windows.length].unmaximize(Meta.MaximizeFlags?.BOTH ?? 3);
                await wait(900);
                log(`maximize/unmaximize ok; longest main-loop gap ${meter2.stop()} ms`);

                const {missionControl, enterMissionControl, exitMissionControl} = await import('./lib/missionControl.js');
                const meter3 = gapMeter();
                enterMissionControl();
                await wait(1000);
                const active = missionControl.active;
                await shot('1b-mission-control', log);
                exitMissionControl(null);
                await wait(900);
                log(`mission control ${active ? 'ok' : 'FAIL not active'} with ${windows.length} windows, left (active ${missionControl.active}); longest gap ${meter3.stop()} ms`);
            } catch (e) {
                log(`FAIL window animations: ${e}\n${e.stack ?? ''}`);
            }
        }

        // 1b. The wallpaper picker applies a picture: this decodes it and
        //     hands the pixels to a St.ImageContent.
        const picker = extension.wallpaperPicker;
        if (picker) {
            try {
                picker.open();
                await wait(600);
                picker._goTo(1);
                await wait(500);
                picker._apply();
                await wait(3500);
                try {
                    picker.close();
                } catch {}
                log('wallpaper picker applied a picture');
            } catch (e) {
                log(`FAIL wallpaper picker apply: ${e}\n${e.stack ?? ''}`);
            }
        }

        // 1c. The Apple menu, without and with the item symbols.
        try {
            const settingsNow = extension._settings;
            for (const icons of [false, true]) {
                settingsNow.set_boolean('menu-icons', icons);
                await wait(1500);
                const menu = Main.panel.statusArea['gnomac-system']?.menu;
                menu?.open(false);
                await wait(700);
                await shot(`1c-apple-menu-${icons ? 'icons' : 'plain'}`, log);
                menu?.close(false);
                await wait(300);
                log(`apple menu ${icons ? 'with' : 'without'} symbols opened (${menu ? 'found' : 'MISSING'})`);
                if (!menu)
                    log('FAIL apple menu not found');
            }
            settingsNow.set_boolean('menu-icons', false);
            await wait(1200);
        } catch (e) {
            log(`FAIL apple menu: ${e}\n${e.stack ?? ''}`);
        }

        // 2. A notification source that is destroyed while the panel watches
        //    it, and a dock that GNOME rebuilds, then a reload of everything.
        try {
            const source = new MessageTray.Source({title: 'Smoke test', iconName: 'dialog-information-symbolic'});
            Main.messageTray.add(source);
            source.addNotification(new MessageTray.Notification({source, title: 'Hello', body: 'smoke test'}));
            await wait(1500);
            source.destroy();
            await wait(500);
            log('notification source created and destroyed');
        } catch (e) {
            log(`note: notification source not tested (${e})`);
        }
        try {
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            const favorites = shell.get_strv('favorite-apps');
            shell.set_strv('favorite-apps', favorites.slice(0, 1));
            await wait(1200);
            shell.set_strv('favorite-apps', favorites);
            await wait(1200);
            log(`dock rebuilt (${favorites.length} favourites)`);
        } catch (e) {
            log(`note: dock rebuild not tested (${e})`);
        }
        try {
            // An icon GNOME adds to its dash and destroys again (it does so
            // whenever the favourites or the running apps change).
            const box = Main.overview.dash?._box;
            if (box) {
                const icon = new St.Widget({reactive: true});
                box.add_child(icon);
                await wait(200);
                icon.destroy();
                await wait(300);
                log('dash icon added and destroyed');
            }
        } catch (e) {
            log(`note: dash icon not tested (${e})`);
        }
        extension._reload();
        await wait(1500);
        log(`reload with a destroyed source and a rebuilt dock ok (${names().length} modules)`);

        // 2b. Mission Control: entered and left (there are no windows here).
        try {
            const {missionControl, enterMissionControl, exitMissionControl} = await import('./lib/missionControl.js');
            enterMissionControl();
            await wait(900);
            const wasActive = missionControl.active;
            exitMissionControl(null);
            await wait(700);
            log(`mission control entered (active ${wasActive}) and left (active ${missionControl.active})`);
        } catch (e) {
            log(`FAIL mission control: ${e}\n${e.stack ?? ''}`);
        }

        // 3. Each module switched off and on again (this runs disable()).
        const settings = extension._settings;
        const keys = settings.settings_schema.list_keys()
            .filter(k => k.startsWith('enable-') && settings.settings_schema.get_key(k).get_value_type().dup_string() === 'b');
        for (const key of keys) {
            if (key === 'enable-login-screen')
                continue;
            const before = settings.get_boolean(key);
            settings.set_boolean(key, !before);
            await wait(700);
            settings.set_boolean(key, before);
            await wait(700);
            log(`${key} off/on ok (${names().length} modules running)`);
        }

        // 3b. Opaque glass: the GNOMAC switch and GNOME's high contrast.
        try {
            const {glassParamsFromSettings, clearGlassParams, glassIsOpaque} = await import('./lib/glass.js');
            const check = (label, ok, params) =>
                log(ok ? `${label} ok` : `FAIL ${label}: ${JSON.stringify(params)}`);
            const normal = glassParamsFromSettings(settings, 20);
            check('glass is translucent by default', !glassIsOpaque(settings) && normal.tint[3] < 0.9 && !normal.opaque, normal);
            const spotlight = extension._modules.find(m => m.constructor.name === 'Spotlight');
            spotlight?.open();
            await wait(1200);
            await shot('2-spotlight-glass', log);
            spotlight?.close();
            settings.set_boolean('reduce-transparency', true);
            await wait(1200);
            extension._modules.find(m => m.constructor.name === 'Spotlight')?.open();
            await wait(1200);
            await shot('3-spotlight-opaque', log);
            extension._modules.find(m => m.constructor.name === 'Spotlight')?.close();
            await shot('4-desktop-opaque', log);
            for (const [name, fn] of [['glassParams', glassParamsFromSettings], ['clearGlassParams', clearGlassParams]]) {
                const opaque = fn(settings, 20);
                check(`reduce-transparency: ${name} is opaque`,
                    opaque.opaque && opaque.tint[3] >= 0.95 && opaque.refraction === 0 && opaque.chroma === 0, opaque);
            }
            settings.set_boolean('reduce-transparency', false);
            await wait(1200);
            check('translucent again after reduce-transparency off', !glassIsOpaque(settings), {});

            const a11y = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
            a11y.set_boolean('high-contrast', true);
            await wait(1800);
            check('high contrast makes the glass opaque', glassIsOpaque(settings) && glassParamsFromSettings(settings, 20).opaque, {});
            a11y.set_boolean('high-contrast', false);
            await wait(1800);
            check('translucent again after high contrast off', !glassIsOpaque(settings), {});
            log(`modules running after the opacity checks: ${names().length}`);
        } catch (e) {
            log(`FAIL opacity checks: ${e}\n${e.stack ?? ''}`);
        }

        // 4. Rapid reloads, the way a slider in the preferences causes them.
        for (let i = 0; i < 4; i++) {
            extension._reload();
            await wait(250);
        }
        await wait(1500);
        log(`after reloads: ${names().length} modules running`);

        log('done');
    } catch (e) {
        log(`FAIL driver: ${e}\n${e.stack ?? ''}`);
    }
    try {
        for (const proc of procs)
            proc.force_exit();
    } catch {}
    try {
        global.context.terminate();
    } catch (e) {
        log(`could not stop the shell: ${e}`);
    }
}
