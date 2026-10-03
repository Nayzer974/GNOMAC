// Dynamic Island (as in RevoShell's DynamicIsland.qml): a black pill at the
// top centre of the screen that lives with the session.
//  - idle: a small black notch, always there like RevoShell's island
//  - hover on idle: a mini dashboard with the time and date
//  - music playing: compact pill with artwork and an animated equalizer
//  - hover / click: expands with title, artist and transport controls
//  - notification: expands for a few seconds with its icon and text
// Width, height and corner radius all ride springs, so the island morphs
// between states instead of cross-fading boxes.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

import {Spring, getTicker} from '../lib/spring.js';
import {t} from '../lib/i18n.js';

const TOP = 4;
const COMPACT = {width: 190, height: 30};
const MEDIA = {width: 380, height: 116};
const NOTICE = {width: 380, height: 74};
const IDLE = {width: 126, height: 30};
const DASHBOARD = {width: 340, height: 96};
const NOTICE_MS = 4000;
const BARS = 4;

function artStyle(url, radius) {
    if (!url || !url.startsWith('file://'))
        return `border-radius: ${radius}px; background-color: rgba(255,255,255,0.12);`;
    return `border-radius: ${radius}px; background-image: url("${url}"); background-size: cover;`;
}

const Island = GObject.registerClass(
class Island extends St.Widget {
    _init() {
        super._init({
            name: 'gnomacDynamicIsland',
            style_class: 'gnomac-island',
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            visible: false,
        });

        // Compact row: artwork · title · equalizer.
        this.compact = new St.BoxLayout({style_class: 'gnomac-island-compact'});
        this.compactArt = new St.Widget({
            style_class: 'gnomac-island-compact-art',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.compactLabel = new St.Label({
            style_class: 'gnomac-island-compact-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.compactLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.bars = new St.BoxLayout({style_class: 'gnomac-island-bars', y_align: Clutter.ActorAlign.CENTER});
        this.barActors = [];
        for (let i = 0; i < BARS; i++) {
            const bar = new St.Widget({style_class: 'gnomac-island-bar', y_align: Clutter.ActorAlign.CENTER});
            this.bars.add_child(bar);
            this.barActors.push(bar);
        }
        this.compact.add_child(this.compactArt);
        this.compact.add_child(this.compactLabel);
        this.compact.add_child(this.bars);
        this.add_child(this.compact);

        // Expanded media card.
        this.media = new St.BoxLayout({style_class: 'gnomac-island-media'});
        this.mediaArt = new St.Widget({style_class: 'gnomac-island-media-art'});
        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'gnomac-island-media-text',
        });
        this.title = new St.Label({style_class: 'gnomac-island-title'});
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.artist = new St.Label({style_class: 'gnomac-island-artist'});
        this.artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(this.title);
        text.add_child(this.artist);

        const controls = new St.BoxLayout({style_class: 'gnomac-island-controls'});
        this.prevButton = this._control('media-skip-backward-symbolic');
        this.playButton = this._control('media-playback-start-symbolic');
        this.nextButton = this._control('media-skip-forward-symbolic');
        controls.add_child(this.prevButton);
        controls.add_child(this.playButton);
        controls.add_child(this.nextButton);
        text.add_child(controls);

        this.media.add_child(this.mediaArt);
        this.media.add_child(text);
        this.add_child(this.media);

        // Idle dashboard: big time and date.
        this.dash = new St.BoxLayout({style_class: 'gnomac-island-dash'});
        const dashText = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.dashTime = new St.Label({style_class: 'gnomac-island-dash-time'});
        this.dashDate = new St.Label({style_class: 'gnomac-island-artist'});
        dashText.add_child(this.dashTime);
        dashText.add_child(this.dashDate);
        this.dashHint = new St.Label({
            style_class: 'gnomac-island-dash-hint',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.dash.add_child(dashText);
        this.dash.add_child(this.dashHint);
        this.add_child(this.dash);

        // Notification card.
        this.notice = new St.BoxLayout({style_class: 'gnomac-island-notice'});
        this.noticeIcon = new St.Icon({style_class: 'gnomac-island-notice-icon', icon_size: 34});
        const noticeText = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.noticeTitle = new St.Label({style_class: 'gnomac-island-title'});
        this.noticeTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.noticeBody = new St.Label({style_class: 'gnomac-island-artist'});
        this.noticeBody.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        noticeText.add_child(this.noticeTitle);
        noticeText.add_child(this.noticeBody);
        this.notice.add_child(this.noticeIcon);
        this.notice.add_child(noticeText);
        this.add_child(this.notice);
    }

    _control(iconName) {
        const button = new St.Button({
            style_class: 'gnomac-island-control',
            child: new St.Icon({icon_name: iconName, icon_size: 18}),
            can_focus: true,
        });
        return button;
    }
});

export class DynamicIsland {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._players = new Set();
        this._player = null;
        this._mode = 'hidden';
        this._noticeUntil = 0;
        this._pinned = false;
        this._phase = 0;
        this._tick = dt => this._onTick(dt);
        this._signals = [];
    }

    enable() {
        this.island = new Island();
        this.island.connect('destroy', () => (this._islandGone = true));
        Main.layoutManager.addTopChrome(this.island);

        const spring = () => new Spring({stiffness: 320, damping: 24, value: 0});
        this._width = spring();
        this._height = spring();
        this._width.snap(COMPACT.width);
        this._height.snap(COMPACT.height);

        this.island.connect('notify::hover', () => this._update());
        this.island.connect('button-release-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this._pinned = !this._pinned;
                this._update();
            }
            return Clutter.EVENT_STOP;
        });
        this.island.prevButton.connect('clicked', () => this._player?.previous());
        this.island.playButton.connect('clicked', () => this._player?.playPause());
        this.island.nextButton.connect('clicked', () => this._player?.next());
        this.island.mediaArt.reactive = true;
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

        this._connect(Main.layoutManager, 'monitors-changed', () => this._layout());
        this._connect(Main.overview, 'showing', () => this.island.hide());
        this._connect(Main.overview, 'hidden', () => this._update());

        this._update();
    }

    disable() {
        getTicker().remove(this._tick);
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
            Main.layoutManager.removeChrome(this.island);
            this.island.destroy();
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
        // Follow whichever player is actually playing.
        if (player.status === 'Playing' || !this._player)
            this._player = player;
        this._update();
    }

    // Notifications go to the macOS banners by default; the island can show
    // them instead (RevoShell style) when the setting is on.
    _watchSource(source) {
        this._signals.push([source, source.connect('notification-added', (_src, notification) => {
            if (this._settings.get_boolean('island-notifications'))
                this._showNotice(notification);
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

    _wantedMode() {
        if (GLib.get_monotonic_time() < this._noticeUntil)
            return 'notice';
        const player = this._player;
        const always = this._settings.get_boolean('island-always-visible');
        const engaged = this.island.hover || this._pinned;
        const active = player?.canPlay && (player.status === 'Playing' || player.status === 'Paused');
        if (active)
            return engaged ? 'media' : 'compact';
        if (!always)
            return 'hidden';
        return engaged ? 'dashboard' : 'idle';
    }

    _syncContent() {
        const island = this.island;
        const player = this._player;
        const now = GLib.DateTime.new_now_local();
        island.dashTime.text = now.format('%H:%M');
        island.dashDate.text = now.format('%A %-d %B');
        island.dashHint.text = player?.canPlay
            ? t('Paused', 'En pause')
            : t('Nothing playing', 'Aucune lecture');
        if (player) {
            const title = player.trackTitle || t('Unknown title', 'Titre inconnu');
            const artists = (player.trackArtists ?? []).join(', ');
            island.compactLabel.text = title;
            island.title.text = title;
            island.artist.text = artists;
            island.compactArt.set_style(artStyle(player.trackCoverUrl, 6));
            island.mediaArt.set_style(artStyle(player.trackCoverUrl, 14));
            island.playButton.child.icon_name = player.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
            island.prevButton.reactive = !!player.canGoPrevious;
            island.nextButton.reactive = !!player.canGoNext;
        }
    }

    _update() {
        if (!this.island)
            return;
        this._syncContent();
        const mode = this._wantedMode();
        this._mode = mode;
        if (mode === 'hidden') {
            this._width.setTarget(COMPACT.height);
            this._height.setTarget(COMPACT.height);
        } else {
            const size = {compact: COMPACT, media: MEDIA, notice: NOTICE,
                idle: IDLE, dashboard: DASHBOARD}[mode];
            // Appearing: start from a dot and grow out of it. snap() also
            // resets the target, so it must come before setTarget().
            if (!this.island.visible && !Main.overview.visible) {
                this._width.snap(COMPACT.height);
                this._height.snap(COMPACT.height);
                this.island.show();
            }
            this._width.setTarget(size.width);
            this._height.setTarget(size.height);
        }
        getTicker().add(this._tick);
    }

    _onTick(dt) {
        // During shell shutdown the actor dies before disable() runs.
        if (!this.island || this._islandGone)
            return false;
        this._width.step(dt);
        this._height.step(dt);
        this._phase += dt;

        // Notice expiry is time based: re-evaluate while it is showing.
        if (this._mode === 'notice' && GLib.get_monotonic_time() >= this._noticeUntil)
            this._update();

        this._layout();

        const playing = this._mode === 'compact' && this._player?.status === 'Playing';
        if (this._mode === 'hidden' && this._width.settled && this._height.settled) {
            this.island.hide();
            return false;
        }
        return playing || this._mode === 'notice' || !this._width.settled || !this._height.settled;
    }

    _layout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const island = this.island;
        const width = Math.max(1, this._width.value);
        const height = Math.max(1, this._height.value);
        island.set_position(Math.round(monitor.x + (monitor.width - width) / 2), monitor.y + TOP);
        island.set_size(Math.round(width), Math.round(height));
        island.set_style(`border-radius: ${Math.round(Math.min(height / 2, 30))}px;`);

        // Cross-fade the three layouts according to how big the island is.
        const grow = Math.min(1, Math.max(0, (height - COMPACT.height) / (NOTICE.height - COMPACT.height)));
        island.compact.opacity = this._mode === 'compact' ? Math.round(255 * (1 - grow)) : 0;
        island.media.opacity = this._mode === 'media' ? Math.round(255 * grow) : 0;
        island.notice.opacity = this._mode === 'notice' ? Math.round(255 * grow) : 0;
        island.dash.opacity = this._mode === 'dashboard' ? Math.round(255 * grow) : 0;
        for (const child of [island.compact, island.media, island.notice, island.dash])
            child.visible = child.opacity > 0;

        for (const child of [island.compact, island.media, island.notice, island.dash]) {
            child.set_position(0, 0);
            child.set_size(Math.round(width), Math.round(height));
        }

        // Equalizer: four bars bouncing out of phase while music plays.
        const playing = this._player?.status === 'Playing';
        island.barActors.forEach((bar, i) => {
            const level = playing
                ? 0.35 + 0.65 * Math.abs(Math.sin(this._phase * (5.2 + i * 1.3) + i * 1.7))
                : 0.25;
            bar.set_height(Math.round(4 + 10 * level));
        });
    }
}
