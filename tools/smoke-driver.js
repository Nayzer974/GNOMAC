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
import {getTicker as getTickerForTest} from './lib/spring.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {readConfig as readPrayerConfigForTest} from './lib/prayerSchedule.js';
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

        // 1d. The Prayers tab of the island and its alerts (off by default).
        try {
            const findIsland = () => extension._modules.find(m => m.constructor.name === 'DynamicIsland');
            const cfg = extension._settings;
            const off = findIsland()?.island?.tabButtons.find(([id]) => id === 'prayer')?.[1].visible;
            log(off === false ? 'prayers tab hidden while the feature is off ok' : 'FAIL prayers tab visible while the feature is off');
            cfg.set_double('prayer-latitude', 48.8566);
            cfg.set_double('prayer-longitude', 2.3522);
            cfg.set_string('prayer-city', 'Paris');
            cfg.set_boolean('island-notifications', true);
            cfg.set_boolean('prayer-enabled', true);
            await wait(1800);
            let isl = findIsland();
            const tab = isl.island.tabButtons.find(([id]) => id === 'prayer')?.[1];
            log(tab?.visible ? 'prayers tab shown once the feature is on ok' : 'FAIL prayers tab hidden although the feature is on');
            isl._keepTab = true;
            isl._tab = 'prayer';
            isl._pinned = true;
            isl._update();
            await wait(1800);
            const view = isl.island.prayerView;
            log(`prayers page: next ${view.nextName.text} ${view.nextTime.text} ${view.until.text}; ` +
                `times ${Object.values(view.cells).map(c => c.time.text).join(' ')}; ${view.hijri.text}; ${view.place.text}`);
            if (!view.body.visible || view.nextTime.text === '' || Object.values(view.cells).some(c => c.time.text === '' || c.time.text === '--:--'))
                log('FAIL prayers page is empty');
            else
                log('prayers page filled ok');
            await shot('1d-prayers-tab', log);

            // An alert becomes a notification; with island-notifications on, the island shows it.
            const now = GLib.DateTime.new_now_local();
            isl._pinned = false;
            isl._hoverOpen = false;
            isl._update();
            await wait(900);
            isl._onPrayerAlert({key: 'asr', at: now, kind: 'now'});
            await wait(1500);
            log(isl._mode === 'notice' && isl.island.noticeTitle.text !== ''
                ? `prayer alert shown by the island ok: "${isl.island.noticeTitle.text}" / "${isl.island.noticeBody.text}"`
                : `FAIL prayer alert not shown by the island (mode ${isl._mode})`);
            await shot('1d-prayer-alert', log);
            await wait(6500);
            isl._onPrayerAlert({key: 'maghrib', at: now, kind: 'before'});
            await wait(1200);
            log(isl.island.noticeTitle.text.includes('10') || isl.island.noticeTitle.text !== ''
                ? `prayer reminder shown ok: "${isl.island.noticeTitle.text}"`
                : 'FAIL prayer reminder not shown');
            await wait(6500);

            // No city chosen: a hint instead of the times.
            cfg.set_double('prayer-latitude', 0);
            cfg.set_double('prayer-longitude', 0);
            isl._keepTab = true;
            isl._tab = 'prayer';
            isl._pinned = true;
            isl._update();
            await wait(1500);
            view.update(readPrayerConfigForTest(cfg));
            log(view.empty.visible && !view.body.visible ? 'prayers page without a city shows the hint ok' : 'FAIL prayers page without a city does not show the hint');
            await shot('1d-prayers-empty', log);
            isl._pinned = false;
            isl._update();
            cfg.set_boolean('prayer-enabled', false);
            await wait(1800);
            const gone = findIsland()?.island?.tabButtons.find(([id]) => id === 'prayer')?.[1].visible;
            log(gone === false ? 'prayers tab hidden again when turned off ok' : 'FAIL prayers tab still visible after turning the feature off');
            cfg.set_boolean('island-notifications', false);
            await wait(1500);
        } catch (e) {
            log(`FAIL prayers: ${e}\n${e.stack ?? ''}`);
        }

        // 1g. The island's live events: queue, click, track change, battery,
        //     Bluetooth, the wheel.
        try {
            const cfg = extension._settings;
            cfg.set_int('island-notice-seconds', 1);
            await wait(1800);
            const isl = extension._modules.find(m => m.constructor.name === 'DynamicIsland');
            // The machine's real battery events must not mix with the test's own.
            if (isl._powerSub) {
                Gio.DBus.system.signal_unsubscribe(isl._powerSub);
                isl._powerSub = 0;
            }
            const title = () => isl.island.noticeTitle.text;
            const ok = (label, cond, detail = '') => log(cond ? `${label} ok` : `FAIL ${label} ${detail}`);

            // Notifications queue up instead of replacing each other.
            isl._showNotice({title: 'One', body: '1'});
            await wait(150);
            isl._showNotice({title: 'Two', body: '2'});
            isl._showNotice({title: 'Three', body: '3'});
            ok('queued notifications wait behind the first', isl._noticeQueue.length === 2 && title() === 'One' &&
                isl.island.noticeMore.visible && isl.island.noticeMore.text === '+2',
                `queue ${isl._noticeQueue.length} title ${title()} more "${isl.island.noticeMore.text}"`);
            await wait(500);
            await shot('1g-notice-queue', log);
            const seen = [title()];
            for (let i = 0; i < 40; i++) {
                await wait(150);
                if (title() !== seen[seen.length - 1])
                    seen.push(title());
            }
            ok('they are shown in order, one after the other', seen.join('>') === 'One>Two>Three', seen.join('>'));
            for (let i = 0; i < 9; i++)
                isl._showNotice({title: `n${i}`, body: ''});
            ok('the queue holds at most five', isl._noticeQueue.length <= 5, `${isl._noticeQueue.length}`);
            isl._noticeQueue = [];
            isl._noticeUntil = 0;
            await wait(1500);

            // A click opens what the notification is about.
            let activated = false;
            isl._showNotice({title: 'Click me', body: '', activate() { activated = true; }});
            await wait(300);
            const opened = isl._openNotice();
            ok('clicking a notification activates it and closes the card', opened && activated && isl._noticeUntil === 0,
                `opened ${opened} activated ${activated}`);
            isl._showNotice({title: 'Plain', body: ''});
            await wait(300);
            ok('a plain notice has nothing to open', isl._openNotice() === false);
            isl._noticeUntil = 0;
            await wait(1200);

            // A new track shows a card.
            const player = {busName: 'org.mpris.MediaPlayer2.smoke', identity: 'Smoke player', title: 'First song',
                artists: ['Artist'], album: '', artUrl: '', length: 0, status: 'Playing', hasMedia: true,
                desktopEntry: null, canGoNext: true, canGoPrevious: true, canSeek: true,
                fetchPosition: async () => 0, raise: async () => false};
            isl._player = player;
            isl._lastTrack = null;
            isl._checkTrack(player);
            player.title = 'Second song';
            isl._checkTrack(player);
            await wait(1250);
            ok('a new track shows its card', title() === 'Second song' && isl.island.noticeBody.text === 'Artist',
                `title "${title()}" body "${isl.island.noticeBody.text}"`);
            player.status = 'Paused';
            player.title = 'Third song';
            isl._noticeUntil = 0;
            await wait(1300);
            isl._checkTrack(player);
            await wait(1400);
            ok('a paused player announces nothing', title() !== 'Third song', title());
            isl._player = null;

            // Battery and Bluetooth.
            isl._battery = null;
            isl._batteryEvent(50, false);
            ok('the first battery reading only sets the reference', isl._mode !== 'notice' || title() !== 'En charge');
            isl._noticeUntil = 0;
            await wait(1200);
            isl._batteryEvent(50, true);
            await wait(300);
            ok('plugging in shows "charging"', /charg/i.test(title()), title());
            isl._noticeUntil = 0;
            await wait(1200);
            isl._batteryEvent(25, false);
            isl._noticeUntil = 0;
            await wait(1200);
            isl._batteryEvent(19, false);
            await wait(300);
            ok('dropping under 20 % warns', /faible|low/i.test(title()) && isl.island.noticeBody.text.includes('19'),
                `${title()} / ${isl.island.noticeBody.text}`);
            isl._noticeUntil = 0;
            await wait(1200);
            isl._batteryEvent(9, false);
            await wait(300);
            ok('dropping under 10 % warns louder', /presque|very/i.test(title()), title());
            isl._noticeUntil = 0;
            await wait(1200);
            isl._onBluetoothDevice({name: 'AirPods Pro', icon: 'audio-headphones', battery: 80});
            await wait(300);
            await shot('1g-bluetooth', log);
            ok('a Bluetooth device shows its name and battery', title() === 'AirPods Pro' && isl.island.noticeBody.text.includes('80'),
                `${title()} / ${isl.island.noticeBody.text}`);
            await isl._bluetoothConnected('/org/bluez/hci0/dev_missing');
            ok('an unknown Bluetooth device is ignored quietly', true);
            isl._noticeUntil = 0;
            await wait(1200);

            // The wheel turns the pages.
            isl._pinned = true;
            isl._update();
            await wait(1200);
            const before = isl._tab;
            isl._stepTab(1);
            await wait(400);
            const after = isl._tab;
            isl._stepTab(-1);
            await wait(400);
            ok('stepping tabs moves forward and back', before !== after && isl._tab === before, `${before} ${after} ${isl._tab}`);
            isl._pinned = false;
            isl._update();
            cfg.reset('island-notice-seconds');
            await wait(1800);
        } catch (e) {
            log(`FAIL island live events: ${e}\n${e.stack ?? ''}`);
        }

        // 1h. Fixes for reported issues: benchmarks stop when their module is
        //     switched off, and the login screen patch leaves nothing behind.
        try {
            const ctl = await import('./lib/benchControl.js');
            const {glassPerformance} = await import('./lib/glassPerformance.js');
            const {missionControl} = await import('./lib/missionControl.js');
            const bench = await import('./lib/glassBench.js');
            const motion = await import('./lib/motionBench.js');
            const cfg = extension._settings;
            const ok = (label, cond, detail = '') => log(cond ? `${label} ok` : `FAIL ${label} ${detail}`);
            const children = () => Main.layoutManager.uiGroup.get_n_children();
            const before = children();

            const run = bench.runGlassBench(extension);
            await wait(1500);
            ok('a glass benchmark has timers while it runs', ctl.pendingBenchTimers() > 0 && glassPerformance.benchmarking,
                `${ctl.pendingBenchTimers()} ${glassPerformance.benchmarking}`);
            cfg.set_boolean('enable-spotlight', false);   // switching the module off cancels it
            await wait(1200);
            const result = await Promise.race([run, wait(5000).then(() => 'still running')]);
            ok('switching Spotlight off stops the glass benchmark', result === null && ctl.pendingBenchTimers() === 0 &&
                !glassPerformance.benchmarking, `result ${result}, timers ${ctl.pendingBenchTimers()}, benchmarking ${glassPerformance.benchmarking}`);
            cfg.set_boolean('enable-spotlight', true);
            await wait(1500);
            ok('and the benchmark left none of its widgets behind', children() <= before + 1, `${before} -> ${children()}`);

            if (normalWindows().length >= 2) {
                const running = motion.runMotionBench(extension);
                await wait(1200);
                ctl.cancelBenchmarks();
                const motionResult = await Promise.race([running, wait(5000).then(() => 'still running')]);
                await wait(800);
                ok('cancelling the motion benchmark stops it and restores the windows', motionResult === null &&
                    ctl.pendingBenchTimers() === 0 && !glassPerformance.benchmarking && !missionControl.active &&
                    normalWindows().every(w => !w.minimized), `result ${motionResult}`);
            }

            // The login screen patch: switched off while the import loads.
            const {LoginScreen} = await import('./modules/loginScreen.js');
            const {UserListItem} = await import('resource:///org/gnome/shell/gdm/loginDialog.js');
            const original = UserListItem.prototype._init;
            const early = new LoginScreen(extension);
            const loading = early._patchUserList();
            early._patchToken = null;   // what disable() does
            await loading;
            ok('a patch switched off while loading changes nothing', UserListItem.prototype._init === original);
            const one = new LoginScreen(extension);
            await one._patchUserList();
            const two = new LoginScreen(extension);
            await two._patchUserList();
            ok('patching twice wraps the real function once', UserListItem.prototype._init._gnomacOriginal === original);
            two._restoreInit();
            one._restoreInit();
            ok('undoing both gives the original function back', UserListItem.prototype._init === original);
        } catch (e) {
            log(`FAIL issue fixes: ${e}\n${e.stack ?? ''}`);
        }

        // 1i. Lock and unlock: the desktop stays built (nothing to rebuild at
        //     the unlock), its chrome is under the lock screen while locked and
        //     back in order afterwards, and the unlock animation runs.
        try {
            const cfg = extension._settings;
            const shield = Main.screenShield;
            const ui = Main.layoutManager.uiGroup;
            const find = name => extension._modules.find(m => m.constructor.name === name);
            const ok = (label, cond, detail = '') => log(cond ? `${label} ok` : `FAIL ${label} ${detail}`);
            const keepNames = ['Dock', 'DynamicIsland', 'Widgets', 'DesktopIcons', 'Spotlight', 'Launchpad'];
            const panelNames = ['TopBar', 'AppMenus', 'MenuBarIcons'];
            const before = Object.fromEntries([...keepNames, ...panelNames].map(n => [n, find(n)]));
            const order = () => ui.get_children().filter(a => (a.name ?? '').startsWith('gnomac')).map(a => a.name);
            const orderBefore = order().join(',');
            const reloadTimes = [];
            const origReload = extension._reload.bind(extension);
            extension._reload = () => {
                const t0 = GLib.get_monotonic_time();
                origReload();
                reloadTimes.push(Math.round((GLib.get_monotonic_time() - t0) / 1000));
            };

            for (const how of ['lock', 'suspend']) {
                shield.lock(how === 'lock' ? false : true);
                if (how === 'suspend') {
                    shield._prepareForSleep(null, true);
                    shield._prepareForSleep(null, false);
                }
                await wait(2200);
                shield._wakeUpScreen();
                await wait(600);
                const shieldIndex = ui.get_children().indexOf(Main.layoutManager.screenShieldGroup);
                const above = ui.get_children().slice(shieldIndex + 1)
                    .filter(a => a.visible && a.opacity > 0 && a.width > 0 && a !== Main.layoutManager.panelBox && a.constructor.name !== 'Lightbox');
                ok(`${how}: nothing of GNOMAC is drawn above the lock screen`, above.length === 0,
                    above.map(a => `${a.name || a.constructor.name}(${a.width}x${a.height})`).join(', '));
                ok(`${how}: the desktop modules stay built`, keepNames.every(n => find(n) === before[n] && before[n]),
                    keepNames.filter(n => find(n) !== before[n]).join());
                ok(`${how}: the panel modules are stopped`, panelNames.every(n => !find(n)), panelNames.filter(n => find(n)).join());

                reloadTimes.length = 0;
                shield.deactivate(false);
                await wait(120);
                ok(`${how}: the unlock animation starts`, !!shield._gnomacUnlocking);
                for (let i = 0; i < 80 && (shield._gnomacUnlocking || shield.actor.visible); i++)
                    await wait(50);
                await wait(800);
                ok(`${how}: unlocking rebuilds only the panel modules (${reloadTimes.join(', ')} ms)`,
                    keepNames.every(n => find(n) === before[n]) && panelNames.every(n => find(n)) && reloadTimes[0] < 120,
                    `${keepNames.filter(n => find(n) !== before[n]).join()} ${reloadTimes}`);
                ok(`${how}: the chrome is back in its order`, order().join(',') === orderBefore, `${orderBefore} -> ${order().join(',')}`);
                ok(`${how}: back on the desktop`, !shield.locked && Main.sessionMode.currentMode === 'user');
                await wait(800);
            }
            extension._reload = origReload;
        } catch (e) {
            log(`FAIL lock cycle: ${e}\n${e.stack ?? ''}`);
        }

        // 1j. GNOME keeps destroyed "settings" menu items in its lists and writes
        //     to them at every lock (hundreds of warnings in the journal): the
        //     guard must make them leave the list when they are destroyed.
        try {
            const source = new St.Widget();
            Main.layoutManager.uiGroup.add_child(source);
            const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
            const kept = menu.addSettingsAction('Settings kept', 'org.gnome.Settings.desktop');
            const gone = menu.addSettingsAction('Settings destroyed', 'org.gnome.Characters.desktop');
            gone.destroy();
            const left = Object.keys(menu._settingsActions);
            log(left.length === 1 && menu._settingsActions['org.gnome.Settings.desktop'] === kept
                ? 'a destroyed settings item leaves the menu list ok'
                : `FAIL a destroyed settings item stays in the menu list: ${left.join()}`);
            // The same, when the item dies with its parent (C-side destruction).
            const other = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
            other.addSettingsAction('Doomed', 'org.gnome.Calculator.desktop');
            other.box.destroy_all_children();
            log(Object.keys(other._settingsActions).length === 0
                ? 'an item destroyed with its parent leaves the list too ok'
                : `FAIL an item destroyed with its parent stays: ${Object.keys(other._settingsActions).join()}`);
            // The session mode changes (what every lock does): no warning may follow.
            Main.sessionMode.pushMode('unlock-dialog');
            await wait(300);
            Main.sessionMode.popMode('unlock-dialog');
            await wait(600);
            menu.destroy();
            other.destroy();
            source.destroy();
            log('session mode change with menus around ok');
        } catch (e) {
            log(`FAIL menu guard: ${e}\n${e.stack ?? ''}`);
        }

        // 1k. The Launchpad: how long it takes to open, that it ends full screen
        //     and settled, that pages are built when they come within reach,
        //     that typing is debounced, and that closing leaves nothing behind.
        try {
            const lp = extension._modules.find(m => m.constructor.name === 'Launchpad');
            const monitor = Main.layoutManager.primaryMonitor;
            const ok = (label, cond, detail = '') => log(cond ? `${label} ok` : `FAIL ${label} ${detail}`);
            const meter = gapMeter();
            const t0 = GLib.get_monotonic_time();
            lp.open();
            const openMs = Math.round((GLib.get_monotonic_time() - t0) / 1000);
            await wait(900);
            const gap = meter.stop();
            const apps = lp._results?.length ?? lp._tiles.length;
            log(`launchpad: open() took ${openMs} ms, longest main-loop gap while opening ${gap} ms, ${apps} apps, ${lp._tiles.length} tiles built`);
            ok('launchpad ends full screen', lp._root.width === monitor.width && lp._root.height === monitor.height &&
                lp._root.scale_x === 1 && lp._root.scale_y === 1, `${lp._root.width}x${lp._root.height} scale ${lp._root.scale_x}`);
            ok('launchpad ends opaque and unzoomed', lp._root.opacity === 255 && Math.abs(lp._viewport.scale_x - 1) < 0.001,
                `opacity ${lp._root.opacity} zoom ${lp._viewport.scale_x}`);
            if (lp._built) {
                ok('only the pages in reach are built', lp._built.size <= 2 || lp._pageCount <= 3, `${[...lp._built]}`);
                if (lp._pageCount > 3) {
                    lp._goTo(lp._pageCount - 1);
                    ok('paging builds the pages ahead', lp._built.has(lp._pageCount - 1) && lp._built.has(lp._pageCount - 2));
                    lp._goTo(0);
                }
            }
            const before = lp._tiles.length;
            if (lp._pageCount > 1)
                lp._goTo(0);
            lp._entry.text = 'zzz-no-such-app';
            await wait(40);
            ok('typing does not rebuild the grid at once', lp._tiles.length === before, `${before} -> ${lp._tiles.length}`);
            await wait(400);
            ok('the grid follows once typing pauses', lp._tiles.length === 0, `${lp._tiles.length}`);
            lp._entry.text = '';
            await wait(100);
            ok('clearing the search brings every app back at once', lp._results.length === apps && lp._tiles.length === Math.min(apps, 2 * 35),
                `${lp._results.length}/${apps} apps, ${lp._tiles.length} tiles`);
            const callbacks = () => getTickerForTest()._callbacks.size;
            lp.close();
            await wait(500);
            ok('closing destroys the Launchpad', lp._root === null && !Main.layoutManager.uiGroup.get_children().some(a => a.name === 'gnomacLaunchpad'));
            ok('and leaves no timer or ticker callback', !lp._fillId && callbacks() < 6, `${callbacks()}`);
            lp.open();
            lp.close(false);
            ok('open then close at once is clean', lp._root === null);
        } catch (e) {
            log(`FAIL launchpad: ${e}\n${e.stack ?? ''}`);
        }

        // 1l. Optimizations: the dock publishes its geometry once after a burst of
        //     settles, the pointer glow can be stopped, and the island reads the
        //     prayer settings only while the feature is on.
        try {
            const ok = (label, cond, detail = '') => log(cond ? `${label} ok` : `FAIL ${label} ${detail}`);
            const dock = extension._modules.find(m => m.constructor.name === 'Dock');
            let calls = 0;
            const original = dock._publishIconGeometry.bind(dock);
            dock._publishIconGeometry = () => {
                calls++;
                original();
            };
            for (let i = 0; i < 20; i++)
                dock._publishSoon();
            await wait(50);
            ok('the dock waits before publishing its geometry', calls === 0, String(calls));
            await wait(250);
            ok('and publishes it once after a burst of settles', calls === 1, String(calls));
            dock._publishIconGeometry = original;
            const stop = dock._glass.followPointer(new St.Widget());
            ok('followPointer hands back a way to stop', typeof stop === 'function');
            stop();

            const island = extension._modules.find(m => m.constructor.name === 'DynamicIsland');
            let reads = 0;
            const getDouble = island._settings.get_double.bind(island._settings);
            island._settings.get_double = key => {
                if (key.startsWith('prayer-'))
                    reads++;
                return getDouble(key);
            };
            await wait(2600);
            ok('the island does not read the prayer settings while the feature is off', reads === 0, String(reads));
            island._settings.get_double = getDouble;
        } catch (e) {
            log(`FAIL optimizations: ${e}\n${e.stack ?? ''}`);
        }

        // 1m. Start-up: the modules were built between frames, the wallpaper
        //     reading came from a thread and is cached for the next login.
        try {
            const ok = (label, cond, detail = '') => log(cond ? `${label} ok` : `FAIL ${label} ${detail}`);
            const {adaptive} = await import('./lib/adaptive.js');
            ok('the start-up finished building the modules', extension._startToken === null && extension._modules.length >= 20,
                `${extension._modules.length} modules`);
            const cacheFile = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomac', 'adaptive.json']);
            const hasWallpaper = !!adaptive._wallpaper?.();
            if (hasWallpaper) {
                ok('the wallpaper was read', !!adaptive._thumb);
                ok('and the reading was saved for the next login', GLib.file_test(cacheFile, GLib.FileTest.EXISTS));
                const luminance = adaptive.luminance;
                adaptive.stop();
                adaptive._thumb = null;
                adaptive.luminance = 0.123;
                const t0 = GLib.get_monotonic_time();
                adaptive.start();
                const ms = (GLib.get_monotonic_time() - t0) / 1000;
                ok(`a known wallpaper is not decoded again (start() took ${ms.toFixed(1)} ms)`, !!adaptive._thumb && Math.abs(adaptive.luminance - luminance) < 0.01 && ms < 30,
                    `${ms} ms, luminance ${adaptive.luminance} vs ${luminance}`);
            } else {
                log('note: no wallpaper file in this session, wallpaper reading not tested');
            }
        } catch (e) {
            log(`FAIL start-up checks: ${e}\n${e.stack ?? ''}`);
        }

        // 1e. The preferences window opens (it runs in its own process, so a
        //     typing mistake in prefs.js only shows when it is opened).
        try {
            await new Promise((resolve, reject) => Gio.DBus.session.call('org.gnome.Shell.Extensions',
                '/org/gnome/Shell/Extensions', 'org.gnome.Shell.Extensions', 'LaunchExtensionPrefs',
                new GLib.Variant('(s)', ['gnomac@nayzer974.github.io']), null, Gio.DBusCallFlags.NONE, 5000, null,
                (conn, res) => {
                    try {
                        conn.call_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }));
            let prefsWindow = null;
            for (let i = 0; i < 40 && !prefsWindow; i++) {
                await wait(250);
                prefsWindow = global.get_window_actors().map(a => a.meta_window)
                    .find(w => /extensions|gnomac/i.test(`${w.get_wm_class() ?? ''} ${w.get_title() ?? ''}`) &&
                        w.get_wm_class() !== 'kgx' && w.get_wm_class() !== 'org.gnome.Console');
            }
            await wait(1500);
            log(prefsWindow ? `preferences window opened ok (${prefsWindow.get_wm_class()} "${prefsWindow.get_title()}")`
                : 'FAIL preferences window did not open');
            await shot('1e-preferences', log);
            prefsWindow?.delete(global.get_current_time());
            await wait(800);
        } catch (e) {
            log(`FAIL preferences launch: ${e}`);
        }

        // 1f. The prayer preferences, built and driven in a window of their own.
        try {
            const proc = Gio.Subprocess.new(['gjs', '-m', `${extension.path}/prefs-smoke.js`, extension.path],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
            const output = new Promise(resolve => proc.communicate_utf8_async(null, null, (p2, res) => {
                try {
                    resolve(p2.communicate_utf8_finish(res)[1] ?? '');
                } catch (e) {
                    resolve(`FAIL reading the prefs test: ${e}`);
                }
            }));
            await wait(3800);
            await shot('1f-prayer-prefs-top', log);
            await wait(5500);
            await shot('1f-prayer-prefs-bottom', log);
            const text = await output;
            for (const line of text.split('\n')) {
                if (line.startsWith('GNOMAC-PREFS:'))
                    log(line.replace('GNOMAC-PREFS:', 'prefs:').replace('prefs: FAIL', 'FAIL prefs:'));
                else if (/CRITICAL|Error|error:|TypeError|ReferenceError/.test(line) && !/a11y|atspi|dconf|portal/i.test(line))
                    log(`FAIL prefs process: ${line.slice(0, 200)}`);
            }
        } catch (e) {
            log(`FAIL prefs smoke: ${e}`);
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

        // 3a. Displays: Spotlight offers the multi-display actions only when there
        //     are several displays, and they change the layout for real.
        try {
            const {displayInfo} = await import('./lib/display.js');
            await new Promise(resolve => displayInfo.refresh(resolve));
            const spotlight = extension._modules.find(m => m.constructor.name === 'Spotlight');
            const displayRows = () => spotlight._actionResults('', true).map(r => r.title)
                .filter(title => /Main Display|Mirror Displays|Extend Displays|Turn (Off|On) “|principal|Dupliquer|Étendre|Éteindre «|Allumer «/.test(title));
            const several = (displayInfo.state?.displays.length ?? 0) > 1;
            const rows = displayRows();
            if (!several) {
                log(rows.length === 0 ? 'displays: one display, Spotlight offers no display action ok' : `FAIL displays: one display but ${rows.join(', ')}`);
            } else {
                log(rows.length >= 3 ? `displays: ${rows.length} actions offered (${rows.join(' | ')}) ok` : `FAIL displays: only ${rows.join(', ')}`);
                const other = displayInfo.state.displays.find(d => d.enabled && !d.primary);
                const main = displayInfo.state.displays.find(d => d.primary);
                await displayInfo.apply('primary', other.connector);
                await wait(1500);
                await new Promise(resolve => displayInfo.refresh(resolve));
                const swapped = displayInfo.state.displays.find(d => d.connector === other.connector)?.primary;
                await displayInfo.apply('primary', main.connector);
                await wait(1500);
                await new Promise(resolve => displayInfo.refresh(resolve));
                const back = displayInfo.state.displays.find(d => d.connector === main.connector)?.primary;
                log(swapped && back ? 'displays: the main display can be changed and changed back ok' : `FAIL displays: swapped ${swapped}, back ${back}`);
                let refused = null;
                try {
                    await displayInfo.apply('off', 'no-such-display');
                } catch (e) {
                    refused = e.message;
                }
                log(refused ? 'displays: an unknown display is refused ok' : 'FAIL displays: an unknown display was accepted');
            }
        } catch (e) {
            log(`FAIL displays: ${e}\n${e.stack ?? ''}`);
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
