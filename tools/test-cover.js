// The size cap on album covers (lib/coverArt.js): web addresses are capped
// while the data arrives, `data:` addresses before they are decoded. A small
// local web server plays the part of a hostile player's cover address.
//   gjs -m tools/test-cover.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// The cache must not be the real one. GLib reads XDG_CACHE_HOME once, at
// start: the test runs itself again in a process that starts with a throw-away
// cache, and refuses to run in any other.
const cache = GLib.getenv('GNOMAC_TEST_CACHE');
if (!cache || GLib.get_user_cache_dir() !== cache) {
    const dir = GLib.dir_make_tmp('gnomac-cover-test-XXXXXX');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('XDG_CACHE_HOME', dir, true);
    launcher.setenv('GNOMAC_TEST_CACHE', dir, true);
    const child = launcher.spawnv(['gjs', '-m', import.meta.url.replace('file://', '')]);
    child.wait(null);
    GLib.spawn_command_line_sync(`rm -rf ${dir}`);
    imports.system.exit(child.get_exit_status());
}

const {coverFile, dataUriBytes, readCapped} = await import('../extension/gnomac@nayzer974.github.io/lib/coverArt.js');

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};
const loop = GLib.MainLoop.new(null, false);
const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// --- data: addresses
const b64 = bytes => GLib.base64_encode(bytes);
check('a small base64 data address decodes', dataUriBytes(`data:image/png;base64,${b64(new Uint8Array(1000).fill(7))}`)?.length === 1000);
check('a data address that is not base64 is refused', dataUriBytes('data:image/png,%89PNG') === null);
check('an empty data address is refused', dataUriBytes('data:image/png;base64,') === null);
const big = 'A'.repeat(9 * 1024 * 1024);   // 9 million characters: would decode to 6.75 MB
check('an oversized data address is refused before it is decoded', dataUriBytes(`data:image/png;base64,${big}`) === null);
check('a data address over a given cap is refused', dataUriBytes(`data:x;base64,${b64(new Uint8Array(300))}`, 100) === null);
check('one exactly at the cap is accepted', dataUriBytes(`data:x;base64,${b64(new Uint8Array(99))}`, 99)?.length === 99);

// --- readCapped
const payload = new Uint8Array(500000).map((_, i) => i % 251);
let got = await readCapped(Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(payload)), 1000000);
check('a stream under the cap is read whole, byte for byte', got.length === payload.length && got.every((v, i) => v === payload[i]));
const stream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(new Uint8Array(40 * 1024 * 1024)));
let error = null;
try {
    await readCapped(stream, 1024 * 1024);
} catch (e) {
    error = e;
}
check('a stream over the cap is refused', error && /over/.test(error.message), String(error));
check('and it was not read to the end', stream.tell() < 2 * 1024 * 1024, `read ${stream.tell()} bytes of 41943040`);

// --- over HTTP
const server = Gio.Subprocess.new(['python3', '-u', '-c', `
import http.server, socketserver, sys, threading
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/small":
            body = b"x" * 2048
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path == "/announced":
            self.send_response(200); self.send_header("Content-Length", str(50 * 1024 * 1024)); self.end_headers()
            try:
                self.wfile.write(b"x" * 100000)
            except Exception: pass
        else:  # endless, chunked, no length
            self.send_response(200); self.send_header("Transfer-Encoding", "chunked"); self.end_headers()
            chunk = b"y" * 65536
            try:
                while True:
                    self.wfile.write(b"%x\\r\\n" % len(chunk) + chunk + b"\\r\\n")
            except Exception: pass
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
s = S(("127.0.0.1", 0), H)
print(s.server_address[1], flush=True)
s.serve_forever()
`], Gio.SubprocessFlags.STDOUT_PIPE);
const port = Number(await new Promise(resolve => {
    const reader = Gio.DataInputStream.new(server.get_stdout_pipe());
    reader.read_line_async(GLib.PRIORITY_DEFAULT, null, (r, res) => resolve(new TextDecoder().decode(r.read_line_finish(res)[0])));
}));

const filesInCache = () => {
    try {
        const dir = Gio.File.new_for_path(`${cache}/gnomac/covers`);
        const e = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let n = 0;
        while (e.next_file(null))
            n++;
        return n;
    } catch {
        return 0;
    }
};

const started = GLib.get_monotonic_time();
let path = await coverFile(`http://127.0.0.1:${port}/small`);
check('a small cover is downloaded and cached', path?.startsWith('file://') && filesInCache() === 1, String(path));
path = await coverFile(`http://127.0.0.1:${port}/announced`);
check('a server announcing 50 MB is refused', path === null && filesInCache() === 1, String(path));
const t0 = GLib.get_monotonic_time();
path = await coverFile(`http://127.0.0.1:${port}/endless`);
const seconds = (GLib.get_monotonic_time() - t0) / 1e6;
check('an endless stream with no length is cut at the cap, long before the timeout', path === null && seconds < 5 && filesInCache() === 1,
    `${path} after ${seconds.toFixed(1)} s, ${filesInCache()} files`);

server.force_exit();
print(failed ? `\n${failed} check(s) FAILED` : '\nall cover checks passed');
imports.system.exit(failed ? 1 : 0);
