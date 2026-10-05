// Desktop widgets (macOS 27): glass tiles on the wallpaper, under every
// window. Battery ring, month calendar, and editable reminders.
//
// They live in the background group, so windows cover them and the overview
// treats them as part of the wallpaper.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassSurface, glassParamsFromSettings} from '../lib/glass.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

import {MonthCalendar} from '../lib/notchViews.js';
import {WeatherSource} from '../lib/weather.js';
import {t} from '../lib/i18n.js';

const RADIUS = 22;
const GAP = 12;

const UPOWER = `<node><interface name="org.freedesktop.UPower.Device">
  <property name="Type" type="u" access="read"/>
  <property name="State" type="u" access="read"/>
  <property name="Percentage" type="d" access="read"/>
  <property name="IsPresent" type="b" access="read"/>
</interface></node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER);

class Tile {
    constructor(settings, width, height) {
        this.width = width;
        this.height = height;
        this.actor = new St.Widget({width, height, reactive: true});
        this.glass = new GlassSurface({
            backdrop: 'wallpaper',
            blur: Math.max(settings.get_int('glass-blur'), 40),
            glass: {...glassParamsFromSettings(settings, RADIUS), refraction: 8, chroma: 0.8, rim: 0.4},
        });
        this.glass.set_size(width, height);
        this.actor.add_child(this.glass);
        this.content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-widget', width, height});
        this.actor.add_child(this.content);
    }

    place(x, y) {
        this.actor.set_position(x, y);
        this.glass.setStageOrigin(x, y);
    }
}

export class Widgets {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._tiles = [];
    }

    enable() {
        this._build();
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place());
        this._overviewIds = [
            Main.overview.connect('showing', () => this._tiles.forEach(tile => tile.actor.hide())),
            Main.overview.connect('hidden', () => this._tiles.forEach(tile => tile.actor.show())),
        ];
        // The calendar rolls over at midnight; the battery follows UPower.
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._calendar?.update();
            return GLib.SOURCE_CONTINUE;
        });
        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', (proxy, error) => {
                if (error || !this._tiles.length)
                    return;
                this._upower = proxy;
                this._upowerId = proxy.connect('g-properties-changed', () => this._syncBattery());
                this._syncBattery();
            });
    }

    disable() {
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        for (const id of this._overviewIds ?? [])
            Main.overview.disconnect(id);
        this._overviewIds = [];
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._weather?.stop();
        this._weather = null;
        for (const id of this._mprisIds ?? [])
            this._mpris?.disconnect(id);
        this._mprisIds = [];
        this._mpris = null;
        if (this._upower && this._upowerId)
            this._upower.disconnect(this._upowerId);
        this._upower = null;
        this._upowerId = 0;
        for (const tile of this._tiles)
            tile.actor.destroy();
        this._tiles = [];
        this._calendar = null;
    }

    _build() {
        const settings = this._settings;
        const group = Main.layoutManager._backgroundGroup;

        // Battery.
        this._battery = new Tile(settings, 170, 118);
        this._ring = new St.DrawingArea({width: 44, height: 44, y_align: Clutter.ActorAlign.CENTER});
        this._ring.connect('repaint', area => this._paintRing(area));
        this._batteryLabel = new St.Label({style_class: 'gnomac-widget-big', x_align: Clutter.ActorAlign.CENTER});
        const batteryTop = new St.BoxLayout({style_class: 'gnomac-widget-row'});
        batteryTop.add_child(this._ring);
        const batteryText = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        batteryText.add_child(this._batteryLabel);
        this._batteryState = new St.Label({style_class: 'gnomac-widget-caption'});
        batteryText.add_child(this._batteryState);
        batteryTop.add_child(batteryText);
        this._battery.content.add_child(new St.Label({text: t('Battery', 'Batterie'),
            style_class: 'gnomac-widget-title'}));
        this._battery.content.add_child(batteryTop);

        // Calendar.
        this._calendarTile = new Tile(settings, 214, 240);
        this._calendar = new MonthCalendar();
        this._calendarTile.content.add_child(this._calendar.actor);
        this._calendar.update();

        // Reminders.
        // Same bottom edge as the calendar: 118 + GAP + this = 240.
        this._remindersTile = new Tile(settings, 170, 240 - 118 - GAP);
        this._remindersTile.content.add_child(new St.Label({text: t('Reminders', 'Rappels'),
            style_class: 'gnomac-widget-title'}));
        this._remindersList = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-widget-list'});
        this._remindersTile.content.add_child(this._remindersList);
        this._entry = new St.Entry({style_class: 'gnomac-widget-entry',
            hint_text: t('New reminder', 'Nouveau rappel'), can_focus: true});
        this._entry.clutter_text.connect('activate', () => {
            const text = this._entry.text.trim();
            if (text) {
                this._settings.set_strv('widget-reminders', [...this._settings.get_strv('widget-reminders'), text]);
                this._entry.text = '';
                this._renderReminders();
            }
        });
        this._remindersTile.content.add_child(this._entry);
        this._renderReminders();

        // Weather (optional) and now playing, on a second row.
        this._tiles = [this._battery, this._calendarTile, this._remindersTile];
        if (settings.get_boolean('widget-weather')) {
            this._weatherTile = new Tile(settings, 170, 118);
            this._weatherTile.content.add_child(new St.Label({text: t('Weather', 'Météo'),
                style_class: 'gnomac-widget-title'}));
            const row = new St.BoxLayout({style_class: 'gnomac-widget-row'});
            this._weatherIcon = new St.Icon({icon_size: 34, y_align: Clutter.ActorAlign.CENTER});
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
            this._weatherTemp = new St.Label({style_class: 'gnomac-widget-big'});
            this._weatherCaption = new St.Label({style_class: 'gnomac-widget-caption'});
            text.add_child(this._weatherTemp);
            text.add_child(this._weatherCaption);
            row.add_child(this._weatherIcon);
            row.add_child(text);
            this._weatherTile.content.add_child(row);
            this._weatherRange = new St.Label({style_class: 'gnomac-widget-caption'});
            this._weatherTile.content.add_child(this._weatherRange);
            this._weatherTemp.text = '…';
            this._tiles.push(this._weatherTile);
            this._weather = new WeatherSource(settings, () => this._syncWeather());
            this._weather.start();
        }

        this._musicTile = new Tile(settings, 214, 118);
        this._musicTitle = new St.Label({style_class: 'gnomac-widget-music-title'});
        this._musicArtist = new St.Label({style_class: 'gnomac-widget-caption'});
        const controls = new St.BoxLayout({style_class: 'gnomac-widget-music-controls'});
        const button = (icon, action) => {
            const b = new St.Button({style_class: 'gnomac-widget-music-button', can_focus: false,
                child: new St.Icon({icon_name: icon, icon_size: 16})});
            b.connect('clicked', () => action());
            controls.add_child(b);
            return b;
        };
        button('media-skip-backward-symbolic', () => this._player?.previous());
        this._playButton = button('media-playback-start-symbolic', () => this._player?.playPause());
        button('media-skip-forward-symbolic', () => this._player?.next());
        this._musicTile.content.add_child(new St.Label({text: t('Now Playing', 'Lecture en cours'),
            style_class: 'gnomac-widget-title'}));
        this._musicTile.content.add_child(this._musicTitle);
        this._musicTile.content.add_child(this._musicArtist);
        this._musicTile.content.add_child(controls);
        this._tiles.push(this._musicTile);
        this._mpris = new Mpris.MprisSource();
        this._mprisIds = [
            this._mpris.connect('player-added', (_s, player) => this._watchPlayer(player)),
            this._mpris.connect('player-removed', () => this._pickPlayer()),
        ];
        for (const player of this._mpris.players)
            this._watchPlayer(player);
        this._syncMusic();

        for (const tile of this._tiles)
            group.add_child(tile.actor);
        this._place();
    }

    _watchPlayer(player) {
        player.connectObject('changed', () => {
            if (player.status === 'Playing' || !this._player)
                this._player = player;
            this._syncMusic();
        }, this);
        if (player.status === 'Playing' || !this._player)
            this._player = player;
        this._syncMusic();
    }

    _pickPlayer() {
        this._player = this._mpris?.players.find(p => p.status === 'Playing') ?? this._mpris?.players[0] ?? null;
        this._syncMusic();
    }

    _syncMusic() {
        if (!this._musicTitle || this._musicTitle.is_finalized?.())
            return;
        const player = this._player;
        const active = !!player && player.canPlay;
        this._musicTitle.text = active ? (player.trackTitle || t('Unknown title', 'Titre inconnu'))
            : t('Nothing playing', 'Aucune lecture');
        this._musicArtist.text = active ? (player.trackArtists ?? []).join(', ') : '';
        this._playButton.child.icon_name = active && player.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    }

    _syncWeather() {
        const data = this._weather?.data;
        if (!data || !this._weatherTemp)
            return;
        this._weatherTemp.text = `${data.temp}°`;
        this._weatherIcon.icon_name = data.icon;
        this._weatherCaption.text = data.city || data.description;
        this._weatherRange.text = `${data.description} · ${data.high}° / ${data.low}°`;
    }

    // XXL widgets (macOS 27): the whole cluster scales; positions follow.
    get _scale() {
        return {standard: 1, large: 1.25, xxl: 1.5}[this._settings.get_string('widget-size')] ?? 1;
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || this._tiles.length < 3)
            return;
        const k = this._scale;
        const gap = this._settings.get_int('window-gap');
        const x = monitor.x + gap + 18;
        const y = monitor.y + Main.panel.height + gap + 18;
        const at = (tile, dx, dy) => {
            tile.actor.set_pivot_point(0, 0);
            tile.actor.set_scale(k, k);
            tile.place(x + dx * k, y + dy * k);
        };
        at(this._battery, 0, 0);
        at(this._remindersTile, 0, 118 + GAP);
        at(this._calendarTile, 170 + GAP, 0);
        if (this._weatherTile)
            at(this._weatherTile, 0, 240 + GAP);
        at(this._musicTile, this._weatherTile ? 170 + GAP : 0, 240 + GAP);
    }

    _renderReminders() {
        this._remindersList.destroy_all_children();
        const items = this._settings.get_strv('widget-reminders');
        this._remindersTile.content.get_first_child().text =
            items.length ? `${items.length} ${t('Reminders', 'Rappels')}` : t('Reminders', 'Rappels');
        items.slice(-4).forEach(text => {
            const row = new St.BoxLayout({style_class: 'gnomac-widget-reminder'});
            const done = new St.Button({style_class: 'gnomac-widget-check', can_focus: false});
            done.connect('clicked', () => {
                const all = this._settings.get_strv('widget-reminders');
                const index = all.lastIndexOf(text);
                if (index >= 0)
                    all.splice(index, 1);
                this._settings.set_strv('widget-reminders', all);
                this._renderReminders();
            });
            row.add_child(done);
            row.add_child(new St.Label({text, style_class: 'gnomac-widget-text', y_align: Clutter.ActorAlign.CENTER}));
            this._remindersList.add_child(row);
        });
    }

    _paintRing(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const percent = (this._upower?.Percentage ?? 0) / 100;
        const charging = this._upower?.State === 1;
        cr.setLineWidth(6);
        cr.setSourceRGBA(1, 1, 1, 0.18);
        cr.arc(w / 2, h / 2, w / 2 - 5, 0, 2 * Math.PI);
        cr.stroke();
        if (charging)
            cr.setSourceRGBA(0.19, 0.82, 0.35, 1);
        else if (percent <= 0.2)
            cr.setSourceRGBA(1, 0.27, 0.23, 1);
        else
            cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.setLineCap(1);
        cr.arc(w / 2, h / 2, w / 2 - 5, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * percent);
        cr.stroke();
        cr.$dispose();
    }

    _syncBattery() {
        const p = this._upower;
        if (!p || !this._batteryLabel)
            return;
        const present = p.IsPresent && p.Type === 2;
        this._batteryLabel.text = present ? `${Math.round(p.Percentage)} %` : '—';
        this._batteryState.text = !present
            ? t('Plugged in', 'Sur secteur')
            : (p.State === 1 ? t('Charging', 'En charge') : t('On battery', 'Sur batterie'));
        this._ring.queue_repaint();
    }
}
