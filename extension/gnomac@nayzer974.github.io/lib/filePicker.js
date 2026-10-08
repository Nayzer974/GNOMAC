// Choose files from inside the shell, through the desktop portal
// (org.freedesktop.portal.FileChooser), the same dialog every app uses. The
// shell cannot open a GTK dialog itself; the portal can, and needs nothing
// installed beyond xdg-desktop-portal-gnome (part of GNOME).
//
//   pickFiles({title, multiple}, uris => ...)   uris is [] when cancelled

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

let counter = 0;

export function pickFiles({title = 'Choose files', multiple = true} = {}, callback) {
    const bus = Gio.DBus.session;
    const token = `gnomac${Date.now().toString(36)}${counter++}`;
    const sender = bus.get_unique_name().slice(1).replace(/\./g, '_');
    const requestPath = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
    let id = 0;
    id = bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response',
        requestPath, null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
            bus.signal_unsubscribe(id);
            const [response, results] = params.recursiveUnpack();
            callback(response === 0 ? (results.uris ?? []) : []);
        });
    const options = {
        handle_token: new GLib.Variant('s', token),
        multiple: new GLib.Variant('b', multiple),
    };
    bus.call('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.FileChooser',
        'OpenFile', new GLib.Variant('(ssa{sv})', ['', title, options]), null, Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                conn.call_finish(res);
            } catch (e) {
                bus.signal_unsubscribe(id);
                logError(e, 'GNOMAC file picker');
                callback([]);
            }
        });
}
