// Displays (Super + Ctrl + D): a small panel to manage several displays — which
// one is the main display, on which side of it each other one sits (left,
// right, above, below), turn one off or on, mirror, extend, or keep only one.
//
// The panel is shown on EVERY display at once, the same on each. When a
// display that is gone still counts (a cable pulled out, a dock unplugged: the
// system keeps reporting it for a while), the desktop is drawn on a screen that
// is not there and the one that is looks like the "second" screen: the panel
// then appears where the user can see it, and "Use the built-in display only"
// brings everything back. The changes are temporary (until the displays change
// again), so a bad layout is never kept.
//
// What is asked of Mutter is worked out in lib/displayLayout.js.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {displayInfo} from '../lib/display.js';
import {builtinDisplay, logicalSize, planLayout, relation} from '../lib/displayLayout.js';
import {t} from '../lib/i18n.js';

const SHORTCUT_KEY = 'displays-shortcut';
const MAP_WIDTH = 400;
const MAP_HEIGHT = 160;
const MAP_PADDING = 14;

export class Displays {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._root = null;
        this._cards = [];
        this._selected = null;
        this._opening = 0;
        this._idleId = 0;
    }

    enable() {
        this._extension.displays = this;
        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.toggle());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            if (this._root)
                displayInfo.refresh(() => this._rebuild());
        });
    }

    disable() {
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        this.close();
        if (this._extension.displays === this)
            this._extension.displays = null;
    }

    toggle() {
        if (this._root)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._root || this._opening)
            return;
        // The state is read again first: the panel shows what the system says now.
        const ticket = this._opening = Math.random() || 1;
        displayInfo.refresh(() => {
            if (this._opening !== ticket)
                return;
            this._opening = 0;
            this._show();
        });
    }

    close() {
        this._opening = 0;
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._root?.destroy();
        this._root = null;
        this._cards = [];
    }

    // ------------------------------------------------------------------ build

    _show() {
        const displays = displayInfo.state?.displays ?? [];
        if (!displays.length)
            return;
        this._selected = (displays.find(d => d.primary) ?? displays[0]).connector;
        this._root = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height});
        this._root.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.uiGroup.add_child(this._root);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._root, null);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab) {
            this._root.destroy();
            this._root = null;
            return;
        }
        // Never keep the keyboard and the pointer for a panel that failed to draw.
        try {
            this._rebuild();
        } catch (e) {
            logError(e, 'GNOMAC displays panel');
            this.close();
        }
    }

    // One backdrop and one card per display, all showing the same thing.
    _rebuild() {
        if (!this._root)
            return;
        const displays = displayInfo.state?.displays ?? [];
        if (!displays.length) {
            this.close();
            return;
        }
        if (!displays.some(d => d.connector === this._selected))
            this._selected = (displays.find(d => d.primary) ?? displays[0]).connector;
        this._root.set_size(global.stage.width, global.stage.height);
        this._root.destroy_all_children();
        this._cards = [];
        for (const monitor of Main.layoutManager.monitors) {
            const backdrop = new St.Widget({style_class: 'gnomac-displays-backdrop', reactive: true,
                x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
            backdrop.connect('button-press-event', () => {
                this.close();
                return Clutter.EVENT_STOP;
            });
            const card = new St.BoxLayout({style_class: 'gnomac-displays-card', orientation: Clutter.Orientation.VERTICAL, reactive: true});
            card.connect('button-press-event', () => Clutter.EVENT_STOP);
            this._root.add_child(backdrop);
            this._root.add_child(card);
            this._cards.push({card, monitor});
        }
        this._render(displays);
    }

    _render(displays = displayInfo.state?.displays ?? []) {
        let first = null;
        for (const {card, monitor} of this._cards) {
            card.destroy_all_children();
            const focus = this._fill(card, displays);
            first ??= focus;
            // Centred on its display.
            const [, , width, height] = card.get_preferred_size();
            card.set_position(Math.round(monitor.x + (monitor.width - width) / 2),
                Math.round(monitor.y + (monitor.height - height) / 2));
        }
        if (first)
            global.stage.set_key_focus(first);
    }

    // Redrawn once the click that asked for it is over: a button must not be
    // destroyed while it is still handling its own click.
    _redraw() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleId = 0;
            if (this._root)
                this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _label(text, styleClass) {
        return new St.Label({text, style_class: styleClass});
    }

    _button(text, onClick, {enabled = true, selected = false} = {}) {
        const button = new St.Button({label: text, style_class: 'gnomac-displays-button', can_focus: enabled,
            reactive: enabled, track_hover: enabled});
        if (selected)
            button.add_style_pseudo_class('selected');
        if (!enabled)
            button.add_style_pseudo_class('insensitive');
        if (enabled)
            button.connect('clicked', onClick);
        return button;
    }

    _row(buttons) {
        const row = new St.BoxLayout({style_class: 'gnomac-displays-row'});
        buttons.forEach(button => row.add_child(button));
        return row;
    }

    // The contents of one card. Returns the actor that should take the focus.
    _fill(card, displays) {
        const enabled = displays.filter(d => d.enabled);
        const selected = displays.find(d => d.connector === this._selected) ?? displays[0];
        const main = enabled.find(d => d.primary) ?? enabled[0];
        const mirrored = enabled.some(d => d.mirrored);
        const several = displays.length > 1;

        card.add_child(this._label(t('Displays', 'Écrans'), 'gnomac-displays-title'));
        card.add_child(this._label(several
            ? t('Choose a display on the map, then what to do with it.', 'Choisis un écran sur la carte, puis ce que tu veux en faire.')
            : t('Only one display is connected.', 'Un seul écran est branché.'), 'gnomac-displays-hint'));

        // The map: each display as a rectangle, to scale.
        const map = new St.Widget({style_class: 'gnomac-displays-map', width: MAP_WIDTH, height: MAP_HEIGHT});
        const rects = enabled.map(d => ({d, x: d.x, y: d.y, ...logicalSize(d)}));
        if (!rects.length)
            return card;
        const left = Math.min(...rects.map(r => r.x));
        const top = Math.min(...rects.map(r => r.y));
        const spanW = Math.max(...rects.map(r => r.x + r.width)) - left;
        const spanH = Math.max(...rects.map(r => r.y + r.height)) - top;
        const scale = Math.min((MAP_WIDTH - 2 * MAP_PADDING) / spanW, (MAP_HEIGHT - 2 * MAP_PADDING) / spanH);
        const offsetX = (MAP_WIDTH - spanW * scale) / 2;
        const offsetY = (MAP_HEIGHT - spanH * scale) / 2;
        let focus = null;
        for (const r of rects) {
            const label = `${r.d.name}\n${r.d.width}×${r.d.height}${r.d.primary ? `\n${t('Main', 'Principal')}` : ''}`;
            const tile = new St.Button({label, style_class: 'gnomac-displays-tile', can_focus: true,
                x: Math.round(offsetX + (r.x - left) * scale + 2), y: Math.round(offsetY + (r.y - top) * scale + 2),
                width: Math.max(40, Math.round(r.width * scale) - 4), height: Math.max(30, Math.round(r.height * scale) - 4)});
            if (r.d.connector === selected.connector) {
                tile.add_style_pseudo_class('selected');
                focus = tile;
            }
            if (r.d.primary)
                tile.add_style_class_name('primary');
            tile.connect('clicked', () => {
                this._selected = r.d.connector;
                this._redraw();
            });
            map.add_child(tile);
        }
        card.add_child(map);

        // Displays that are off cannot be drawn on the map: listed under it.
        const off = displays.filter(d => !d.enabled);
        if (off.length) {
            card.add_child(this._row(off.map(d => this._button(`${d.name} (${t('off', 'éteint')})`, () => {
                this._selected = d.connector;
                this._redraw();
            }, {selected: d.connector === selected.connector}))));
        }

        // What can be done with the chosen one.
        card.add_child(this._label(selected.name, 'gnomac-displays-subtitle'));
        const isMain = selected.enabled && selected === main;
        const actions = [];
        if (selected.enabled && several && !mirrored && !isMain) {
            actions.push(this._button(t('Make main display', 'Définir comme écran principal'),
                () => this._run('primary', selected.connector)));
        }
        if (several && selected.enabled && enabled.length > 1)
            actions.push(this._button(t('Turn off', 'Éteindre'), () => this._run('off', selected.connector)));
        if (!selected.enabled)
            actions.push(this._button(t('Turn on', 'Allumer'), () => this._run('on', selected.connector)));
        if (several)
            actions.push(this._button(t('Use this one only', 'Utiliser seulement celui-ci'), () => this._run('only', selected.connector)));
        if (actions.length)
            card.add_child(this._row(actions));

        // Placement next to the main display.
        if (selected.enabled && !isMain && main && !mirrored) {
            card.add_child(this._label(t(`Place it next to “${main.name}”`, `Le placer à côté de « ${main.name} »`), 'gnomac-displays-hint'));
            const sides = [
                ['left', t('← Left', '← Gauche')],
                ['right', t('Right →', 'Droite →')],
                ['above', t('↑ Above', '↑ Au-dessus')],
                ['below', t('↓ Below', '↓ En dessous')],
            ];
            card.add_child(this._row(sides.map(([side, text]) => this._button(text,
                () => this._run('place', selected.connector, {side, of: main.connector}), {
                    enabled: !planLayout(displays, 'place', selected.connector, {side, of: main.connector}).error,
                    selected: relation(selected, main) === side,
                }))));
        }

        // The whole set.
        const whole = [];
        if (enabled.length > 1 && !mirrored)
            whole.push(this._button(t('Mirror', 'Dupliquer'), () => this._run('mirror')));
        if (mirrored || enabled.length < displays.length)
            whole.push(this._button(t('Extend', 'Étendre'), () => this._run('extend')));
        const builtin = builtinDisplay(displays);
        if (builtin && several)
            whole.push(this._button(t('Built-in display only', 'Écran intégré seul'), () => this._run('only', builtin.connector)));
        whole.push(this._button(t('Close', 'Fermer'), () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.close();
            return GLib.SOURCE_REMOVE;
        })));
        card.add_child(this._row(whole));
        return focus ?? card;
    }

    // ------------------------------------------------------------------- act

    _run(action, connector = null, options = {}) {
        displayInfo.apply(action, connector, options)
            .then(() => new Promise(resolve => displayInfo.refresh(resolve)))
            .then(() => this._rebuild())
            .catch(e => Main.notify('GNOMAC', `${t('Cannot change the displays: ', 'Impossible de modifier les écrans : ')}${e.message}`));
    }
}
