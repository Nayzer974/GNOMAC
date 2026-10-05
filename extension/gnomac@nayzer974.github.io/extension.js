// GNOMAC — macOS 27 (Golden Gate) feel for GNOME Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppMenus} from './modules/appMenus.js';
import {Dock} from './modules/dock.js';
import {DynamicIsland} from './modules/dynamicIsland.js';
import {Gaps} from './modules/gaps.js';
import {GlassMenus} from './modules/glassMenus.js';
import {Launchpad} from './modules/launchpad.js';
import {MenuBarIcons} from './modules/menuBarIcons.js';
import {LockScreen} from './modules/lockScreen.js';
import {Notifications} from './modules/notifications.js';
import {Spotlight} from './modules/spotlight.js';
import {TopBar} from './modules/topbar.js';
import {Vibrancy} from './modules/vibrancy.js';
import {WallpaperPicker} from './modules/wallpaperPicker.js';
import {WindowAnimations} from './modules/windowAnimations.js';
import {destroyTicker} from './lib/spring.js';

// Only modules flagged `locked` run while the screen is locked: the
// extension stays loaded in the unlock-dialog session mode for the lock
// screen, and everything else is stopped until the session is unlocked.
const MODULES = [
    {key: 'enable-lock-screen', Module: LockScreen, locked: true},
    {key: 'enable-launchpad', Module: Launchpad},
    {key: 'enable-topbar', Module: TopBar},
    {key: 'enable-app-menus', Module: AppMenus},
    {key: 'enable-dock', Module: Dock},
    {key: 'enable-dock', Module: Gaps},
    {key: 'enable-spotlight', Module: Spotlight},
    {key: 'enable-glass-menus', Module: GlassMenus},
    {key: 'enable-window-animations', Module: WindowAnimations},
    {key: 'enable-dynamic-island', Module: DynamicIsland},
    {key: 'enable-notifications', Module: Notifications},
    {key: 'enable-vibrancy', Module: Vibrancy},
    {key: 'enable-wallpaper-picker', Module: WallpaperPicker},
    {key: 'enable-menubar-icons', Module: MenuBarIcons},
];

export default class GnomacExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._modules = [];
        // GNOME opens the overview while it starts the session; macOS lands
        // on the desktop. Animations are only forced after that startup
        // animation: lifting the inhibition in the middle of it left the
        // overview frozen half-way in VMs.
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                Main.overview.hide();
                this._forceAnimations();
            });
        }
        this._start();
        // Any change rebuilds the modules; debounce so dragging a slider in
        // the preferences does not rebuild on every step.
        // Runtime state (Pomodoro timings, reminders) is read live by its
        // module: changing it must not rebuild the whole shell UI.
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key.startsWith('pomodoro-') || key === 'widget-reminders')
                return;
            this._scheduleReload();
        });
        this._sessionId = Main.sessionMode.connect('updated', () => this._reload());
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        this._settings.disconnect(this._settingsId);
        Main.sessionMode.disconnect(this._sessionId);
        this._stop();
        destroyTicker();
        this._settings = null;
    }

    _start() {
        this._forceAnimations();
        const locked = Main.sessionMode.isLocked;
        for (const {key, Module, locked: allowedLocked} of MODULES) {
            if (!this._settings.get_boolean(key) || (locked && !allowedLocked))
                continue;
            const module = new Module(this);
            try {
                module.enable();
                this._modules.push(module);
            } catch (e) {
                logError(e, `GNOMAC: cannot enable ${key}`);
                try {
                    module.disable();
                } catch {}
            }
        }
    }

    _stop() {
        for (const module of this._modules.reverse()) {
            try {
                module.disable();
            } catch (e) {
                logError(e, 'GNOMAC: error while disabling a module');
            }
        }
        this._modules = [];
        this._releaseAnimations();
    }

    // GNOME inhibits animations with software rendering (VMs without 3D).
    // When asked, lift that inhibition — but only if the user's own
    // "enable-animations" preference is on, and only once.
    _forceAnimations() {
        if (this._startupId || this._uninhibited)
            return;
        const st = St.Settings.get();
        const wanted = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_boolean('enable-animations');
        if (this._settings.get_boolean('force-animations') && wanted && !st.enable_animations) {
            st.uninhibit_animations();
            this._uninhibited = true;
        }
    }

    _releaseAnimations() {
        if (this._uninhibited) {
            St.Settings.get().inhibit_animations();
            this._uninhibited = false;
        }
    }

    // Locking and unlocking switch the set of running modules right away.
    _reload() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        this._stop();
        this._start();
    }

    _scheduleReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._reloadId = 0;
            this._stop();
            this._start();
            return GLib.SOURCE_REMOVE;
        });
    }
}
