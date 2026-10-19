// GNOMAC — macOS 27 (Golden Gate) feel for GNOME Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppMenus} from './modules/appMenus.js';
import {Appearance} from './modules/appearance.js';
import {BootShutdown} from './modules/bootShutdown.js';
import {DesktopIcons} from './modules/desktopIcons.js';
import {Dock} from './modules/dock.js';
import {DynamicIsland} from './modules/dynamicIsland.js';
import {Gaps} from './modules/gaps.js';
import {GlassDebug} from './modules/glassDebug.js';
import {GlassMenus} from './modules/glassMenus.js';
import {Launchpad} from './modules/launchpad.js';
import {MenuBarIcons} from './modules/menuBarIcons.js';
import {LockScreen} from './modules/lockScreen.js';
import {LoginScreen} from './modules/loginScreen.js';
import {Notifications} from './modules/notifications.js';
import {NotificationCenter} from './modules/notificationCenter.js';
import {SecondaryBars} from './modules/secondaryBars.js';
import {Spotlight} from './modules/spotlight.js';
import {StageManager} from './modules/stageManager.js';
import {ThemeCustom} from './modules/themeCustom.js';
import {TopBar} from './modules/topbar.js';
import {Vibrancy} from './modules/vibrancy.js';
import {Updater} from './modules/updater.js';
import {WallpaperPicker} from './modules/wallpaperPicker.js';
import {Widgets} from './modules/widgets.js';
import {WindowAnimations} from './modules/windowAnimations.js';
import {WindowLayout} from './modules/windowLayout.js';
import {closeGuide} from './lib/guide.js';
import {adaptive} from './lib/adaptive.js';
import {glassPerformance} from './lib/glassPerformance.js';
import {displayInfo} from './lib/display.js';
import {destroyTicker} from './lib/spring.js';
import {installMenuGuard} from './lib/menuGuard.js';

// Only modules flagged `locked` run while the screen is locked: the
// extension stays loaded in the unlock-dialog session mode for the lock
// screen. The modules flagged `keepAlive` do not depend on the panel: they stay
// built while the screen is locked (their chrome is sunk under the lock screen,
// see _sinkChrome) so that unlocking does not rebuild the desktop; the others
// (menu bar, Apple menu, notification bell...) are tied to GNOME's panel, which
// GNOME rearranges at every lock, and are stopped and started again.
const MODULES = [
    // First, so the boot cover is up before the other modules build the UI.
    {key: 'enable-theme-custom', Module: ThemeCustom, keepAlive: true},
    {key: 'enable-updater', Module: Updater},
    {key: 'enable-glass-menus', Module: GlassDebug, keepAlive: true},
    {key: 'enable-boot-shutdown', Module: BootShutdown},
    {key: 'enable-lock-screen', Module: LockScreen, locked: true},
    // GDM's own shell (login screen): the only module that runs there.
    {key: 'enable-login-screen', Module: LoginScreen, greeter: true},
    {key: 'enable-launchpad', Module: Launchpad, keepAlive: true},
    {key: 'enable-topbar', Module: TopBar},
    {key: 'enable-app-menus', Module: AppMenus},
    {key: 'enable-topbar', Module: SecondaryBars},
    {key: 'enable-dock', Module: Dock, keepAlive: true},
    {key: 'enable-dock', Module: Gaps, keepAlive: true},
    {key: 'enable-spotlight', Module: Spotlight, keepAlive: true},
    {key: 'enable-glass-menus', Module: GlassMenus, keepAlive: true},
    {key: 'enable-window-animations', Module: WindowAnimations, keepAlive: true},
    {key: 'enable-dynamic-island', Module: DynamicIsland, keepAlive: true},
    {key: 'enable-notifications', Module: Notifications, keepAlive: true},
    {key: 'enable-notification-center', Module: NotificationCenter},
    {key: 'enable-vibrancy', Module: Vibrancy, keepAlive: true},
    {key: 'enable-widgets', Module: Widgets, keepAlive: true},
    {key: 'enable-desktop-icons', Module: DesktopIcons, keepAlive: true},
    {key: 'enable-wallpaper-picker', Module: WallpaperPicker, keepAlive: true},
    {key: 'enable-menubar-icons', Module: MenuBarIcons},
    {key: 'enable-appearance', Module: Appearance},
    {key: 'enable-window-layout', Module: WindowLayout, keepAlive: true},
    {key: 'enable-window-layout', Module: StageManager, keepAlive: true},
];

export default class GnomacExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._modules = [];
        this._removeMenuGuard = installMenuGuard();
        this._chrome = new Map();
        this._sunk = null;
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
        // At login the modules are built a few at a time, between frames: built in
        // one go they blocked the shell for about a second, right when the
        // start-up animation begins.
        this._start(new Set(), {sliced: true});
        // Any change rebuilds the modules; debounce so dragging a slider in
        // the preferences does not rebuild on every step.
        // Runtime state (Pomodoro timings, reminders) is read live by its
        // module: changing it must not rebuild the whole shell UI.
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key.startsWith('pomodoro-') || (key.startsWith('prayer-') && key !== 'prayer-enabled') || key.startsWith('theme-') || key.startsWith('update-') || key === 'desktop-icons-layout' || key === 'desktop-icons-visible' || key === 'whatsnew-seen' || key === 'island-shelf' || key === 'glass-inspector' || key === 'glass-debug-groups' || key === 'glass-debug' || key === 'glass-debug-mode' || key === 'widget-reminders' || key === 'widgets-layout')
                return;
            this._scheduleReload();
        });
        this._sessionId = Main.sessionMode.connect('updated', () => this._reload());
        // High contrast turns the glass opaque: rebuild when it is switched.
        try {
            this._a11y = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
            this._a11yId = this._a11y.connect('changed::high-contrast', () => this._scheduleReload());
        } catch {
            this._a11y = null;
        }
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
        if (this._a11y) {
            this._a11y.disconnect(this._a11yId);
            this._a11y = null;
        }
        this._settings.disconnect(this._settingsId);
        Main.sessionMode.disconnect(this._sessionId);
        this._restoreChrome();
        this._stop();
        this._removeMenuGuard?.();
        this._removeMenuGuard = null;
        adaptive.stop();
        glassPerformance.stop();
        displayInfo.stop();
        closeGuide(true);
        destroyTicker();
        this._settings = null;
    }

    // Whether a module runs in the current session mode. Only modules flagged
    // `locked` run while the screen is locked, and the login module runs alone
    // in GDM's shell.
    _shouldRun({key, locked: allowedLocked, greeter: forGreeter}) {
        const locked = Main.sessionMode.isLocked;
        const greeter = Main.sessionMode.currentMode === 'gdm';
        if (!this._settings.get_boolean(key) || (locked && !allowedLocked))
            return false;
        return greeter === !!forGreeter;
    }

    // `keep`: modules (classes) that are already running and stay as they are.
    // `sliced`: build the modules a few at a time, between frames (start-up).
    _start(keep = new Set(), {sliced = false} = {}) {
        this._cancelStart();
        this._forceAnimations();
        adaptive.start();
        displayInfo.start();
        glassPerformance.refreshHz = () => displayInfo.refreshHz;
        glassPerformance.start(this.getSettings());
        const entries = MODULES.filter(entry => !keep.has(entry.Module) && this._shouldRun(entry));
        if (!sliced) {
            for (const entry of entries)
                this._enableModule(entry);
            return;
        }
        const started = GLib.get_monotonic_time();
        const token = this._startToken = {longest: 0};
        let index = 0;
        const step = () => {
            if (this._startToken !== token)
                return GLib.SOURCE_REMOVE;
            this._startId = 0;
            const begin = GLib.get_monotonic_time();
            while (index < entries.length) {
                this._enableModule(entries[index++]);
                // After a few milliseconds of work the frames get their turn.
                if (index < entries.length && GLib.get_monotonic_time() - begin > 6000)
                    break;
            }
            token.longest = Math.max(token.longest, GLib.get_monotonic_time() - begin);
            if (index < entries.length) {
                this._startId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, step);
                return GLib.SOURCE_REMOVE;
            }
            this._startToken = null;
            console.log(`GNOMAC startup: ${entries.length} modules built in ${Math.round((GLib.get_monotonic_time() - started) / 1000)} ms, ` +
                `longest block ${Math.round(token.longest / 1000)} ms`);
            return GLib.SOURCE_REMOVE;
        };
        // The first ones (the boot cover) are built at once.
        step();
    }

    _enableModule(entry) {
        const {key, Module} = entry;
        const module = new Module(this);
        try {
            // What the module adds to the UI group, to be able to put it
            // under the lock screen later.
            const ui = Main.layoutManager.uiGroup;
            const before = new Set(ui.get_children());
            module.enable();
            this._chrome.set(module, ui.get_children().filter(actor => !before.has(actor)));
            this._modules.push(module);
        } catch (e) {
            logError(e, `GNOMAC: cannot enable ${key}`);
            try {
                module.disable();
            } catch {}
        }
    }

    // A start-up still building modules stops here (a stop or a reload came first).
    _cancelStart() {
        this._startToken = null;
        if (this._startId) {
            GLib.source_remove(this._startId);
            this._startId = 0;
        }
    }

    _stop(keep = new Set()) {
        this._cancelStart();
        const kept = [];
        for (const module of this._modules.reverse()) {
            if (keep.has(module.constructor)) {
                kept.unshift(module);
                continue;
            }
            this._chrome.delete(module);
            try {
                module.disable();
            } catch (e) {
                logError(e, 'GNOMAC: error while disabling a module');
            }
        }
        this._modules = kept;
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

    // Locking and unlocking: the lock screen module runs in both modes, and so
    // do the modules flagged `keepAlive` (they do not depend on the panel). Only
    // the panel-bound ones are stopped at the lock and built again at the unlock,
    // which is little work: rebuilding the whole desktop at every unlock was the
    // pause in the unlock transition.
    _reload() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        const greeter = Main.sessionMode.currentMode === 'gdm';
        // A setting changed while locked: everything is rebuilt now that it is over.
        if (this._reloadWhenUnlocked && !Main.sessionMode.isLocked) {
            this._reloadWhenUnlocked = false;
            this._restoreChrome();
            this._stop();
            this._start();
            return;
        }
        const keep = new Set();
        for (const entry of MODULES) {
            if (!this._modules.some(m => m.constructor === entry.Module))
                continue;
            if (entry.locked && this._shouldRun(entry))
                keep.add(entry.Module);
            else if (entry.keepAlive && !greeter && this._settings.get_boolean(entry.key))
                keep.add(entry.Module);
        }
        this._stop(keep);
        this._start(keep);
        if (Main.sessionMode.isLocked)
            this._sinkChrome();
        else
            this._restoreChrome();
    }

    // The modules that stay alive keep their chrome in the UI group, above GNOME's
    // lock screen. It is moved under it (the lock screen is opaque) and put back
    // at the unlock. Overlays that were open are closed first: they would still
    // be open when the screen is unlocked.
    _sinkChrome() {
        if (this._sunk)
            return;
        const ui = Main.layoutManager.uiGroup;
        const shield = Main.layoutManager.screenShieldGroup;
        if (!shield || shield.get_parent() !== ui)
            return;
        for (const module of this._modules) {
            for (const close of ['close', 'closePalette']) {
                if (typeof module[close] === 'function') {
                    try {
                        module[close]();
                    } catch {}
                }
            }
            if (module.constructor.name === 'DynamicIsland') {
                module._pinned = false;
                module._hoverOpen = false;
                try {
                    module._update();
                } catch {}
            }
        }
        // Copied text must not outlive the session UI (GNOME clears the real
        // clipboard when it locks).
        import('./lib/clipboardHistory.js').then(m => m.clearClipboard()).catch(() => {});
        // Where each one sits is noted before any of them moves (a neighbour
        // that moves first would be forgotten), then they are put under the shield.
        this._sunk = [];
        for (const [module, actors] of this._chrome) {
            if (!this._modules.includes(module))
                continue;
            for (const actor of actors) {
                if (actor.get_parent() === ui)
                    this._sunk.push({actor, previous: actor.get_previous_sibling()});
            }
        }
        // Bottom first: the order among them is kept.
        this._sunk.sort((a, b) => ui.get_children().indexOf(a.actor) - ui.get_children().indexOf(b.actor));
        for (const {actor} of this._sunk)
            ui.set_child_below_sibling(actor, shield);
    }

    _restoreChrome() {
        const sunk = this._sunk;
        if (!sunk)
            return;
        this._sunk = null;
        const ui = Main.layoutManager.uiGroup;
        // From the bottom up, each one back above the sibling it had.
        for (const {actor, previous} of sunk) {
            try {
                if (actor.get_parent() !== ui)
                    continue;
                if (previous && previous.get_parent() === ui)
                    ui.set_child_above_sibling(actor, previous);
                else
                    ui.set_child_above_sibling(actor, null);
            } catch (e) {
                logError(e, 'GNOMAC: cannot put a UI element back above the lock screen');
            }
        }
    }

    _scheduleReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._reloadId = 0;
            // A rebuild while the screen is locked would also stop the lock
            // screen module (and its unlock transition): it waits for the unlock.
            if (Main.sessionMode.isLocked) {
                this._reloadWhenUnlocked = true;
                return GLib.SOURCE_REMOVE;
            }
            this._stop();
            this._start();
            return GLib.SOURCE_REMOVE;
        });
    }
}
