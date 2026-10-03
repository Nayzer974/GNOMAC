// Session actions for the system menu and Spotlight.
//
// GNOME's SystemActions hides some actions on purpose: "Log Out" is only
// "available" with several users or sessions, and calling it otherwise
// throws. macOS always offers them, so we fall back to GNOME's session
// manager, which shows the usual end-session confirmation dialog.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

function call(bus, name, path, iface, method, args = null) {
    bus.call(name, path, iface, method, args, null, Gio.DBusCallFlags.NONE, -1, null,
        (connection, result) => {
            try {
                connection.call_finish(result);
            } catch (e) {
                logError(e, `GNOMAC: ${iface}.${method}`);
            }
        });
}

function sessionManager(method, args = null) {
    Main.overview.hide();
    call(Gio.DBus.session, 'org.gnome.SessionManager', '/org/gnome/SessionManager',
        'org.gnome.SessionManager', method, args);
}

function tryAction(available, activate, fallback) {
    const actions = SystemActions.getDefault();
    if (actions[available]) {
        try {
            actions[activate]();
            return;
        } catch (e) {
            logError(e, `GNOMAC: ${activate}`);
        }
    }
    fallback();
}

// Mode 0 asks for confirmation, like the macOS "Log Out…" item.
export function logOut() {
    tryAction('canLogout', 'activateLogout', () => sessionManager('Logout', new GLib.Variant('(u)', [0])));
}

export function restart() {
    tryAction('canRestart', 'activateRestart', () => sessionManager('Reboot'));
}

export function powerOff() {
    tryAction('canPowerOff', 'activatePowerOff', () => sessionManager('Shutdown'));
}

export function suspend() {
    tryAction('canSuspend', 'activateSuspend', () => call(Gio.DBus.system,
        'org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager',
        'Suspend', new GLib.Variant('(b)', [true])));
}

export function lockScreen() {
    tryAction('canLockScreen', 'activateLockScreen', () => Main.screenShield.lock(true));
}
