// "Appearance" section of the Control Center, as in the macOS 27 Appearance
// settings: accent colour, light/dark/auto, Liquid Glass clear/tinted and the
// icon & widget style, all one click away from the menu bar.
//
// The accent colour and the colour scheme are GNOME's own settings (so GTK 4
// and libadwaita apps follow); the glass and icon styles are GNOMAC's.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {press} from '../lib/motion.js';
import {t} from '../lib/i18n.js';

// macOS names and swatches, mapped to GNOME's accent-color enum.
const ACCENTS = [
    ['blue', '#0a84ff'], ['purple', '#bf5af2'], ['pink', '#ff375f'], ['red', '#ff453a'],
    ['orange', '#ff9f0a'], ['yellow', '#ffd60a'], ['green', '#30d158'], ['teal', '#40c8e0'],
    ['slate', '#98989d'],
];

function segmented(options, onPick) {
    const box = new St.BoxLayout({style_class: 'gnomac-seg', x_expand: true});
    const buttons = new Map();
    for (const [value, label] of options) {
        const button = new St.Button({style_class: 'gnomac-seg-item', label, toggle_mode: true,
            can_focus: false, x_expand: true});
        press(button, {down: 0.96});
        button.connect('clicked', () => onPick(value));
        box.add_child(button);
        buttons.set(value, button);
    }
    box.select = current => {
        for (const [value, button] of buttons)
            button.checked = value === current;
    };
    return box;
}

export class Appearance {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ids = [];
        this._swatches = new Map();
    }

    enable() {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        if (!menu?.addItem)
            return;
        this._menu = menu;

        this._root = new St.BoxLayout({style_class: 'gnomac-appearance', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._root.add_child(new St.Label({style_class: 'gnomac-appearance-title',
            text: t('Appearance', 'Apparence')}));

        this._scheme = segmented([
            ['default', t('Auto', 'Auto')],
            ['prefer-light', t('Light', 'Clair')],
            ['prefer-dark', t('Dark', 'Sombre')],
        ], value => this._interface.set_string('color-scheme', value));
        this._root.add_child(this._scheme);

        this._root.add_child(new St.Label({style_class: 'gnomac-appearance-sub',
            text: t('Accent colour', 'Couleur d’accentuation')}));
        const swatches = new St.BoxLayout({style_class: 'gnomac-swatches', x_expand: true});
        for (const [name, hex] of ACCENTS) {
            const swatch = new St.Button({style_class: 'gnomac-swatch', can_focus: false,
                style: `background-color: ${hex};`, x_expand: true, x_align: Clutter.ActorAlign.CENTER});
            press(swatch, {down: 0.82});
            swatch.connect('clicked', () => this._interface.set_string('accent-color', name));
            swatches.add_child(swatch);
            this._swatches.set(name, swatch);
        }
        this._root.add_child(swatches);

        this._root.add_child(new St.Label({style_class: 'gnomac-appearance-sub', text: 'Liquid Glass'}));
        this._glass = segmented([
            ['clear', t('Clear', 'Transparent')],
            ['tinted', t('Tinted', 'Teinté')],
        ], value => this._settings.set_boolean('glass-tinted', value === 'tinted'));
        this._root.add_child(this._glass);

        this._root.add_child(new St.Label({style_class: 'gnomac-appearance-sub',
            text: t('Icon & widget style', 'Style des icônes et widgets')}));
        this._icons = segmented([
            ['default', t('Default', 'Défaut')],
            ['dark', t('Dark', 'Sombre')],
            ['clear', t('Clear', 'Transparent')],
            ['tinted', t('Tinted', 'Teinté')],
        ], value => this._settings.set_string('dock-icon-style', value));
        this._root.add_child(this._icons);

        menu.addItem(this._root, 2);

        this._ids.push([this._interface, this._interface.connect('changed::accent-color', () => this._sync())]);
        this._ids.push([this._interface, this._interface.connect('changed::color-scheme', () => this._sync())]);
        this._ids.push([this._settings, this._settings.connect('changed::glass-tinted', () => this._sync())]);
        this._ids.push([this._settings, this._settings.connect('changed::dock-icon-style', () => this._sync())]);
        this._sync();
    }

    _sync() {
        if (!this._root)
            return;
        this._scheme.select(this._interface.get_string('color-scheme'));
        const accent = this._interface.get_string('accent-color');
        for (const [name, swatch] of this._swatches)
            swatch.checked = name === accent;
        this._glass.select(this._settings.get_boolean('glass-tinted') ? 'tinted' : 'clear');
        this._icons.select(this._settings.get_string('dock-icon-style'));
    }

    disable() {
        for (const [object, id] of this._ids)
            object.disconnect(id);
        this._ids = [];
        this._swatches.clear();
        this._root?.destroy();
        this._root = null;
    }
}
