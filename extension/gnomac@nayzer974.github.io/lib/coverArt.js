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

// Reads a stream up to `max` bytes. More than that and it stops at once:
// the cap is a protection, so it must hold while the data arrives, not after
// everything was downloaded (the address comes from the player).
export function readCapped(stream, max, cancellable = null) {
    const chunks = [];
    let total = 0;
    return new Promise((resolve, reject) => {
        const next = () => stream.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            let bytes;
            try {
                bytes = source.read_bytes_finish(result);
            } catch (e) {
                reject(e);
                return;
            }
            const size = bytes.get_size();
            if (size === 0) {
                const all = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) {
                    all.set(chunk, offset);
                    offset += chunk.length;
                }
                resolve(all);
                return;
            }
            total += size;
            if (total > max) {
                cancellable?.cancel();
                reject(new Error(`cover over ${max} bytes`));
                return;
            }
            chunks.push(new Uint8Array(bytes.toArray()));
            next();
        });
        next();
    });
}

// The bytes of a base64 `data:` address, or null when it is not base64 or
// would decode to more than `max` bytes. The size is judged on the text
// first: a huge address is never decoded.
export function dataUriBytes(url, max = MAX_BYTES) {
    const comma = url.indexOf(',');
    if (comma < 0 || !/;base64$/i.test(url.slice(0, comma)))
        return null;
    const payload = url.slice(comma + 1);
    // Base64 turns 3 bytes into 4 characters.
    if (payload.length > Math.ceil(max / 3) * 4 + 8)
        return null;
    const bytes = GLib.base64_decode(payload);
    return bytes.length && bytes.length <= max ? bytes : null;
}

function download(url, path) {
    session ??= new Soup.Session({timeout: 10});
    const message = Soup.Message.new('GET', url);
    const cancellable = new Gio.Cancellable();
    return new Promise((resolve, reject) => {
        session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            let stream;
            try {
                stream = source.send_finish(result);
                if (message.get_status() !== Soup.Status.OK)
                    throw new Error(`HTTP ${message.get_status()}`);
                // A server that announces a size over the cap is not read at all.
                const announced = message.get_response_headers().get_content_length();
                if (announced > MAX_BYTES)
                    throw new Error(`cover of ${announced} bytes`);
            } catch (e) {
                cancellable.cancel();
                reject(e);
                return;
            }
            readCapped(stream, MAX_BYTES, cancellable).then(bytes => {
                stream.close(null);
                if (!bytes.length)
                    throw new Error('empty cover');
                write(path, bytes);
                resolve();
            }).catch(e => {
                try {
                    stream.close(null);
                } catch {}
                reject(e);
            });
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
        const bytes = dataUriBytes(url);
        if (!bytes)
            return null;
        write(path, bytes);
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
