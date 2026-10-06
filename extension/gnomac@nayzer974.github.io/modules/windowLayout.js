// Window tiling, as in macOS Sequoia/Golden Gate: halves, quarters, thirds,
// fill and centre.
//
//  - Super+Ctrl+arrows tile the focused window to a half, Super+Ctrl+Return
//    fills the screen, Super+Ctrl+C centres it,
//  - Super+Ctrl+T opens a glass palette of every layout: pick one with the
//    pointer, the arrows + Return, or a number.
//
// A glass ghost glides from the window's frame to the target frame, then the
// window itself is placed under it and the ghost fades out.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {press} from '../lib/motion.js';
import {t} from '../lib/i18n.js';

// [id, french label, english label, x, y, w, h] as fractions of the work area.
const LAYOUTS = [
    ['left', 'Moitié gauche', 'Left half', 0, 0, 0.5, 1],
    ['right', 'Moitié droite', 'Right half', 0.5, 0, 0.5, 1],
    ['top', 'Moitié haute', 'Top half', 0, 0, 1, 0.5],
    ['bottom', 'Moitié basse', 'Bottom half', 0, 0.5, 1, 0.5],
    ['tl', 'Haut gauche', 'Top left', 0, 0, 0.5, 0.5],
    ['tr', 'Haut droite', 'Top right', 0.5, 0, 0.5, 0.5],
    ['bl', 'Bas gauche', 'Bottom left', 0, 0.5, 0.5, 0.5],
    ['br', 'Bas droite', 'Bottom right', 0.5, 0.5, 0.5, 0.5],
    ['third1', 'Premier tiers', 'First third', 0, 0, 1 / 3, 1],
    ['third2', 'Tiers central', 'Middle third', 1 / 3, 0, 1 / 3, 1],
    ['third3', 'Dernier tiers', 'Last third', 2 / 3, 0, 1 / 3, 1],
    ['fill', 'Remplir', 'Fill', 0, 0, 1, 1],
    ['center', 'Centrer', 'Centre', 0.15, 0.1, 0.7, 0.8],
];

const KEYS = {
    'tile-left': 'left', 'tile-right': 'right', 'tile-top': 'top', 'tile-bottom': 'bottom',
    'tile-fill': 'fill', 'tile-center': 'center',
};

const GRID_COLUMNS = 5;

function layoutById(id) {
    return LAYOUTS.find(l => l[0] === id);
}

export class WindowLayout {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._bound = [];
        this._ghosts = new Set();
    }

    enable() {
        const flags = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
        const mode = Shell.ActionMode.NORMAL;
        Main.wm.addKeybinding('layout-shortcut', this._settings, flags, mode, () => this.togglePalette());
        this._bound.push('layout-shortcut');
        for (const [key, id] of Object.entries(KEYS)) {
            Main.wm.addKeybinding(key, this._settings, flags, mode, () => this.tile(id));
            this._bound.push(key);
        }
    }

    disable() {
        for (const key of this._bound)
            Main.wm.removeKeybinding(key);
        this._bound = [];
        this.closePalette(true);
        for (const ghost of [...this._ghosts])
            ghost.destroy();
        this._ghosts.clear();
    }

    // ------------------------------------------------------------- tiling

    _targetRect(window, layout) {
        const area = window.get_work_area_current_monitor();
        const gap = this._settings.get_int('window-gap');
        const half = gap / 2;
        const [, , , fx, fy, fw, fh] = layout;
        const inner = {
            x: area.x + half, y: area.y + half,
            width: area.width - gap, height: area.height - gap,
        };
        return {
            x: Math.round(inner.x + fx * inner.width + half),
            y: Math.round(inner.y + fy * inner.height + half),
            width: Math.round(fw * inner.width - gap),
            height: Math.round(fh * inner.height - gap),
        };
    }

    tile(id) {
        const window = global.display.focus_window;
        const layout = layoutById(id);
        if (!window || !layout || !window.allows_resize() ||
            window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const target = this._targetRect(window, layout);
        const from = window.get_frame_rect();

        const place = () => {
            try {
                if (window.get_maximized?.())
                    window.unmaximize();
            } catch {
                try {
                    window.unmaximize(Meta.MaximizeFlags?.BOTH);
                } catch {}
            }
            window.move_resize_frame(true, target.x, target.y, target.width, target.height);
        };
        if (!St.Settings.get().enable_animations) {
            place();
            return;
        }

        const ghost = new St.Widget({style_class: 'gnomac-tile-ghost', reactive: false,
            x: from.x, y: from.y, width: from.width, height: from.height, opacity: 200});
        Main.layoutManager.uiGroup.add_child(ghost);
        this._ghosts.add(ghost);
        ghost.connect('destroy', () => this._ghosts.delete(ghost));
        ghost.ease({
            x: target.x, y: target.y, width: target.width, height: target.height,
            duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => {
                place();
                // Let the window repaint at its new size, then reveal it.
                ghost.ease({opacity: 0, duration: 200, delay: 90,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => ghost.destroy()});
            },
        });
    }

    // ------------------------------------------------------------ palette

    togglePalette() {
        if (this._palette)
            this.closePalette();
        else
            this.openPalette();
    }

    openPalette() {
        const window = global.display.focus_window;
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const monitor = Main.layoutManager.primaryMonitor;

        const root = new St.Widget({style_class: 'gnomac-layout-backdrop', reactive: true,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            layout_manager: new Clutter.BinLayout(), opacity: 0});
        const panel = new St.BoxLayout({style_class: 'gnomac-layout-panel', vertical: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        panel.add_child(new St.Label({style_class: 'gnomac-layout-title',
            text: t('Move & Resize Window', 'Déplacer et redimensionner la fenêtre')}));
        this._caption = new St.Label({style_class: 'gnomac-layout-caption', text: ' '});

        const grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_spacing: 10, row_spacing: 10}),
            x_align: Clutter.ActorAlign.CENTER});
        this._buttons = [];
        LAYOUTS.forEach((layout, index) => {
            const button = this._layoutButton(layout, index);
            grid.layout_manager.attach(button, index % GRID_COLUMNS, Math.floor(index / GRID_COLUMNS), 1, 1);
            this._buttons.push(button);
        });
        panel.add_child(grid);
        panel.add_child(this._caption);
        root.add_child(panel);

        root.connect('button-press-event', () => {
            this.closePalette();
            return Clutter.EVENT_STOP;
        });
        root.connect('key-press-event', (_a, event) => this._onKey(event));

        Main.layoutManager.uiGroup.add_child(root);
        Main.layoutManager.uiGroup.set_child_above_sibling(root, null);
        this._grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab) {
            root.destroy();
            return;
        }
        this._palette = root;
        this._selected = 0;
        this._markSelection();
        panel.set_pivot_point(0.5, 0.5);
        panel.set_scale(0.94, 0.94);
        panel.ease({scale_x: 1, scale_y: 1, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        root.ease({opacity: 255, duration: 160});
    }

    // A tiny drawing of the screen with the target region filled in.
    _layoutButton(layout, index) {
        const [id, fr, en, x, y, w, h] = layout;
        const button = new St.Button({style_class: 'gnomac-layout-button', can_focus: false,
            reactive: true, track_hover: true, layout_manager: new Clutter.BinLayout()});
        const screen = new St.Widget({style_class: 'gnomac-layout-screen', width: 64, height: 42,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const region = new St.Widget({style_class: 'gnomac-layout-region',
            x: Math.round(3 + x * 58), y: Math.round(3 + y * 36),
            width: Math.round(w * 58) - 2, height: Math.round(h * 36) - 2});
        screen.add_child(region);
        button.set_child(screen);
        press(button, {down: 0.94});
        button.connect('notify::hover', () => {
            if (button.hover) {
                this._selected = index;
                this._markSelection();
            }
        });
        button.connect('clicked', () => this._choose(id));
        return button;
    }

    _markSelection() {
        this._buttons.forEach((button, i) => {
            if (i === this._selected)
                button.add_style_pseudo_class('selected');
            else
                button.remove_style_pseudo_class('selected');
        });
        const layout = LAYOUTS[this._selected];
        this._caption.text = t(layout[2], layout[1]);
    }

    _onKey(event) {
        const symbol = event.get_key_symbol();
        const count = LAYOUTS.length;
        if (symbol === Clutter.KEY_Escape) {
            this.closePalette();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space) {
            this._choose(LAYOUTS[this._selected][0]);
            return Clutter.EVENT_STOP;
        }
        const step = {
            [Clutter.KEY_Left]: -1, [Clutter.KEY_Right]: 1,
            [Clutter.KEY_Up]: -GRID_COLUMNS, [Clutter.KEY_Down]: GRID_COLUMNS,
        }[symbol];
        if (step) {
            this._selected = Math.min(count - 1, Math.max(0, this._selected + step));
            this._markSelection();
            return Clutter.EVENT_STOP;
        }
        // 1..9 and 0 pick a layout directly.
        const digit = symbol >= Clutter.KEY_0 && symbol <= Clutter.KEY_9 ? symbol - Clutter.KEY_0 : -1;
        if (digit >= 0) {
            const layout = LAYOUTS[digit === 0 ? 9 : digit - 1];
            if (layout)
                this._choose(layout[0]);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_STOP;
    }

    _choose(id) {
        this.closePalette();
        // The palette held the focus: tile once the window has it back.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this.tile(id);
            return GLib.SOURCE_REMOVE;
        });
    }

    closePalette(immediate = false) {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const root = this._palette;
        this._palette = null;
        this._buttons = [];
        if (!root)
            return;
        if (immediate)
            root.destroy();
        else
            root.ease({opacity: 0, duration: 140, onStopped: () => root.destroy()});
    }
}
