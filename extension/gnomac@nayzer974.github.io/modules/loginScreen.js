// GDM login screen, in the macOS 27 style. Runs only in GDM's own shell
// (session mode "gdm"), where this extension is loaded once it has been
// installed system-wide (see gdm/install-gdm.sh).
//
//  - the wallpaper of the user, copied to /usr/share/gnomac/login.jpg, softly
//    blurred and vignetted, which fades in and settles with a slow zoom,
//  - a very large clock and the date at the top, rising into place,
//  - the user tile re-drawn: a big round avatar with the name below it, and a
//    glass pill for the password (the styling is in stylesheet.css,
//    `.login-dialog-*`),
//  - Sleep / Restart / Shut Down as three glass buttons at the bottom,
//  - the session gear (GNOME, Hyprland…) stays where it is.
//
// Authentication, PAM, the session list and the keyboard layout are GDM's:
// this module only changes how they look, and every step is guarded, so a
// failure leaves the stock login screen working.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getLoginManager} from 'resource:///org/gnome/shell/misc/loginManager.js';

import {t} from '../lib/i18n.js';

const TOP = 0.04;
const CONF = '/etc/gnomac/login.conf';
const USER_CSS = '/etc/gnomac/login.css';

// /etc/gnomac/login.conf (see gdm/login.conf): every key is optional.
function readConf() {
    const out = {clock: 'big', powerButtons: true, dim: 0.8, date: true, wallpaper: null, fade: 1.2,
        avatar: 104, accent: null};
    try {
        const keys = new GLib.KeyFile();
        keys.load_from_file(CONF, GLib.KeyFileFlags.NONE);
        const get = (name, fallback, type = 'string') => {
            try {
                if (type === 'bool')
                    return keys.get_boolean('login', name);
                if (type === 'number')
                    return keys.get_double('login', name);
                return keys.get_string('login', name);
            } catch {
                return fallback;
            }
        };
        out.clock = get('clock', out.clock);
        out.powerButtons = get('power-buttons', out.powerButtons, 'bool');
        out.dim = Math.min(1, Math.max(0.2, get('dim', out.dim, 'number')));
        out.date = get('date', out.date, 'bool');
        out.wallpaper = get('wallpaper', out.wallpaper);
        out.fade = Math.max(0, get('fade', out.fade, 'number'));
        out.avatar = Math.min(160, Math.max(64, get('avatar-size', out.avatar, 'number')));
        const accent = get('accent', out.accent);
        out.accent = /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? accent : null;
    } catch {
        // No file: the defaults.
    }
    return out;
}

function findByName(actor, name) {
    if (actor.get_name?.() === name)
        return actor;
    for (const child of actor.get_children?.() ?? []) {
        const found = findByName(child, name);
        if (found)
            return found;
    }
    return null;
}

export class LoginScreen {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._actors = [];
    }

    enable() {
        console.log('GNOMAC: login screen module enabled in the GDM shell');
        // GDM's theme paints an opaque grey over everything behind the login
        // dialog (#lockDialogGroup): clear it so the wallpaper shows.
        this._groups = [];
        for (const group of [Main.screenShield?._lockDialogGroup, findByName(global.stage, 'lockDialogGroup'),
            Main.layoutManager.screenShieldGroup]) {
            if (group && !this._groups.some(g => g.actor === group)) {
                this._groups.push({actor: group, style: group.get_style()});
                group.set_style('background-color: transparent; background-image: none;');
            }
        }
        this._conf = readConf();
        this._loadStyles();
        this._hidePanelClock();
        this._addWallpaper();
        if (this._conf.clock !== 'none')
            this._addClock();
        if (this._conf.powerButtons)
            this._addPowerButtons();
        this._patchUserList().catch(e => logError(e, 'GNOMAC login screen: user tile'));
    }

    // The conf-driven overrides and the administrator's own CSS, on top of
    // GNOMAC's login styles.
    _loadStyles() {
        this._sheets = [];
        const conf = this._conf;
        const lines = [`.login-dialog .user-icon { icon-size: ${conf.avatar}px; border-radius: ${Math.round(conf.avatar / 2)}px; }`];
        if (conf.clock === 'small') {
            lines.push('.gnomac-login-time { font-size: 40pt; }');
            lines.push('.gnomac-login-date { font-size: 13pt; }');
        }
        if (conf.accent) {
            lines.push(`.login-dialog .login-dialog-prompt-entry:focus, .login-dialog StEntry:focus { border-color: ${conf.accent}; }`);
            lines.push(`.login-dialog .user-icon { border-color: ${conf.accent}; }`);
        }
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        try {
            const generated = GLib.build_filenamev([GLib.get_tmp_dir(), 'gnomac-login-generated.css']);
            GLib.file_set_contents(generated, lines.join(String.fromCharCode(10)));
            const file = Gio.File.new_for_path(generated);
            theme.load_stylesheet(file);
            this._sheets.push(file);
        } catch (e) {
            logError(e, 'GNOMAC login screen: generated styles');
        }
        if (GLib.file_test(USER_CSS, GLib.FileTest.EXISTS)) {
            const file = Gio.File.new_for_path(USER_CSS);
            try {
                theme.load_stylesheet(file);
                this._sheets.push(file);
            } catch (e) {
                logError(e, 'GNOMAC login screen: /etc/gnomac/login.css ignored');
            }
        }
    }

    disable() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        for (const file of this._sheets ?? []) {
            try {
                theme.unload_stylesheet(file);
            } catch {}
        }
        this._sheets = [];
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        for (const {actor, style} of this._groups ?? []) {
            try {
                actor.set_style(style);
            } catch {}
        }
        this._groups = [];
        if (this._dateMenuWasVisible) {
            try {
                Main.panel.statusArea.dateMenu.container.show();
            } catch {}
            this._dateMenuWasVisible = false;
        }
        if (this._restoreInit)
            this._restoreInit();
        this._restoreInit = null;
        for (const actor of this._actors)
            actor.destroy();
        this._actors = [];
    }

    // The panel's own clock would repeat the big one.
    _hidePanelClock() {
        try {
            const container = Main.panel.statusArea.dateMenu?.container;
            if (container?.visible) {
                this._dateMenuWasVisible = true;
                container.hide();
            }
        } catch {}
    }

    // ----------------------------------------------------------- wallpaper

    // The wallpaper is a plain widget with a CSS background image, put at the
    // bottom of the screen shield group: it then sits under the login dialog
    // whatever GDM's theme paints, and needs no Meta.Background (whose actor
    // stayed white or black on GDM's renderer).
    _addWallpaper() {
        const path = this._conf?.wallpaper || this._settings.get_string('login-wallpaper');
        if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) {
            console.log(`GNOMAC: login wallpaper not found: ${path}`);
            return;
        }
        try {
            const parent = Main.layoutManager.screenShieldGroup ?? Main.layoutManager.uiGroup;
            for (const monitor of Main.layoutManager.monitors) {
                const actor = new St.Widget({reactive: false, x: monitor.x, y: monitor.y,
                    width: monitor.width, height: monitor.height, opacity: 0});
                const uri = Gio.File.new_for_path(path).get_uri();
                actor.set_style(`background-color: #101018; background-image: url("${uri}"); ` +
                    'background-size: cover; background-position: center;');
                // Dimmed by a black veil of the opposite strength.
                const veil = new St.Widget({reactive: false, width: monitor.width, height: monitor.height,
                    style: `background-color: rgba(0, 0, 0, ${(1 - this._conf.dim).toFixed(2)});`});
                actor.add_child(veil);
                parent.insert_child_at_index(actor, 0);
                this._actors.push(actor);
                if (this._conf.fade > 0)
                    actor.ease({opacity: 255, duration: Math.round(this._conf.fade * 1000), mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                else
                    actor.opacity = 255;
                console.log(`GNOMAC: login wallpaper placed (${monitor.width}x${monitor.height})`);
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
        this._clock = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, reactive: false,
            x: monitor.x, y: monitor.y + Math.round(monitor.height * TOP), width: monitor.width});
        this._clock.add_child(this._date);
        this._clock.add_child(this._time);
        Main.layoutManager.uiGroup.add_child(this._clock);
        this._actors.push(this._clock);

        const tick = () => {
            const now = GLib.DateTime.new_now_local();
            this._date.text = this._conf.date ? now.format('%A %e %B') : '';
            this._time.text = now.format('%R');
            return GLib.SOURCE_CONTINUE;
        };
        tick();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, tick);

        // It rises into place a moment after the wallpaper.
        this._clock.opacity = 0;
        this._clock.ease({opacity: 255, duration: 900, delay: 300, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    // --------------------------------------------------------- power buttons

    _addPowerButtons() {
        let login = null;
        try {
            login = getLoginManager();
        } catch (e) {
            logError(e, 'GNOMAC login screen: login manager');
            return;
        }
        const monitor = Main.layoutManager.primaryMonitor;
        const row = new St.BoxLayout({style_class: 'gnomac-login-power-row', reactive: true});
        const entries = [
            ['weather-clear-night-symbolic', t('Sleep', 'Veille'), () => login.suspend()],
            ['system-reboot-symbolic', t('Restart', 'Redémarrer'), () => login.reboot()],
            ['system-shutdown-symbolic', t('Shut Down', 'Éteindre'), () => login.powerOff()],
        ];
        for (const [icon, name, action] of entries) {
            const cell = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-login-power-cell',
                x_align: Clutter.ActorAlign.CENTER});
            const button = new St.Button({style_class: 'gnomac-login-power', can_focus: true, reactive: true,
                child: new St.Icon({icon_name: icon, icon_size: 20}), x_align: Clutter.ActorAlign.CENTER});
            button.connect('clicked', () => {
                try {
                    action();
                } catch (e) {
                    logError(e, 'GNOMAC login screen: power action');
                }
            });
            const label = new St.Label({text: name, style_class: 'gnomac-login-power-label', opacity: 0,
                x_align: Clutter.ActorAlign.CENTER});
            button.connect('notify::hover', () => label.ease({opacity: button.hover ? 255 : 0, duration: 160}));
            cell.add_child(button);
            cell.add_child(label);
            row.add_child(cell);
        }
        const holder = new St.Widget({reactive: false, x: monitor.x, y: monitor.y + Math.round(monitor.height * 0.855),
            width: monitor.width, height: 120});
        row.x_align = Clutter.ActorAlign.CENTER;
        row.x_expand = true;
        holder.set_layout_manager(new Clutter.BinLayout());
        holder.add_child(row);
        Main.layoutManager.uiGroup.add_child(holder);
        this._actors.push(holder);
        holder.opacity = 0;
        holder.ease({opacity: 255, duration: 800, delay: 600, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
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
                widget._label.x_align = Clutter.ActorAlign.CENTER;
                widget._label.x_expand = true;
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
