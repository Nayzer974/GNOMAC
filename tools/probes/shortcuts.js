// Example scenario for tools/probe-kit.js: do GNOMAC's keyboard shortcuts work
// while one of its own windows is open? Each shortcut must open its panel, and
// the same shortcut must close it again.
//
//     SMOKE_DRIVER=tools/probes/shortcuts.js tools/smoke-test.sh 90
//
// The test copies this file next to the extension's code, which is why it
// imports './probe-kit.js'. Copy it to start your own scenario.

import Clutter from 'gi://Clutter';

import {findModule, keyboard, log, modalState, openWindow, wait} from './probe-kit.js';

const SUPER = Clutter.KEY_Super_L;
const CTRL = Clutter.KEY_Control_L;

export async function run(extension) {
    try {
        const keys = keyboard();
        await openWindow();        // the palette and Mission Control need a window
        const cases = [
            ['Super+Space  (Spotlight)', [SUPER], Clutter.KEY_space, () => !!findModule(extension, 'Spotlight')?._root?.visible],
            ['Super+Ctrl+D (Displays)', [SUPER, CTRL], Clutter.KEY_d, () => !!findModule(extension, 'Displays')?._root],
            ['Super+W      (Wallpapers)', [SUPER], Clutter.KEY_w, () => !!findModule(extension, 'WallpaperPicker')?._root],
            ['Super+Ctrl+T (Layout palette)', [SUPER, CTRL], Clutter.KEY_t, () => !!findModule(extension, 'WindowLayout')?._palette],
        ];
        for (const [label, modifiers, key, isOpen] of cases) {
            await keys.press(modifiers, key);
            await wait(1000);
            const opened = isOpen();
            await keys.press(modifiers, key);
            await wait(1000);
            const closed = !isOpen();
            log(`${opened && closed ? 'ok  ' : 'FAIL'} ${label}: opens ${opened}, closes again ${closed}`);
        }
        log(`modal state at the end: ${JSON.stringify(modalState())}`);
        log('done');
    } catch (e) {
        log(`FAIL ${e}\n${e.stack ?? ''}`);
    }
}
