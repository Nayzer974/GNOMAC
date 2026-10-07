// Extra views of the Dynamic Island, as in Alcove / Boring Notch:
//  - MonthCalendar: the current month with today highlighted,
//  - PomodoroTimer: focus/break countdown shown as an orange ring when the
//    notch is folded,
//  - Shelf: files kept in the notch, one click opens them.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {t} from './i18n.js';

// ---------------------------------------------------------------- calendar

export class MonthCalendar {
    constructor() {
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-cal'});
        this._title = new St.Label({style_class: 'gnomac-notch-cal-title'});
        this._grid = new St.Widget({layout_manager: new Clutter.GridLayout({
            column_spacing: 2, row_spacing: 1, column_homogeneous: true, row_homogeneous: true})});
        this.actor.add_child(this._title);
        this.actor.add_child(this._grid);
        this._day = -1;
    }

    // Re-render only when the day changes.
    update() {
        const now = GLib.DateTime.new_now_local();
        if (this._day === now.get_day_of_month())
            return;
        this._day = now.get_day_of_month();
        this._grid.destroy_all_children();
        this._title.text = now.format('%B').toUpperCase();

        const layout = this._grid.layout_manager;
        const labels = [t('M', 'L'), t('T', 'M'), t('W', 'M'), t('T', 'J'), t('F', 'V'), t('S', 'S'), t('S', 'D')];
        labels.forEach((text, i) => layout.attach(
            new St.Label({text, style_class: 'gnomac-notch-cal-head', x_align: Clutter.ActorAlign.CENTER}), i, 0, 1, 1));

        const first = GLib.DateTime.new_local(now.get_year(), now.get_month(), 1, 0, 0, 0);
        const offset = first.get_day_of_week() - 1; // Monday first
        const days = GLib.Date.get_days_in_month(now.get_month(), now.get_year());
        for (let d = 1; d <= days; d++) {
            const slot = offset + d - 1;
            const label = new St.Label({
                text: String(d),
                style_class: d === now.get_day_of_month() ? 'gnomac-notch-cal-day today' : 'gnomac-notch-cal-day',
                x_align: Clutter.ActorAlign.CENTER,
            });
            layout.attach(label, slot % 7, 1 + Math.floor(slot / 7), 1, 1);
        }
    }
}

// ---------------------------------------------------------------- pomodoro

// Focus rounds with short breaks, then a long break; every length is a
// setting, editable live from the notch (gear button) or the preferences.
export class PomodoroTimer {
    constructor(settings, onChange) {
        this._settings = settings;
        this._onChange = onChange;
        this.running = false;
        this.phase = 'focus'; // focus | short | long
        this.round = 1;
        this._id = 0;
        this.remaining = this._length('focus');

        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-timer', x_align: Clutter.ActorAlign.CENTER, x_expand: true});

        // Main view: phase, countdown, round dots, controls.
        this.main = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, style_class: 'gnomac-notch-timer-main'});
        const head = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'gnomac-notch-timer-head'});
        this.phaseLabel = new St.Label({style_class: 'gnomac-notch-subtitle', y_align: Clutter.ActorAlign.CENTER});
        this.dots = new St.BoxLayout({style_class: 'gnomac-notch-dots', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(this.phaseLabel);
        head.add_child(this.dots);
        this.timeLabel = new St.Label({style_class: 'gnomac-notch-timer-time', x_align: Clutter.ActorAlign.CENTER});
        const buttons = new St.BoxLayout({style_class: 'gnomac-notch-controls', x_align: Clutter.ActorAlign.CENTER});
        this.startButton = new St.Button({style_class: 'gnomac-notch-pill-button primary', can_focus: true});
        this.skipButton = new St.Button({style_class: 'gnomac-notch-pill-button', can_focus: true,
            label: t('Skip', 'Passer')});
        this.resetButton = new St.Button({style_class: 'gnomac-notch-pill-button', can_focus: true,
            label: t('Reset', 'Réinit.')});
        this.gearButton = new St.Button({style_class: 'gnomac-notch-pill-button', can_focus: true,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 13})});
        this.startButton.connect('clicked', () => this.toggle());
        this.skipButton.connect('clicked', () => this.skip());
        this.resetButton.connect('clicked', () => this.reset());
        this.gearButton.connect('clicked', () => this.showSettings(!this.settingsOpen));
        for (const b of [this.startButton, this.skipButton, this.resetButton, this.gearButton])
            buttons.add_child(b);
        for (const child of [head, this.timeLabel, buttons])
            this.main.add_child(child);

        // Settings view: steppers for every length.
        this.settingsView = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-timer-settings', visible: false, x_align: Clutter.ActorAlign.CENTER});
        const grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_spacing: 22, row_spacing: 6})});
        this._steppers = [];
        [
            ['pomodoro-focus', t('Focus', 'Concentration'), 'min'],
            ['pomodoro-short', t('Short break', 'Pause courte'), 'min'],
            ['pomodoro-long', t('Long break', 'Pause longue'), 'min'],
            ['pomodoro-rounds', t('Rounds', 'Cycles'), ''],
        ].forEach(([key, label, unit], i) => {
            const stepper = this._stepper(key, label, unit);
            grid.layout_manager.attach(stepper, i % 2, Math.floor(i / 2), 1, 1);
        });
        this.autoButton = new St.Button({style_class: 'gnomac-notch-pill-button', toggle_mode: true,
            label: t('Auto-start', 'Enchaîner'), can_focus: true, x_align: Clutter.ActorAlign.CENTER});
        this.autoButton.checked = this._settings.get_boolean('pomodoro-auto');
        this.autoButton.connect('clicked', () =>
            this._settings.set_boolean('pomodoro-auto', this.autoButton.checked));
        const done = new St.Button({style_class: 'gnomac-notch-pill-button primary', can_focus: true,
            label: t('Done', 'OK'), x_align: Clutter.ActorAlign.CENTER});
        done.connect('clicked', () => this.showSettings(false));
        const row = new St.BoxLayout({style_class: 'gnomac-notch-controls', x_align: Clutter.ActorAlign.CENTER});
        row.add_child(this.autoButton);
        row.add_child(done);
        this.settingsView.add_child(grid);
        this.settingsView.add_child(row);

        this.actor.add_child(this.main);
        this.actor.add_child(this.settingsView);
        this.settingsOpen = false;
        this._render();
    }

    _stepper(key, label, unit) {
        const box = new St.BoxLayout({style_class: 'gnomac-notch-stepper'});
        const name = new St.Label({text: label, style_class: 'gnomac-notch-subtitle', y_align: Clutter.ActorAlign.CENTER});
        const minus = new St.Button({style_class: 'gnomac-notch-step', label: '−', can_focus: true});
        const value = new St.Label({style_class: 'gnomac-notch-step-value', y_align: Clutter.ActorAlign.CENTER});
        const plus = new St.Button({style_class: 'gnomac-notch-step', label: '+', can_focus: true});
        const sync = () => (value.text = `${this._settings.get_int(key)}${unit ? ` ${unit}` : ''}`);
        const bump = delta => {
            const range = this._settings.settings_schema.get_key(key).get_range().deepUnpack()[1].deepUnpack();
            const next = Math.max(range[0], Math.min(range[1], this._settings.get_int(key) + delta));
            this._settings.set_int(key, next);
            sync();
            this.applySettings();
        };
        minus.connect('clicked', () => bump(-1));
        plus.connect('clicked', () => bump(1));
        sync();
        for (const child of [name, minus, value, plus])
            box.add_child(child);
        this._steppers.push(sync);
        return box;
    }

    _length(phase) {
        const key = {focus: 'pomodoro-focus', short: 'pomodoro-short', long: 'pomodoro-long'}[phase];
        return this._settings.get_int(key) * 60;
    }

    get total() {
        return this._length(this.phase);
    }

    get fraction() {
        return Math.max(0, Math.min(1, this.remaining / this.total));
    }

    get color() {
        return this.phase === 'focus' ? [1, 0.62, 0.04] : [0.19, 0.82, 0.35];
    }

    showSettings(open) {
        this.settingsOpen = open;
        this.main.visible = !open;
        this.settingsView.visible = open;
        for (const sync of this._steppers)
            sync();
        this.autoButton.checked = this._settings.get_boolean('pomodoro-auto');
        this._onChange();
    }

    // Lengths changed: the displayed countdown follows.
    applySettings() {
        if (!this.running)
            this.remaining = this.total;
        else
            this.remaining = Math.min(this.remaining, this.total);
        this._render();
        this._onChange();
    }

    toggle() {
        this.running = !this.running;
        if (this.running && !this._id)
            this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._tick());
        this._render();
        this._onChange();
    }

    reset() {
        this.running = false;
        this.phase = 'focus';
        this.round = 1;
        this.remaining = this.total;
        this._render();
        this._onChange();
    }

    // Jump to the next phase (also what happens when the countdown ends).
    skip(auto = false) {
        const rounds = this._settings.get_int('pomodoro-rounds');
        if (this.phase === 'focus') {
            this.phase = this.round % rounds === 0 ? 'long' : 'short';
        } else {
            this.round = this.phase === 'long' ? 1 : this.round + 1;
            this.phase = 'focus';
        }
        this.remaining = this.total;
        this.running = auto && this._settings.get_boolean('pomodoro-auto');
        if (this.running && !this._id)
            this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._tick());
        this._render();
        this._onChange(auto);
    }

    _tick() {
        if (!this.running) {
            this._id = 0;
            return GLib.SOURCE_REMOVE;
        }
        this.remaining -= 1;
        if (this.remaining <= 0) {
            this._id = 0;
            this.skip(true);
            return GLib.SOURCE_REMOVE;
        }
        this._render();
        this._onChange();
        return GLib.SOURCE_CONTINUE;
    }

    _render() {
        const m = Math.floor(this.remaining / 60);
        const s = this.remaining % 60;
        this.timeLabel.text = `${m}:${String(s).padStart(2, '0')}`;
        this.phaseLabel.text = {
            focus: t('Focus', 'Concentration'),
            short: t('Short break', 'Pause courte'),
            long: t('Long break', 'Pause longue'),
        }[this.phase];
        this.startButton.label = this.running ? t('Pause', 'Pause') : t('Start', 'Démarrer');
        this.dots.destroy_all_children();
        const rounds = this._settings.get_int('pomodoro-rounds');
        for (let i = 1; i <= rounds; i++) {
            const done = i < this.round || (i === this.round && this.phase !== 'focus');
            this.dots.add_child(new St.Widget({
                style_class: i === this.round ? 'gnomac-notch-dot active'
                    : (done ? 'gnomac-notch-dot done' : 'gnomac-notch-dot'),
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }

    destroy() {
        this.running = false;
        if (this._id) {
            GLib.source_remove(this._id);
            this._id = 0;
        }
    }
}

// ---------------------------------------------------------------- shelf

export class Shelf {
    constructor() {
        this.files = [];
        this.actor = new St.BoxLayout({style_class: 'gnomac-notch-shelf'});
        this._empty = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gnomac-notch-shelf-empty'});
        this._empty.add_child(new St.Label({
            text: t('Keep files handy: drag desktop icons here, or paste files copied in Files',
                'Garde des fichiers à portée : glisse ici des icônes du bureau, ou colle des fichiers copiés dans Fichiers'),
            style_class: 'gnomac-notch-subtitle', x_align: Clutter.ActorAlign.CENTER}));
        const paste = new St.Button({label: t('Paste Files', 'Coller des fichiers'),
            style_class: 'gnomac-notch-pill-button', can_focus: false, x_align: Clutter.ActorAlign.CENTER});
        paste.connect('clicked', () => this.paste());
        this._empty.add_child(paste);
        this.actor.add_child(this._empty);
    }

    add(uri) {
        if (this.files.includes(uri))
            return;
        this.files.push(uri);
        this._render();
    }

    remove(uri) {
        this.files = this.files.filter(f => f !== uri);
        this._render();
    }

    // Files copied in the Files app (x-special/gnome-copied-files) or a URI list.
    paste() {
        const clipboard = St.Clipboard.get_default();
        const take = bytes => {
            const text = bytes ? new TextDecoder().decode(bytes.get_data?.() ?? bytes) : '';
            for (const line of text.split('\n').map(l => l.trim()).filter(l => l.startsWith('file://')))
                this.add(line);
        };
        clipboard.get_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files', (_c, bytes) => {
            if (bytes && bytes.get_size?.() > 0)
                take(bytes);
            else
                clipboard.get_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', (_c2, list) => take(list));
        });
    }

    _render() {
        this.actor.destroy_all_children();
        if (!this.files.length) {
            this.actor.add_child(this._empty);
            return;
        }
        for (const uri of this.files.slice(-6)) {
            const file = Gio.File.new_for_uri(uri);
            let gicon = null;
            try {
                gicon = file.query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null).get_icon();
            } catch {}
            const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            const fileIcon = new St.Icon({icon_size: 32, x_align: Clutter.ActorAlign.CENTER});
            if (gicon)
                fileIcon.gicon = gicon;
            else
                fileIcon.icon_name = 'text-x-generic';
            column.add_child(fileIcon);
            column.add_child(new St.Label({text: file.get_basename().slice(0, 12),
                style_class: 'gnomac-notch-cal-head', x_align: Clutter.ActorAlign.CENTER}));
            const button = new St.Button({style_class: 'gnomac-notch-shelf-item', child: column,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE});
            button.connect('clicked', (_b, mouseButton) => {
                if (mouseButton === 3) {
                    // Right click: copy it to the desktop, or let it go.
                    this._itemMenu(uri, button);
                    return;
                }
                Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
            });
            this.actor.add_child(button);
        }
    }

    _itemMenu(uri, button) {
        const desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        const file = Gio.File.new_for_uri(uri);
        const popup = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gnomac-notch-shelf-menu'});
        const entry = (label, action) => {
            const b = new St.Button({label, style_class: 'gnomac-notch-pill-button', can_focus: false});
            b.connect('clicked', () => {
                popup.destroy();
                action();
            });
            popup.add_child(b);
        };
        if (desktop && file.get_path()) {
            entry(t('Copy to Desktop', 'Copier sur le bureau'), () => {
                try {
                    Gio.Subprocess.new(['cp', '-rn', '--', file.get_path(), `${desktop}/`], Gio.SubprocessFlags.NONE);
                } catch {}
            });
        }
        entry(t('Remove', 'Retirer'), () => this.remove(uri));
        button.get_parent().add_child(popup);
    }
}
