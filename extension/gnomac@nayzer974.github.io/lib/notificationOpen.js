// Clicking a notification must open what it is about.
//
// GNOME does it by finding the application of the notification's source: from
// its desktop entry, or the window of the process that sent it. When that
// fails (Electron and Flatpak apps, browsers, an app that sends no desktop
// entry) the click only dismisses the notification and nothing opens.
//
// Here every activation of a notification (the banner, the Notification Center,
// the lock screen, GNOME's own date menu: they all end in
// `Notification.activate()`) is followed by a check. If, a moment later, no
// window has taken the focus and the focused window is not the application's,
// the application is found by other means (its name, the windows' classes, the
// desktop entries) and brought forward: its latest window, or a new launch when
// it has none. When GNOME's own way worked, nothing more is done.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const CHECK_MS = 450;

let installs = 0;
let original = null;
const timers = new Set();

const normalise = text => (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// The application a notification's source stands for, as well as can be told.
export function appForSource(source, notification = null) {
    if (source?.app)
        return source.app;
    const apps = Shell.AppSystem.get_default();
    const entry = notification?.desktopEntry ?? source?.desktopEntry ?? source?._desktopEntry;
    if (entry) {
        const app = apps.lookup_app(`${entry}.desktop`) ?? apps.lookup_app(entry);
        if (app)
            return app;
    }
    const name = normalise(source?.title);
    if (!name)
        return null;

    // A running application whose name, id or window class says the same.
    for (const app of apps.get_running()) {
        const names = [app.get_name(), app.get_id()?.replace(/\.desktop$/, '')];
        for (const window of app.get_windows())
            names.push(window.get_wm_class(), window.get_gtk_application_id());
        if (names.some(candidate => candidate && normalise(candidate) === name))
            return app;
    }
    // An installed one (to launch it).
    try {
        for (const group of Gio.DesktopAppInfo.search(source.title)) {
            for (const id of group) {
                const app = apps.lookup_app(id);
                if (app && normalise(app.get_name()) === name)
                    return app;
            }
        }
    } catch {}
    return null;
}

// Brings the application forward: its most recently used window (one asking
// for attention first), or the application itself when it has none.
export function bringForward(app) {
    const windows = app.get_windows();
    if (!windows.length) {
        app.activate();
        return;
    }
    const wanted = windows.find(window => window.demands_attention || window.urgent) ??
        [...windows].sort((a, b) => b.get_user_time() - a.get_user_time())[0];
    Main.activateWindow(wanted);
}

// Called a moment after the notification's own activation.
function verify(snapshot) {
    const focus = global.display.focus_window;
    const tracker = Shell.WindowTracker.get_default();
    const app = appForSource(snapshot.source, snapshot.notification) ?? snapshot.app;
    // Something took the focus (what the notification opened): done.
    if (focus && focus !== snapshot.before && !focus.skip_taskbar)
        return;
    // The application already has the focus: done.
    if (app && focus && tracker.get_window_app(focus) === app)
        return;
    if (app)
        bringForward(app);
}

// Makes every `Notification.activate()` check itself. Counted: the banner
// module and the Notification Center both ask, the last one to leave restores.
export function installOpenFallback() {
    if (installs++ > 0)
        return;
    const proto = MessageTray.Notification.prototype;
    original = proto.activate;
    proto.activate = function (...args) {
        // What is needed is taken now: activating usually destroys the notification.
        const snapshot = {
            source: this.source ?? null,
            notification: {title: this.title, desktopEntry: this.desktopEntry},
            app: this.source?.app ?? null,
            before: global.display.focus_window,
        };
        const result = original.apply(this, args);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_MS, () => {
            timers.delete(id);
            try {
                verify(snapshot);
            } catch (e) {
                logError(e, 'GNOMAC notifications: opening');
            }
            return GLib.SOURCE_REMOVE;
        });
        timers.add(id);
        return result;
    };
}

export function removeOpenFallback() {
    if (installs === 0 || --installs > 0)
        return;
    if (original)
        MessageTray.Notification.prototype.activate = original;
    original = null;
    for (const id of timers)
        GLib.source_remove(id);
    timers.clear();
}
