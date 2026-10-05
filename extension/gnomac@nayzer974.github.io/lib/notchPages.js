// More Dynamic Island pages: system stats, quick actions, clipboard, and the
// "idle home" shown in place of the player when nothing is playing.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {clearClipboard, clipboardItems, copyText, onClipboardChange} from './clipboardHistory.js';
import {COLORS, colorChip, press} from './motion.js';
import {t} from './i18n.js';

// ---------------------------------------------------------------- helpers

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch {
        return '';
    }
}

function run(argv) {
    return new Promise(resolve => {
        try {
            const proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    resolve({ok: p.get_successful(), out: out ?? ''});
                } catch {
                    resolve({ok: false, out: ''});
                }
            });
        } catch {
            resolve({ok: false, out: ''});
        }
    });
}

function bar(styleClass = 'gnomac-notch-track') {
    const track = new St.Widget({style_class: styleClass, x_expand: true,
        y_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout()});
    const fill = new St.Widget({style_class: 'gnomac-notch-fill', x_align: Clutter.ActorAlign.START, y_expand: true});
    track.add_child(fill);
    return {track, fill};
}

// ---------------------------------------------------------------- stats

export class StatsPage {
    constructor() {
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-stats', x_expand: true});
        this._prevCpu = null;
        this._prevNet = null;
        this._rows = {};
        for (const [id, label] of [['cpu', t('Processor', 'Processeur')], ['mem', t('Memory', 'Mémoire')],
            ['disk', t('Disk', 'Disque')]]) {
            const row = new St.BoxLayout({style_class: 'gnomac-notch-stat-row'});
            const name = new St.Label({text: label, style_class: 'gnomac-notch-stat-name', y_align: Clutter.ActorAlign.CENTER});
            const meter = bar();
            const value = new St.Label({style_class: 'gnomac-notch-stat-value', y_align: Clutter.ActorAlign.CENTER});
            for (const child of [name, meter.track, value])
                row.add_child(child);
            this.actor.add_child(row);
            this._rows[id] = {fill: meter.fill, track: meter.track, value};
        }
        this.net = new St.Label({style_class: 'gnomac-notch-subtitle', x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this.net);
    }

    _setRow(id, fraction, text) {
        const row = this._rows[id];
        row.value.text = text;
        row.fill.set_width(Math.round(Math.max(0, Math.min(1, fraction)) * (row.track.width || 160)));
    }

    update() {
        // CPU: busy share of the time since the last sample.
        const fields = readFile('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
        const total = fields.reduce((a, b) => a + b, 0);
        if (this._prevCpu) {
            const dTotal = total - this._prevCpu.total;
            const dIdle = idle - this._prevCpu.idle;
            const cpu = dTotal > 0 ? 1 - dIdle / dTotal : 0;
            this._setRow('cpu', cpu, `${Math.round(cpu * 100)} %`);
        }
        this._prevCpu = {total, idle};

        const meminfo = readFile('/proc/meminfo');
        const memTotal = Number((meminfo.match(/MemTotal:\s+(\d+)/) ?? [])[1] ?? 0);
        const memAvail = Number((meminfo.match(/MemAvailable:\s+(\d+)/) ?? [])[1] ?? 0);
        if (memTotal)
            this._setRow('mem', 1 - memAvail / memTotal, `${((memTotal - memAvail) / 1048576).toFixed(1)} / ${(memTotal / 1048576).toFixed(1)} ${t('GB', 'Go')}`);

        try {
            const info = Gio.File.new_for_path('/').query_filesystem_info('filesystem:size,filesystem:free', null);
            const size = info.get_attribute_uint64('filesystem::size');
            const free = info.get_attribute_uint64('filesystem::free');
            this._setRow('disk', 1 - free / size, `${Math.round((size - free) / 1e9)} / ${Math.round(size / 1e9)} ${t('GB', 'Go')}`);
        } catch {}

        // Network: bytes per second since the last sample.
        let rx = 0;
        let tx = 0;
        for (const line of readFile('/proc/net/dev').split('\n').slice(2)) {
            const [iface, rest] = line.split(':');
            if (!rest || iface.trim() === 'lo')
                continue;
            const cols = rest.trim().split(/\s+/).map(Number);
            rx += cols[0] ?? 0;
            tx += cols[8] ?? 0;
        }
        const now = GLib.get_monotonic_time();
        if (this._prevNet) {
            const dt = (now - this._prevNet.time) / 1e6;
            const fmt = bytes => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo/s` : `${Math.round(bytes / 1024)} Ko/s`;
            this.net.text = `↓ ${fmt((rx - this._prevNet.rx) / dt)}    ↑ ${fmt((tx - this._prevNet.tx) / dt)}`;
        }
        this._prevNet = {rx, tx, time: now};
    }
}

// ---------------------------------------------------------------- quick actions

const TOGGLES = [
    {
        id: 'wifi', icon: 'network-wireless-symbolic', label: 'Wi-Fi', color: COLORS.blue,
        get: async () => {
            const r = await run(['nmcli', '-t', '-f', 'WIFI', 'general']);
            return r.ok ? r.out.trim() === 'enabled' : null;
        },
        set: on => run(['nmcli', 'radio', 'wifi', on ? 'on' : 'off']),
    },
    {
        id: 'bluetooth', icon: 'bluetooth-symbolic', label: 'Bluetooth', color: COLORS.blue,
        get: async () => {
            const r = await run(['bluetoothctl', 'show']);
            return r.ok && r.out ? /Powered:\s+yes/.test(r.out) : null;
        },
        set: on => run(['bluetoothctl', 'power', on ? 'on' : 'off']),
    },
    {
        id: 'dnd', icon: 'notifications-disabled-symbolic', label: t('Do Not Disturb', 'Ne pas déranger'), color: COLORS.purple,
        settings: ['org.gnome.desktop.notifications', 'show-banners', true],
    },
    {
        id: 'dark', icon: 'weather-clear-night-symbolic', label: t('Dark Mode', 'Mode sombre'), color: COLORS.indigo,
        get: async () => new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_string('color-scheme') === 'prefer-dark',
        set: async on => new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .set_string('color-scheme', on ? 'prefer-dark' : 'default'),
    },
    {
        id: 'night', icon: 'night-light-symbolic', label: t('Night Shift', 'Lumière nocturne'), color: COLORS.orange,
        get: async () => new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'})
            .get_boolean('night-light-enabled'),
        set: async on => new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'})
            .set_boolean('night-light-enabled', on),
    },
];

const ACTIONS = [
    {id: 'shot', icon: 'applets-screenshooter-symbolic', label: t('Screenshot', 'Capture'),
        run: () => Main.screenshotUI.open().catch(logError)},
    {id: 'lock', icon: 'system-lock-screen-symbolic', label: t('Lock', 'Verrouiller'),
        run: () => Main.screenShield.lock(true)},
    {id: 'settings', icon: 'emblem-system-symbolic', label: t('Settings', 'Réglages'),
        run: () => Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop')?.activate()},
];

function chip(def) {
    if (def.run) {
        // Plain action: no state, just the press feel.
        const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER});
        column.add_child(new St.Icon({icon_name: def.icon, icon_size: 18, x_align: Clutter.ActorAlign.CENTER}));
        column.add_child(new St.Label({text: def.label, style_class: 'gnomac-chip-label',
            x_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'gnomac-chip', child: column, can_focus: false});
        return press(button);
    }
    return colorChip({icon: def.icon, label: def.label, color: def.color ?? COLORS.blue});
}

export class ActionsPage {
    constructor(onDone) {
        this._onDone = onDone;
        this.actor = new St.Widget({style_class: 'gnomac-notch-actions',
            layout_manager: new Clutter.GridLayout({column_spacing: 8, row_spacing: 8,
                column_homogeneous: true, row_homogeneous: true}), x_expand: true});
        this._buttons = new Map();
        const layout = this.actor.layout_manager;
        [...TOGGLES, ...ACTIONS].forEach((def, i) => {
            const button = chip(def);
            if (def.run) {
                button.connect('clicked', () => {
                    this._onDone();
                    def.run();
                });
            } else {
                button.connect('clicked', async () => {
                    const on = button.checked;
                    button.setActive(on);
                    try {
                        if (def.settings) {
                            const [schema, key, invert] = def.settings;
                            new Gio.Settings({schema_id: schema}).set_boolean(key, invert ? !on : on);
                        } else {
                            await def.set(on);
                        }
                    } catch (e) {
                        logError(e, `GNOMAC toggle ${def.id}`);
                    }
                    this.refresh();
                });
                this._buttons.set(def.id, [def, button]);
            }
            layout.attach(button, i % 4, Math.floor(i / 4), 1, 1);
        });
    }

    async refresh() {
        for (const [def, button] of this._buttons.values()) {
            let state = null;
            if (def.settings) {
                const [schema, key, invert] = def.settings;
                const value = new Gio.Settings({schema_id: schema}).get_boolean(key);
                state = invert ? !value : value;
            } else {
                state = await def.get();
            }
            button.reactive = state !== null;
            button.opacity = state === null ? 90 : 255;
            button.setActive(!!state, button.checked !== !!state);
        }
    }
}

// ---------------------------------------------------------------- clipboard

export class ClipboardPage {
    constructor() {
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-clipboard', x_expand: true});
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        const clear = new St.Button({style_class: 'gnomac-notch-pill-button', can_focus: false,
            label: t('Clear', 'Effacer'), x_align: Clutter.ActorAlign.END});
        clear.connect('clicked', () => clearClipboard());
        this.actor.add_child(this._list);
        this.actor.add_child(clear);
        this._off = onClipboardChange(() => this.refresh());
        this.refresh();
    }

    refresh() {
        this._list.destroy_all_children();
        const items = clipboardItems().slice(0, 4);
        if (!items.length) {
            this._list.add_child(new St.Label({
                text: t('Copied text will show up here.', 'Le texte copié apparaît ici.'),
                style_class: 'gnomac-notch-subtitle'}));
            return;
        }
        for (const text of items) {
            const row = new St.Button({style_class: 'gnomac-notch-clip-row', can_focus: false,
                label: text.replace(/\s+/g, ' ').slice(0, 70), x_align: Clutter.ActorAlign.FILL});
            row.connect('clicked', () => copyText(text));
            this._list.add_child(row);
        }
    }

    destroy() {
        this._off?.();
    }
}

// ---------------------------------------------------------------- idle home

// Shown on the Home page in place of the player when nothing is playing:
// a big clock, the date, and one-tap chips.
export class IdleHome {
    constructor(onDone) {
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'gnomac-notch-idle'});
        this.time = new St.Label({style_class: 'gnomac-notch-idle-time'});
        this.date = new St.Label({style_class: 'gnomac-notch-subtitle'});
        this.actor.add_child(this.time);
        this.actor.add_child(this.date);
        this._actions = new ActionsPage(onDone);
        // Only the first four tiles: Wi-Fi, Bluetooth, DND, dark mode.
        this._strip = new St.BoxLayout({style_class: 'gnomac-notch-idle-chips'});
        this._chips = [];
        for (const def of [TOGGLES[2], TOGGLES[3], ACTIONS[0], ACTIONS[1]]) {
            const button = chip(def);
            if (def.run) {
                button.connect('clicked', () => {
                    onDone();
                    def.run();
                });
            } else {
                button.connect('clicked', () => {
                    const on = button.checked;
                    button.setActive(on);
                    if (def.settings) {
                        const [schema, key, invert] = def.settings;
                        new Gio.Settings({schema_id: schema}).set_boolean(key, invert ? !on : on);
                    } else {
                        def.set(on);
                    }
                });
                this._chips.push([def, button]);
            }
            this._strip.add_child(button);
        }
        this.actor.add_child(this._strip);
    }

    async update() {
        const now = GLib.DateTime.new_now_local();
        this.time.text = now.format('%H:%M');
        this.date.text = now.format('%A %-d %B');
        for (const [def, button] of this._chips) {
            let state;
            if (def.settings) {
                const [schema, key, invert] = def.settings;
                const value = new Gio.Settings({schema_id: schema}).get_boolean(key);
                state = invert ? !value : value;
            } else {
                state = await def.get();
            }
            button.setActive(!!state, button.checked !== !!state);
        }
    }
}
