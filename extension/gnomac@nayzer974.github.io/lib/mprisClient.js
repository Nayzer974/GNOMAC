// A small MPRIS client, straight over D-Bus, for the Dynamic Island.
//
// GNOME's own MprisSource hides what the island needs to be reliable with
// every player: browser tabs (YouTube) answer to Play/Pause/Seek but have no
// next/previous track, and a player's cover can be a web address. Talking to
// the players ourselves gives the island the exact state (can it pause? seek?
// skip a track?) and one place that decides which player the controls act on.
//
//   MprisWatcher   finds every org.mpris.MediaPlayer2.* on the session bus,
//                  tells when one appears, changes or goes, and picks the one
//                  to show (the one playing, else the last one used),
//   MprisPlayer    one player: its state, and PlayPause / Next / Previous /
//                  Seek / SetPosition / Raise as promises.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PREFIX = 'org.mpris.MediaPlayer2.';
const ROOT = 'org.mpris.MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PATH = '/org/mpris/MediaPlayer2';
const CALL_TIMEOUT_MS = 2000;

function proxy(busName, iface) {
    return new Promise((resolve, reject) => {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, busName, PATH, iface, null,
            (_source, result) => {
                try {
                    resolve(Gio.DBusProxy.new_for_bus_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function call(target, method, parameters = null) {
    return new Promise((resolve, reject) => {
        target.call(method, parameters, Gio.DBusCallFlags.NONE, CALL_TIMEOUT_MS, null, (source, result) => {
            try {
                resolve(source.call_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export class MprisPlayer {
    constructor(busName, onChange) {
        this.busName = busName;
        this._onChange = onChange;
        this._player = null;
        this._root = null;
        this._ids = [];
        this.lastActive = 0;   // when it last played or changed (monotonic, µs)
        this.ready = false;
    }

    async init() {
        this._player = await proxy(this.busName, PLAYER);
        this._ids.push(this._player.connect('g-properties-changed', () => this._changed()));
        // The root interface (name, desktop entry, Raise) is optional for us.
        try {
            this._root = await proxy(this.busName, ROOT);
        } catch {}
        this.ready = true;
        this._changed();
    }

    destroy() {
        for (const id of this._ids)
            this._player?.disconnect(id);
        this._ids = [];
        this._player = null;
        this._root = null;
        this.ready = false;
    }

    _changed() {
        if (this.status === 'Playing' || !this.lastActive)
            this.lastActive = GLib.get_monotonic_time();
        this._onChange?.(this);
    }

    _prop(name) {
        try {
            return this._player?.get_cached_property(name)?.recursiveUnpack();
        } catch {
            return undefined;
        }
    }

    get _metadata() {
        return this._prop('Metadata') ?? {};
    }

    get status() {
        return this._prop('PlaybackStatus') ?? 'Stopped';
    }

    get title() {
        return String(this._metadata['xesam:title'] ?? '');
    }

    get artists() {
        const artist = this._metadata['xesam:artist'];
        const list = Array.isArray(artist) ? artist : artist ? [artist] : [];
        return list.map(String).filter(Boolean);
    }

    get album() {
        return String(this._metadata['xesam:album'] ?? '');
    }

    get artUrl() {
        return String(this._metadata['mpris:artUrl'] ?? '');
    }

    // Microseconds, 0 for a live stream.
    get length() {
        const length = Number(this._metadata['mpris:length'] ?? 0);
        return Number.isFinite(length) && length > 0 ? length : 0;
    }

    get trackId() {
        const id = this._metadata['mpris:trackid'];
        return id ? String(id) : '';
    }

    // The capabilities as the player declares them. A player that does not
    // say (the property is missing) is assumed able, so its buttons stay live.
    _can(name) {
        const value = this._prop(name);
        return value === undefined ? true : !!value;
    }

    get canControl() {
        return this._can('CanControl');
    }

    get canPause() {
        return this._can('CanPause') || this._can('CanPlay');
    }

    // Skipping a track must be declared: a browser tab (YouTube) says no, and
    // the island then offers a 10 second jump instead.
    get canGoNext() {
        return !!this._prop('CanGoNext');
    }

    get canGoPrevious() {
        return !!this._prop('CanGoPrevious');
    }

    get canSeek() {
        return this._can('CanSeek');
    }

    // Something to show: it plays or is paused on a track.
    get hasMedia() {
        return this.ready && (this.status === 'Playing' || this.status === 'Paused') &&
            !!(this.title || this.artists.length || this.length);
    }

    get identity() {
        return String(this._root?.get_cached_property('Identity')?.recursiveUnpack() ?? '');
    }

    get desktopEntry() {
        return String(this._root?.get_cached_property('DesktopEntry')?.recursiveUnpack() ?? '');
    }

    // ------------------------------------------------------------ control

    // Play/pause. Some players ignore PlayPause; then the exact verb is sent.
    async playPause() {
        try {
            await call(this._player, 'PlayPause');
        } catch (e) {
            try {
                await call(this._player, this.status === 'Playing' ? 'Pause' : 'Play');
            } catch (e2) {
                log(`GNOMAC island: ${this.busName} refused play/pause: ${e2.message ?? e.message}`);
            }
        }
    }

    async next() {
        await call(this._player, 'Next').catch(e => log(`GNOMAC island: ${this.busName} Next: ${e.message}`));
    }

    async previous() {
        await call(this._player, 'Previous').catch(e => log(`GNOMAC island: ${this.busName} Previous: ${e.message}`));
    }

    // Relative jump, microseconds (negative = back).
    async seekBy(offset) {
        await call(this._player, 'Seek', new GLib.Variant('(x)', [Math.round(offset)]))
            .catch(e => log(`GNOMAC island: ${this.busName} Seek: ${e.message}`));
    }

    // Absolute position, microseconds. Needs a track id that is a valid
    // object path; otherwise it is done as a relative jump from the live position.
    async setPosition(position) {
        const id = this.trackId;
        if (id && GLib.Variant.is_object_path(id)) {
            try {
                await call(this._player, 'SetPosition', new GLib.Variant('(ox)', [id, Math.round(position)]));
                return;
            } catch {}
        }
        const now = await this.fetchPosition();
        await this.seekBy(position - now);
    }

    // Brings the player's window forward; false when it cannot.
    async raise() {
        try {
            await call(this._root, 'Raise');
            return true;
        } catch {
            return false;
        }
    }

    // The live position, microseconds (it is not a cached property: players
    // do not announce it while it moves).
    async fetchPosition() {
        try {
            const reply = await new Promise((resolve, reject) => {
                Gio.DBus.session.call(this.busName, PATH, 'org.freedesktop.DBus.Properties', 'Get',
                    new GLib.Variant('(ss)', [PLAYER, 'Position']), null, Gio.DBusCallFlags.NONE, 800, null,
                    (conn, res) => {
                        try {
                            resolve(conn.call_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
            });
            const [value] = reply.recursiveUnpack();
            return Number(value) || 0;
        } catch {
            return 0;
        }
    }
}

export class MprisWatcher {
    constructor(onChange) {
        this._onChange = onChange;   // (player | null) => void
        this._players = new Map();
        this._sub = 0;
        this._stopped = false;
    }

    get players() {
        return [...this._players.values()].filter(player => player.ready);
    }

    start() {
        this._stopped = false;
        try {
            this._sub = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
                'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
                (_c, _s, _p, _i, _n, params) => {
                    const [name, , owner] = params.deepUnpack();
                    if (!name.startsWith(PREFIX))
                        return;
                    if (owner)
                        this._add(name);
                    else
                        this._remove(name);
                });
        } catch (e) {
            log(`GNOMAC island: cannot watch MPRIS players: ${e.message}`);
        }
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deepUnpack();
                    for (const name of names) {
                        if (name.startsWith(PREFIX))
                            this._add(name);
                    }
                } catch (e) {
                    log(`GNOMAC island: cannot list MPRIS players: ${e.message}`);
                }
            });
    }

    stop() {
        this._stopped = true;
        if (this._sub) {
            Gio.DBus.session.signal_unsubscribe(this._sub);
            this._sub = 0;
        }
        for (const player of this._players.values())
            player.destroy();
        this._players.clear();
    }

    async _add(name) {
        if (this._players.has(name) || this._stopped)
            return;
        const player = new MprisPlayer(name, p => this._onChange(p));
        this._players.set(name, player);
        try {
            await player.init();
        } catch (e) {
            this._players.delete(name);
            log(`GNOMAC island: ${name} not usable: ${e.message}`);
            return;
        }
        if (this._stopped || this._players.get(name) !== player)
            player.destroy();
    }

    _remove(name) {
        const player = this._players.get(name);
        if (!player)
            return;
        this._players.delete(name);
        player.destroy();
        this._onChange(null);
    }

    // The player the island shows and drives: the one playing (the most recent
    // if several), else the one that was used last, among those with something
    // to show. `current` is kept while it still plays, so the card does not
    // jump between two players.
    best(current) {
        const withMedia = this.players.filter(player => player.hasMedia);
        if (!withMedia.length)
            return null;
        const playing = withMedia.filter(player => player.status === 'Playing');
        if (playing.length) {
            if (current && playing.includes(current))
                return current;
            return playing.sort((a, b) => b.lastActive - a.lastActive)[0];
        }
        if (current && withMedia.includes(current))
            return current;
        return withMedia.sort((a, b) => b.lastActive - a.lastActive)[0];
    }
}
