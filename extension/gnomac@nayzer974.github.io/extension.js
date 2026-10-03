// GNOMAC — macOS 27 (Golden Gate) feel for GNOME Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Dock} from './modules/dock.js';
import {DynamicIsland} from './modules/dynamicIsland.js';
import {GlassMenus} from './modules/glassMenus.js';
import {Launchpad} from './modules/launchpad.js';
import {Notifications} from './modules/notifications.js';
import {Spotlight} from './modules/spotlight.js';
import {TopBar} from './modules/topbar.js';
import {WindowAnimations} from './modules/windowAnimations.js';
import {destroyTicker} from './lib/spring.js';

const MODULES = [
    {key: 'enable-launchpad', Module: Launchpad},
    {key: 'enable-topbar', Module: TopBar},
    {key: 'enable-dock', Module: Dock},
    {key: 'enable-spotlight', Module: Spotlight},
    {key: 'enable-glass-menus', Module: GlassMenus},
    {key: 'enable-window-animations', Module: WindowAnimations},
    {key: 'enable-dynamic-island', Module: DynamicIsland},
    {key: 'enable-notifications', Module: Notifications},
];

export default class GnomacExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._modules = [];
        this._start();
        // Any change rebuilds the modules; debounce so dragging a slider in
        // the preferences does not rebuild on every step.
        this._settingsId = this._settings.connect('changed', () => this._scheduleReload());
    }

    disable() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        this._settings.disconnect(this._settingsId);
        this._stop();
        destroyTicker();
        this._settings = null;
    }

    _start() {
        this._forceAnimations();
        for (const {key, Module} of MODULES) {
            if (!this._settings.get_boolean(key))
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
