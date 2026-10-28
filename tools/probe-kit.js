// Helpers for writing your own scenario for the headless GNOME Shell of
// tools/smoke-test.sh: wait, log, screenshots, a virtual keyboard and pointer,
// a real window, and a look at the modal grab that decides whether the shell's
// keyboard shortcuts work at all.
//
// A scenario is a file that exports `run(extension)`; start it with
//
//     SMOKE_DRIVER=tools/probes/shortcuts.js tools/smoke-test.sh
//
// (see tools/probes/shortcuts.js, and docs/MODIFY.md "Essayer quelque chose
// dans un shell de test"). It runs inside the shell, 8 s after the extension is
// enabled, so everything of GNOME Shell is available: `Main`, `global`, St...
// Lines logged with `log()` are printed by the test; the scenario must end with
// `log('done')`, or the test reports that it did not finish.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const log = message => console.log(`GNOMAC-SMOKE: ${message}`);

export const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// The extension's modules by class name: findModule(extension, 'Spotlight').
export const findModule = (extension, name) => extension._modules.find(m => m.constructor.name === name);

// A screenshot of the whole virtual screen, saved as DIR/name.png when the test
// runs with GNOMAC_SMOKE_SHOT=DIR (nothing otherwise).
export async function shot(name) {
    const dir = GLib.getenv('GNOMAC_SMOKE_SHOT');
    if (!dir)
        return;
    const stream = Gio.File.new_for_path(`${dir}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
    log(`screenshot ${name}`);
}

// A keyboard the shell takes for a real one: keyboard().press([Clutter.KEY_Super_L], Clutter.KEY_space).
// The shell's shortcuts (Main.wm.addKeybinding) react to it like to your fingers.
export function keyboard() {
    const seat = global.stage.context.get_backend().get_default_seat();
    const device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const send = (key, state) => device.notify_keyval(GLib.get_monotonic_time(), key, state);
    return {
        async press(modifiers, key, hold = 50) {
            for (const modifier of modifiers) {
                send(modifier, Clutter.KeyState.PRESSED);
                await wait(20);
            }
            send(key, Clutter.KeyState.PRESSED);
            await wait(hold);
            send(key, Clutter.KeyState.RELEASED);
            await wait(20);
            for (const modifier of [...modifiers].reverse()) {
                send(modifier, Clutter.KeyState.RELEASED);
                await wait(20);
            }
        },
    };
}

// A pointer: pointer().moveTo(x, y) in stage coordinates (the left display starts at 0, 0).
export function pointer() {
    const seat = global.stage.context.get_backend().get_default_seat();
    const device = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    return {
        async moveTo(x, y) {
            device.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            await wait(250);
            // A second, nearby move: the shell updates the pointer's display on motion.
            device.notify_absolute_motion(GLib.get_monotonic_time(), x + 3, y + 3);
            await wait(250);
        },
    };
}

export const normalWindows = () => global.get_window_actors().map(a => a.meta_window)
    .filter(w => w.get_window_type() === Meta.WindowType.NORMAL);

// Opens a real application window (a terminal by default) and waits for it.
export async function openWindow(command = ['kgx']) {
    const process = Gio.Subprocess.new(command, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    for (let i = 0; i < 80 && normalWindows().length === 0; i++)
        await wait(250);
    await wait(1500);
    normalWindows()[0]?.activate(global.get_current_time());
    await wait(500);
    return process;
}

// What holds the keyboard: the number of modal grabs and the action mode. The
// shell ignores every keyboard shortcut whose action mode is not the current
// one (Shell.ActionMode.NORMAL = 1, POPUP = 128): a window that keeps a grab
// after it is closed makes all the shortcuts dead.
export function modalState() {
    return {modalCount: Main.modalCount, actionMode: Main.actionMode, overview: Main.overview.visible};
}
