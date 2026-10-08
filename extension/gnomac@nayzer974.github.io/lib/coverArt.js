// Album covers for the Dynamic Island.
//
// A player's cover (`mpris:artUrl`) is not always a file: Spotify gives a web
// address (https://i.scdn.co/image/…), browsers give web addresses or data
// URIs, and some give a file that only they can read. A style can show a file
// only, so everything is brought to a file in the cache:
//
//   file://   used as it is (if it can be read),
//   http(s):  downloaded once,
//   data:     decoded once.
//
// `coverFile(url)` resolves to a file:// URI, or null when there is no usable
// cover (the island then shows the player's icon instead).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const MAX_BYTES = 6 * 1024 * 1024;
const KEEP_DAYS = 7;
const RETRY_MS = 60 * 1000;

let session = null;
const pending = new Map();   // url -> Promise
const failed = new Map();    // url -> time of the failure
let pruned = false;

function cacheDir() {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnomac', 'covers']);
}

function pathFor(url) {
    return GLib.build_filenamev([cacheDir(), `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)}.img`]);
}

// Covers older than a week go; done once per session.
function prune() {
    if (pruned)
        return;
    pruned = true;
    try {
        const dir = Gio.File.new_for_path(cacheDir());
        const enumerator = dir.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        const limit = GLib.get_real_time() / 1e6 - KEEP_DAYS * 86400;
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_attribute_uint64('time::modified') < limit)
                dir.get_child(info.get_name()).delete(null);
        }
        enumerator.close(null);
    } catch {}
}

function write(path, bytes) {
    GLib.mkdir_with_parents(cacheDir(), 0o755);
    GLib.file_set_contents(path, bytes.get_data ? bytes.get_data() : bytes);
}

function download(url, path) {
    session ??= new Soup.Session({timeout: 10});
    const message = Soup.Message.new('GET', url);
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                const bytes = source.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK)
                    throw new Error(`HTTP ${message.get_status()}`);
                const size = bytes.get_size();
                if (!size || size > MAX_BYTES)
                    throw new Error(`cover of ${size} bytes`);
                write(path, bytes.get_data());
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function fetch(url) {
    if (url.startsWith('file://')) {
        const path = GLib.filename_from_uri(url)[0];
        return GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? url : null;
    }
    const path = pathFor(url);
    if (GLib.file_test(path, GLib.FileTest.IS_REGULAR))
        return `file://${path}`;
    prune();
    if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        if (comma < 0 || !/;base64$/i.test(url.slice(0, comma)))
            return null;
        write(path, GLib.base64_decode(url.slice(comma + 1)));
        return `file://${path}`;
    }
    if (/^https?:\/\//i.test(url)) {
        await download(url, path);
        return `file://${path}`;
    }
    return null;
}

export function coverFile(url) {
    if (!url)
        return Promise.resolve(null);
    const failedAt = failed.get(url);
    if (failedAt && GLib.get_monotonic_time() / 1000 - failedAt < RETRY_MS)
        return Promise.resolve(null);
    if (!pending.has(url)) {
        const job = fetch(url).catch(e => {
            log(`GNOMAC island: cover not loaded (${e.message})`);
            failed.set(url, GLib.get_monotonic_time() / 1000);
            return null;
        }).finally(() => pending.delete(url));
        pending.set(url, job);
    }
    return pending.get(url);
}

export function destroyCovers() {
    session?.abort();
    session = null;
    pending.clear();
}
