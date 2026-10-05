// Dynamic Island, modelled on RevoShell's: not a floating pill but a notch
// hanging from the top edge of the screen, flat against it, with concave
// "ears" blending into the edge and rounded bottom corners.
//  - resting: artwork + equalizer on the left, the time in the middle,
//    an unread-notification badge on the right (always visible),
//  - hover / click with a player: grows into a media card (title, artist,
//    app icon, progress bar, transport controls),
//  - hover without a player: widens to show the full date,
//  - workspace switch: the time briefly becomes workspace dots,
//  - notification (optional setting): grows into a notification card.
// Width and height ride springs; the shape is redrawn with Cairo.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const EAR = 7;
const SIZES = {
    rest: {width: 156, height: 24},
    date: {width: 290, height: 24},
    media: {width: 400, height: 132},
    notice: {width: 400, height: 78},
};
const NOTICE_MS = 4000;
const WORKSPACE_MS = 1400;
const BARS = 4;

function coverStyle(url, size) {
    const base = `width: ${size}px; height: ${size}px; border-radius: ${size / 2}px;`;
    if (!url || !url.startsWith('file://'))
        return `${base} background-color: rgba(255,255,255,0.16);`;
    return `${base} background-image: url("${url}"); background-size: cover;`;
}

function formatTime(us) {
    const s = Math.max(0, Math.floor(us / 1e6));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Flat top on the screen edge, concave ears, round bottom corners.
function drawNotch(area) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const e = Math.min(EAR, h / 2);
    const r = Math.max(1, Math.min(h - e, (w - 2 * e) / 2, 22));
    cr.moveTo(0, 0);
    cr.lineTo(w, 0);
    cr.arcNegative(w, e, e, -Math.PI / 2, -Math.PI);
    cr.lineTo(w - e, h - r);
    cr.arc(w - e - r, h - r, r, 0, Math.PI / 2);
    cr.lineTo(e + r, h);
    cr.arc(e + r, h - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(e, e);
    cr.arcNegative(0, e, e, 0, -Math.PI / 2);
    cr.closePath();
    cr.setSourceRGBA(0, 0, 0, 1);
    cr.fill();
    cr.$dispose();
}

function bars(count) {
    const box = new St.BoxLayout({style_class: 'gnomac-island-bars', y_align: Clutter.ActorAlign.CENTER});
    const actors = [];
    for (let i = 0; i < count; i++) {
        const bar = new St.Widget({style_class: 'gnomac-island-bar', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(bar);
        actors.push(bar);
    }
    return [box, actors];
}

const Island = GObject.registerClass(
class Island extends St.Widget {
    _init() {
        super._init({name: 'gnomacDynamicIsland', reactive: true, track_hover: true});

        this.shape = new St.DrawingArea({reactive: false});
        this.shape.connect('repaint', area => drawNotch(area));
        this.add_child(this.shape);

        // Resting row.
        this.rest = new St.Widget({layout_manager: new Clutter.BinLayout()});
        const left = new St.BoxLayout({style_class: 'gnomac-notch-side',
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
        this.restArt = new St.Widget({y_align: Clutter.ActorAlign.CENTER});
        [this.bars, this.barActors] = bars(BARS);
        left.add_child(this.restArt);
        left.add_child(this.bars);
        this.clock = new St.Label({style_class: 'gnomac-notch-clock',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.dots = new St.BoxLayout({style_class: 'gnomac-notch-dots', visible: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.badge = new St.BoxLayout({style_class: 'gnomac-notch-side',
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        this.badge.add_child(new St.Widget({style_class: 'gnomac-notch-badge-dot',
            y_align: Clutter.ActorAlign.CENTER}));
        this.badgeLabel = new St.Label({style_class: 'gnomac-notch-badge', y_align: Clutter.ActorAlign.CENTER});
        this.badge.add_child(this.badgeLabel);
        for (const child of [left, this.clock, this.dots, this.badge])
            this.rest.add_child(child);
        this.add_child(this.rest);

        // Media card.
        this.media = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomac-notch-media'});
        const top = new St.BoxLayout({style_class: 'gnomac-notch-media-top'});
        this.mediaArt = new St.Widget({reactive: true, y_align: Clutter.ActorAlign.CENTER});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.title = new St.Label({style_class: 'gnomac-notch-title'});
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.artist = new St.Label({style_class: 'gnomac-notch-subtitle'});
        this.artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(this.title);
        text.add_child(this.artist);
        [this.mediaBars, this.mediaBarActors] = bars(BARS);
        this.appIcon = new St.Icon({icon_size: 18, y_align: Clutter.ActorAlign.CENTER});
        for (const child of [this.mediaArt, text, this.mediaBars, this.appIcon])
            top.add_child(child);

        const progress = new St.BoxLayout({style_class: 'gnomac-notch-progress'});
        this.elapsed = new St.Label({style_class: 'gnomac-notch-time', y_align: Clutter.ActorAlign.CENTER});
        this.track = new St.Widget({style_class: 'gnomac-notch-track', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout()});
        this.fill = new St.Widget({style_class: 'gnomac-notch-fill', x_align: Clutter.ActorAlign.START,
            y_expand: true});
        this.track.add_child(this.fill);
        this.remaining = new St.Label({style_class: 'gnomac-notch-time', y_align: Clutter.ActorAlign.CENTER});
        for (const child of [this.elapsed, this.track, this.remaining])
            progress.add_child(child);

        const controls = new St.BoxLayout({style_class: 'gnomac-notch-controls',
            x_align: Clutter.ActorAlign.CENTER});
        this.prevButton = this._control('media-skip-backward-symbolic', 18);
        this.playButton = this._control('media-playback-pause-symbolic', 22);
        this.nextButton = this._control('media-skip-forward-symbolic', 18);
        for (const child of [this.prevButton, this.playButton, this.nextButton])
            controls.add_child(child);

        for (const child of [top, progress, controls])
            this.media.add_child(child);
        this.add_child(this.media);

        // Notification card.
        this.notice = new St.BoxLayout({style_class: 'gnomac-notch-notice'});
        this.noticeIcon = new St.Icon({icon_size: 32, y_align: Clutter.ActorAlign.CENTER});
        const noticeText = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this.noticeTitle = new St.Label({style_class: 'gnomac-notch-title'});
        this.noticeTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.noticeBody = new St.Label({style_class: 'gnomac-notch-subtitle'});
        this.noticeBody.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        noticeText.add_child(this.noticeTitle);
        noticeText.add_child(this.noticeBody);
        this.notice.add_child(this.noticeIcon);
        this.notice.add_child(noticeText);
        this.add_child(this.notice);
    }

    _control(iconName, size) {
        return new St.Button({
            style_class: 'gnomac-island-control',
            child: new St.Icon({icon_name: iconName, icon_size: size}),
            can_focus: true,
        });
    }
});

export class DynamicIsland {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._players = new Set();
        this._player = null;
        this._mode = 'rest';
        this._noticeUntil = 0;
        this._workspaceUntil = 0;
        this._pinned = false;
        this._phase = 0;
        this._position = 0;
        this._length = 0;
        this._tick = dt => this._onTick(dt);
        this._signals = [];
    }

    enable() {
        this.island = new Island();
        this.island.connect('destroy', () => (this._islandGone = true));
        Main.layoutManager.addTopChrome(this.island);

        this._width = new Spring({stiffness: 360, damping: 26, value: SIZES.rest.width});
        this._height = new Spring({stiffness: 360, damping: 26, value: SIZES.rest.height});

        this.island.connect('notify::hover', () => this._update());
        this.island.connect('button-release-event', (_a, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this._pinned = !this._pinned;
                this._update();
            }
            return Clutter.EVENT_STOP;
        });
        this.island.prevButton.connect('clicked', () => this._player?.previous());
        this.island.playButton.connect('clicked', () => this._player?.playPause());
        this.island.nextButton.connect('clicked', () => this._player?.next());
        this.island.mediaArt.connect('button-release-event', () => {
            this._player?.raise();
            return Clutter.EVENT_STOP;
        });

        this._source = new Mpris.MprisSource();
        this._connect(this._source, 'player-added', (_s, player) => this._addPlayer(player));
        this._connect(this._source, 'player-removed', (_s, player) => this._removePlayer(player));
        for (const player of this._source.players)
            this._addPlayer(player);

        this._connect(Main.messageTray, 'source-added', (_tray, source) => this._watchSource(source));
        for (const source of Main.messageTray.getSources?.() ?? [])
            this._watchSource(source);

        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._showWorkspaces());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._layout());
        this._connect(Main.overview, 'showing', () => this.island.hide());
        this._connect(Main.overview, 'hidden', () => {
            this.island.show();
            this._update();
        });

        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._syncContent();
            if (this._mode === 'media')
                this._pollPosition();
            return GLib.SOURCE_CONTINUE;
        });

        this._update();
    }

    disable() {
        getTicker().remove(this._tick);
        if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
        }
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {}
        }
        this._signals = [];
        for (const player of this._players)
            player.disconnectObject?.(this);
        this._players.clear();
        this._player = null;
        this._source = null;
        if (this.island) {
            if (!this._islandGone) {
                Main.layoutManager.removeChrome(this.island);
                this.island.destroy();
            }
            this.island = null;
        }
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _addPlayer(player) {
        if (this._players.has(player))
            return;
        this._players.add(player);
        player.connectObject('changed', () => this._onPlayerChanged(player), this);
        this._onPlayerChanged(player);
    }

    _removePlayer(player) {
        player.disconnectObject?.(this);
        this._players.delete(player);
        if (this._player === player)
            this._player = [...this._players][0] ?? null;
        this._update();
    }

    _onPlayerChanged(player) {
        if (player.status === 'Playing' || !this._player)
            this._player = player;
        this._update();
    }

    _hasMedia() {
        const p = this._player;
        return !!p && p.canPlay && (p.status === 'Playing' || p.status === 'Paused');
    }

    // GNOME's MprisPlayer does not track the position; ask the player.
    _pollPosition() {
        const player = this._player;
        const busName = player?._busName;
        if (!busName)
            return;
        Gio.DBus.session.call(busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null, Gio.DBusCallFlags.NONE, 500, null, (conn, res) => {
                try {
                    const [value] = conn.call_finish(res).deepUnpack();
                    this._position = Number(value.deepUnpack());
                } catch {
                    this._position = 0;
                }
                const metadata = player._playerProxy?.Metadata ?? {};
                const length = metadata['mpris:length'];
                this._length = length ? Number(length.deepUnpack?.() ?? length) : 0;
                this._syncProgress();
            });
    }

    _watchSource(source) {
        this._signals.push([source, source.connect('notification-added', (_src, notification) => {
            if (this._settings.get_boolean('island-notifications'))
                this._showNotice(notification);
            this._update();
        })]);
    }

    _showNotice(notification) {
        const island = this.island;
        island.noticeTitle.text = notification.title ?? '';
        island.noticeBody.text = (notification.body ?? '').replace(/\s+/g, ' ');
        island.noticeIcon.gicon = notification.gicon ?? notification.source?.icon ?? null;
        if (!island.noticeIcon.gicon)
            island.noticeIcon.icon_name = 'preferences-system-notifications-symbolic';
        this._noticeUntil = GLib.get_monotonic_time() + NOTICE_MS * 1000;
        this._update();
    }

    _showWorkspaces() {
        const manager = global.workspace_manager;
        const dots = this.island.dots;
        dots.destroy_all_children();
        const active = manager.get_active_workspace_index();
        for (let i = 0; i < manager.n_workspaces; i++) {
            dots.add_child(new St.Widget({
                style_class: i === active ? 'gnomac-notch-dot active' : 'gnomac-notch-dot',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        this._workspaceUntil = GLib.get_monotonic_time() + WORKSPACE_MS * 1000;
        this._update();
    }

    _wantedMode() {
        if (GLib.get_monotonic_time() < this._noticeUntil)
            return 'notice';
        if (this.island.hover || this._pinned)
            return this._hasMedia() ? 'media' : 'date';
        return 'rest';
    }

    _unread() {
        let count = 0;
        for (const source of Main.messageTray.getSources?.() ?? [])
            count += source.unseenCount ?? 0;
        return count;
    }

    _syncContent() {
        const island = this.island;
        if (!island || this._islandGone)
            return;
        const now = GLib.DateTime.new_now_local();
        const showDots = GLib.get_monotonic_time() < this._workspaceUntil;
        island.dots.visible = showDots;
        island.clock.visible = !showDots;
        island.clock.text = this._mode === 'date' ? now.format('%A %-d %B  %H:%M') : now.format('%H:%M');

        const unread = this._unread();
        island.badge.visible = unread > 0;
        island.badgeLabel.text = String(unread);

        const player = this._player;
        const media = this._hasMedia();
        island.restArt.visible = media;
        island.bars.visible = media;
        if (player && media) {
            island.restArt.set_style(coverStyle(player.trackCoverUrl, 16));
            island.mediaArt.set_style(coverStyle(player.trackCoverUrl, 40));
            island.title.text = player.trackTitle || t('Unknown title', 'Titre inconnu');
            island.artist.text = (player.trackArtists ?? []).join(', ');
            island.appIcon.gicon = player.app?.get_icon?.() ?? null;
            island.appIcon.visible = !!island.appIcon.gicon;
            island.playButton.child.icon_name = player.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
            island.prevButton.reactive = !!player.canGoPrevious;
            island.nextButton.reactive = !!player.canGoNext;
        }
    }

    _syncProgress() {
        const island = this.island;
        if (!island || this._islandGone)
            return;
        const length = this._length;
        const position = length ? Math.min(this._position, length) : this._position;
        island.elapsed.text = formatTime(position);
        island.remaining.text = length ? `-${formatTime(length - position)}` : '';
        const trackWidth = island.track.width;
        island.fill.set_width(length && trackWidth ? Math.round(trackWidth * position / length) : 0);
    }

    _update() {
        if (!this.island || this._islandGone)
            return;
        const mode = this._wantedMode();
        const changed = mode !== this._mode;
        this._mode = mode;
        this._syncContent();
        if (changed && mode === 'media')
            this._pollPosition();
        this._width.setTarget(SIZES[mode].width);
        this._height.setTarget(SIZES[mode].height);
        getTicker().add(this._tick);
    }

    _onTick(dt) {
        if (!this.island || this._islandGone)
            return false;
        this._width.step(dt);
        this._height.step(dt);
        this._phase += dt;

        const now = GLib.get_monotonic_time();
        if ((this._mode === 'notice' && now >= this._noticeUntil) ||
            (this.island.dots.visible && now >= this._workspaceUntil))
            this._update();

        this._layout();

        const playing = this._player?.status === 'Playing' && this._hasMedia();
        const timed = now < this._noticeUntil || now < this._workspaceUntil;
        return playing || timed || !this._width.settled || !this._height.settled;
    }

    _layout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this.island)
            return;
        const island = this.island;
        const width = Math.round(Math.max(SIZES.rest.height, this._width.value));
        const height = Math.round(Math.max(SIZES.rest.height, this._height.value));
        island.set_position(Math.round(monitor.x + (monitor.width - width) / 2), monitor.y);
        island.set_size(width, height);
        island.shape.set_size(width, height);
        island.shape.queue_repaint();

        const inner = width - 2 * EAR;
        for (const child of [island.rest, island.media, island.notice]) {
            child.set_position(EAR, 0);
            child.set_size(inner, height);
        }

        const grow = Math.min(1, Math.max(0,
            (height - SIZES.rest.height) / (SIZES.notice.height - SIZES.rest.height)));
        island.rest.opacity = Math.round(255 * (1 - grow));
        island.media.opacity = this._mode === 'media' ? Math.round(255 * grow) : 0;
        island.notice.opacity = this._mode === 'notice' ? Math.round(255 * grow) : 0;
        for (const child of [island.rest, island.media, island.notice])
            child.visible = child.opacity > 0;

        const playing = this._player?.status === 'Playing';
        const level = i => playing
            ? 0.3 + 0.7 * Math.abs(Math.sin(this._phase * (5.2 + i * 1.3) + i * 1.7))
            : 0.3;
        island.barActors.forEach((bar, i) => bar.set_height(Math.round(3 + 9 * level(i))));
        island.mediaBarActors.forEach((bar, i) => bar.set_height(Math.round(4 + 12 * level(i))));
    }
}
