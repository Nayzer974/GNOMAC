// Pure logic of the island that has no need of the shell: the transport
// buttons and the clipboard history. Run: node tools/test-island-logic.mjs
// (mprisClient.js imports GLib, so it is loaded through gjs by
// tools/test-island-logic.js; here only the clipboard store.)
import {ClipboardStore} from '../extension/gnomac@nayzer974.github.io/lib/clipboardStore.js';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};

const store = new ClipboardStore();
check('the first user starts the watch, the second does not', store.start() === true && store.start() === false);
check('stopping one of two users keeps the history', store.stop() === false);
let ticket = store.begin();
check('a read is remembered', store.remember('hello', ticket) && store.items.join() === 'hello');
store.remember('world', store.begin());
store.remember('hello', store.begin());
check('a repeated text moves to the front, no duplicate', store.items.join() === 'hello,world', store.items.join());
check('blank text is ignored', store.remember('   ', store.begin()) === false && store.items.length === 2);

// The race of the issue: a read starts, the last user stops (history wiped),
// then the read answers.
ticket = store.begin();
check('the last user stopping wipes the history', store.stop() === true && store.items.length === 0);
check('a read that answers after the wipe is dropped', store.remember('my password', ticket) === false && store.items.length === 0,
    store.items.join());

// A new session must not accept a read of the previous one either.
const old = store.begin();
store.start();
check('a read from before a restart is dropped', store.remember('old secret', old) === false && store.items.length === 0);
check('a read of the new session is kept', store.remember('fresh', store.begin()) === true);

// Clearing while a read is in flight.
ticket = store.begin();
store.clear();
check('a read in flight does not put back what was cleared', store.remember('cleared', ticket) === false && store.items.length === 0);

let changes = 0;
const off = store.onChange(() => changes++);
store.remember('a', store.begin());
off();
store.remember('b', store.begin());
check('listeners are told, and can leave', changes === 1, String(changes));

const many = new ClipboardStore();
many.start();
for (let i = 0; i < 50; i++)
    many.remember(`item ${i}`, many.begin());
check('the history keeps 30 entries', many.items.length === 30 && many.items[0] === 'item 49');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall clipboard checks passed');
process.exit(failed ? 1 : 0);
