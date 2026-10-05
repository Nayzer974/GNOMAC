// Spotlight (Super+Space): a floating Liquid Glass search bar above the
// windows. Results: applications, a calculator, system actions and a web
// search fallback. Keyboard first: type, arrows to move, Enter to open,
// Escape to dismiss. Opening uses a spring so the bar "lands" like macOS.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface, clearGlassParams} from '../lib/glass.js';
import {Spring, getTicker} from '../lib/spring.js';
import {evaluate, format, looksLikeMath} from '../lib/calculator.js';
import * as Session from '../lib/session.js';
import {t} from '../lib/i18n.js';

const WIDTH = 680;
const BAR_HEIGHT = 56;
const MAX_APPS = 6;
const RADIUS = 26;
const SHORTCUT_KEY = 'spotlight-shortcut';
const WM_KEYBINDINGS = 'org.gnome.desktop.wm.keybindings';

const decimalComma = (GLib.get_language_names()[0] ?? '').startsWith('fr');

function systemActionEntries() {
    const entry = (name, keywords, icon, run) => ({name, keywords, icon, run});
    return [
        entry(t('Lock Screen', 'Verrouiller l\'écran'), ['lock', 'verrouiller', 'verrou'],
            'system-lock-screen-symbolic', () => Session.lockScreen()),
        entry(t('Sleep', 'Suspendre l\'activité'), ['sleep', 'suspend', 'veille', 'suspendre'],
            'weather-clear-night-symbolic', () => Session.suspend()),
        entry(t('Restart…', 'Redémarrer…'), ['restart', 'reboot', 'redemarrer', 'redémarrer'],
            'system-reboot-symbolic', () => Session.restart()),
        entry(t('Shut Down…', 'Éteindre…'), ['shutdown', 'power off', 'eteindre', 'éteindre'],
            'system-shutdown-symbolic', () => Session.powerOff()),
        entry(t('Log Out…', 'Fermer la session…'), ['logout', 'log out', 'deconnexion', 'déconnexion', 'session'],
            'system-log-out-symbolic', () => Session.logOut()),
    ];
}

const ResultRow = GObject.registerClass({
    Signals: {'activate': {}, 'hovered': {}},
}, class ResultRow extends St.BoxLayout {
    _init(result) {
        super._init({
            style_class: 'gnomac-spotlight-row',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        this.result = result;

        const icon = result.app
            ? result.app.create_icon_texture(28)
            : new St.Icon({icon_name: result.icon, icon_size: 20, style_class: 'gnomac-spotlight-symbol'});
        const iconBox = new St.Bin({style_class: 'gnomac-spotlight-row-icon', child: icon});
        this.add_child(iconBox);

        const title = new St.Label({
            text: result.title,
            style_class: 'gnomac-spotlight-row-title',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(title);

        if (result.subtitle) {
            this.add_child(new St.Label({
                text: result.subtitle,
                style_class: 'gnomac-spotlight-row-subtitle',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        this.connect('notify::hover', () => {
            if (this.hover)
                this.emit('hovered');
        });
        this.connect('button-release-event', () => {
            this.emit('activate');
            return Clutter.EVENT_STOP;
        });
    }

    set selected(value) {
        if (value)
            this.add_style_pseudo_class('selected');
        else
            this.remove_style_pseudo_class('selected');
    }
});

export class Spotlight {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._rows = [];
        this._selected = -1;
        this._grab = null;
        this._tick = dt => this._onTick(dt);
    }

    enable() {
        this._freeSuperSpace();

        this._root = new St.Widget({
            name: 'gnomacSpotlight',
            reactive: true,
            visible: false,
        });
        this._root.connect('button-press-event', (_actor, event) => {
            const [x, y] = event.get_coords();
            const [cx, cy] = this._card.get_transformed_position();
            const inside = x >= cx && x <= cx + this._card.width &&
                y >= cy && y <= cy + this._card.height;
            if (!inside)
                this.close();
            return Clutter.EVENT_PROPAGATE;
        });

        this._card = new St.Widget({style_class: 'gnomac-spotlight-card'});
        this._card.set_pivot_point(0.5, 0.0);
        this._glass = new GlassSurface({
            backdrop: 'windows',
            blur: Math.max(this._settings.get_int('glass-blur'), 40),
            glass: {
                ...clearGlassParams(this._settings, RADIUS),
                refraction: this._settings.get_double('glass-refraction') * 1.2,
            },
        });
        this._card.add_child(this._glass);

        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-spotlight-content',
        });
        this._card.add_child(this._content);

        const bar = new St.BoxLayout({style_class: 'gnomac-spotlight-bar'});
        bar.add_child(new St.Icon({
            icon_name: 'system-search-symbolic',
            style_class: 'gnomac-spotlight-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._entry = new St.Entry({
            style_class: 'gnomac-spotlight-entry',
            hint_text: t('Spotlight Search', 'Recherche Spotlight'),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        bar.add_child(this._entry);
        this._content.add_child(bar);

        this._results = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-spotlight-results',
        });
        this._content.add_child(this._results);

        this._root.add_child(this._card);
        Main.layoutManager.uiGroup.add_child(this._root);

        const text = this._entry.clutter_text;
        text.connect('text-changed', () => this._search());
        text.connect('key-press-event', (_actor, event) => this._onKey(event));
        text.connect('activate', () => this._activateSelected());

        this._height = new Spring({stiffness: 420, damping: 34, value: BAR_HEIGHT});
        this._scale = new Spring({stiffness: 380, damping: 22, value: 1});

        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.toggle());

        this._overviewId = Main.overview.connect('showing', () => this.close());
    }

    disable() {
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        if (this._overviewId) {
            Main.overview.disconnect(this._overviewId);
            this._overviewId = 0;
        }
        this.close(false);
        getTicker().remove(this._tick);
        this._root?.destroy();
        this._root = null;
        this._restoreSuperSpace();
    }

    // GNOME binds Super+Space to "next input source". Spotlight needs it, so
    // it is lifted while GNOMAC runs and handed back on disable.
    _freeSuperSpace() {
        const wanted = this._settings.get_strv(SHORTCUT_KEY);
        this._wmSettings = new Gio.Settings({schema_id: WM_KEYBINDINGS});
        this._savedInputSource = null;
        const current = this._wmSettings.get_strv('switch-input-source');
        const kept = current.filter(accel => !wanted.includes(accel));
        if (kept.length !== current.length) {
            this._savedInputSource = current;
            this._wmSettings.set_strv('switch-input-source', kept);
        }
    }

    _restoreSuperSpace() {
        if (this._savedInputSource)
            this._wmSettings.set_strv('switch-input-source', this._savedInputSource);
        this._savedInputSource = null;
        this._wmSettings = null;
    }

    toggle() {
        if (this._root.visible)
            this.close();
        else
            this.open();
    }

    open() {
        const monitor = Main.layoutManager.primaryMonitor;
        this._root.set_position(monitor.x, monitor.y);
        this._root.set_size(monitor.width, monitor.height);
        this._cardX = Math.round((monitor.width - WIDTH) / 2);
        this._cardY = Math.round(monitor.height * 0.22);
        this._entry.text = '';
        this._clearResults();

        this._root.show();
        Main.layoutManager.uiGroup.set_child_above_sibling(this._root, null);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        global.stage.set_key_focus(this._entry.clutter_text);

        this._height.snap(BAR_HEIGHT);
        this._scale.snap(0.9);
        this._scale.setTarget(1);
        this._card.opacity = 0;
        this._card.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._layout();
        getTicker().add(this._tick);
    }

    close(animate = true) {
        if (!this._root?.visible)
            return;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (!animate) {
            this._root.hide();
            return;
        }
        this._card.ease({
            opacity: 0,
            scale_x: 0.96,
            scale_y: 0.96,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                this._root?.hide();
                this._card?.set_scale(1, 1);
            },
        });
    }

    _onTick(dt) {
        if (!this._root?.visible)
            return false;
        this._height.step(dt);
        this._scale.step(dt);
        this._layout();
        return !(this._height.settled && this._scale.settled);
    }

    _layout() {
        const height = Math.round(this._height.value);
        this._card.set_position(this._cardX, this._cardY);
        this._card.set_size(WIDTH, height);
        this._card.set_scale(this._scale.value, this._scale.value);
        this._glass.set_size(WIDTH, height);
        this._glass.setStageOrigin(this._root.x + this._cardX, this._root.y + this._cardY);
        this._content.set_size(WIDTH, height);
    }

    _clearResults() {
        this._results.destroy_all_children();
        this._rows = [];
        this._selected = -1;
    }

    _collect(query) {
        const results = [];
        const q = query.trim();
        if (!q)
            return results;
        const lower = q.toLowerCase();

        if (looksLikeMath(q)) {
            try {
                const value = format(evaluate(q), decimalComma);
                results.push({
                    section: t('Calculator', 'Calculatrice'),
                    title: `= ${value}`,
                    subtitle: t('Enter to copy', 'Entrée pour copier'),
                    icon: 'accessories-calculator-symbolic',
                    run: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value),
                });
            } catch {
                // Incomplete expression while typing: no calculator row.
            }
        }

        // Same ranking as the GNOME overview: match quality groups first,
        // then usage frequency inside each group.
        const appSystem = Shell.AppSystem.get_default();
        const usage = Shell.AppUsage.get_default();
        const apps = Shell.AppSystem.search(lower)
            .flatMap(group => [...group].sort((a, b) => usage.compare(a, b)))
            .map(id => appSystem.lookup_app(id))
            .filter(app => app && app.app_info?.should_show())
            .slice(0, MAX_APPS);
        for (const app of apps) {
            results.push({
                section: t('Applications', 'Applications'),
                title: app.get_name(),
                subtitle: app.state === Shell.AppState.RUNNING ? t('Open', 'Ouverte') : '',
                app,
                run: () => app.activate(),
            });
        }

        for (const action of systemActionEntries()) {
            const words = [...action.name.toLowerCase().split(/[\s'’]+/), ...action.keywords];
            const hit = words.some(word => word.startsWith(lower));
            if (hit && lower.length >= 2) {
                results.push({
                    section: t('System', 'Système'),
                    title: action.name,
                    icon: action.icon,
                    run: action.run,
                });
            }
        }

        results.push({
            section: t('Web', 'Web'),
            title: t(`Search the web for “${q}”`, `Rechercher « ${q} » sur le Web`),
            icon: 'web-browser-symbolic',
            run: () => Gio.AppInfo.launch_default_for_uri(
                `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
                global.create_app_launch_context(0, -1)),
        });
        return results;
    }

    _search() {
        this._clearResults();
        const results = this._collect(this._entry.text);
        let section = null;
        for (const result of results) {
            if (result.section !== section) {
                section = result.section;
                this._results.add_child(new St.Label({
                    text: section,
                    style_class: 'gnomac-spotlight-section',
                }));
            }
            const row = new ResultRow(result);
            const index = this._rows.length;
            row.connect('activate', () => this._activate(index));
            row.connect('hovered', () => this._select(index));
            this._results.add_child(row);
            this._rows.push(row);
        }
        this._select(this._rows.length ? 0 : -1);
        // Measure instead of summing constants so CSS changes never make the
        // last row overflow the glass.
        const [, natural] = this._results.get_preferred_height(WIDTH);
        this._height.setTarget(BAR_HEIGHT + (results.length ? natural : 0));
        getTicker().add(this._tick);
    }

    _select(index) {
        if (this._selected >= 0 && this._rows[this._selected])
            this._rows[this._selected].selected = false;
        this._selected = index;
        if (index >= 0)
            this._rows[index].selected = true;
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape) {
            if (this._entry.text)
                this._entry.text = '';
            else
                this.close();
            return Clutter.EVENT_STOP;
        }
        if (!this._rows.length)
            return Clutter.EVENT_PROPAGATE;
        if (key === Clutter.KEY_Down || key === Clutter.KEY_Tab) {
            this._select((this._selected + 1) % this._rows.length);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Up || key === Clutter.KEY_ISO_Left_Tab) {
            this._select((this._selected - 1 + this._rows.length) % this._rows.length);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _activateSelected() {
        if (this._selected >= 0)
            this._activate(this._selected);
    }

    _activate(index) {
        const row = this._rows[index];
        if (!row)
            return;
        this.close();
        try {
            row.result.run();
        } catch (e) {
            logError(e, 'GNOMAC Spotlight');
        }
    }
}
