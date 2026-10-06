// GDM login screen, in the macOS 27 style. Runs only in GDM's own shell
// (session mode "gdm"), where this extension is loaded once it has been
// installed system-wide (see gdm/install-gdm.sh).
//
//  - the wallpaper of the user, copied to /usr/share/gnomac/login.jpg,
//  - a very large clock and the date at the top,
//  - the user tile re-drawn: a big round avatar with the name below it,
//    in glass (the styling is in stylesheet.css, `.login-dialog-*`),
//  - the session gear (GNOME, Hyprland…) stays where it is.
//
// Authentication, PAM, the session list and the keyboard layout are GDM's:
// this module only changes how they look, and every step is guarded, so a
// failure leaves the stock login screen working.

import Clutter from 'gi://Clutter';
import GDesktopEnums from 'gi://GDesktopEnums';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOP = 0.075;

export class LoginScreen {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._actors = [];
    }

    enable() {
        this._addWallpaper();
        this._addClock();
        this._patchUserList().catch(e => logError(e, 'GNOMAC login screen: user tile'));
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._restoreInit)
            this._restoreInit();
        this._restoreInit = null;
        for (const actor of this._actors)
            actor.destroy();
        this._actors = [];
    }

    // ----------------------------------------------------------- wallpaper

    _addWallpaper() {
        const path = this._settings.get_string('login-wallpaper');
        if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS))
            return;
        try {
            const file = Gio.File.new_for_path(path);
            for (const monitor of Main.layoutManager.monitors) {
                const background = new Meta.Background({meta_display: global.display});
                background.set_file(file, GDesktopEnums.BackgroundStyle.ZOOM);
                const actor = new Meta.BackgroundActor({
                    meta_display: global.display,
                    monitor: monitor.index,
                    background,
                });
                Main.layoutManager._backgroundGroup.add_child(actor);
                Main.layoutManager._backgroundGroup.set_child_above_sibling(actor, null);
                this._actors.push(actor);
            }
        } catch (e) {
            logError(e, 'GNOMAC login screen: wallpaper');
        }
    }

    // --------------------------------------------------------------- clock

    _addClock() {
        const monitor = Main.layoutManager.primaryMonitor;
        this._date = new St.Label({style_class: 'gnomac-login-date', x_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'gnomac-login-time', x_align: Clutter.ActorAlign.CENTER});
        this._clock = new St.BoxLayout({vertical: true, reactive: false,
            x: monitor.x, y: monitor.y + Math.round(monitor.height * TOP), width: monitor.width});
        this._clock.add_child(this._date);
        this._clock.add_child(this._time);
        Main.layoutManager.uiGroup.add_child(this._clock);
        Main.layoutManager.uiGroup.set_child_below_sibling(this._clock, null);
        this._actors.push(this._clock);

        const tick = () => {
            const now = GLib.DateTime.new_now_local();
            this._date.text = now.format('%A %e %B');
            this._time.text = now.format('%R');
            return GLib.SOURCE_CONTINUE;
        };
        tick();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, tick);
    }

    // ------------------------------------------------------------ user tile

    // The stock tile lays the avatar and the name side by side; macOS puts the
    // name under a larger avatar. The widget's orientation is the only thing
    // to change, the rest is CSS.
    async _patchUserList() {
        const {UserListItem} = await import('resource:///org/gnome/shell/gdm/loginDialog.js');
        const original = UserListItem.prototype._init;
        UserListItem.prototype._init = function (...args) {
            original.apply(this, args);
            try {
                const widget = this._userWidget;
                widget.orientation = Clutter.Orientation.VERTICAL;
                widget.x_align = Clutter.ActorAlign.CENTER;
                widget.add_style_class_name('gnomac-login-user');
            } catch (e) {
                logError(e, 'GNOMAC login screen: user widget');
            }
        };
        this._restoreInit = () => {
            UserListItem.prototype._init = original;
        };
    }
}
