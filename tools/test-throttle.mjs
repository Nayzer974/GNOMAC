// lib/throttle.js: at most one pass per interval, and enter/leave never dropped.
// Run: node tools/test-throttle.mjs
import {createThrottle} from '../extension/gnomac@nayzer974.github.io/lib/throttle.js';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};

const gate = createThrottle(8000);
check('the first call passes', gate(1000) === true);
check('a call within the interval is dropped', gate(5000) === false && gate(8999) === false);
check('one after the interval passes', gate(9000) === true);
// A 1000 Hz mouse for one second: about 125 passes, not 1000.
const fast = createThrottle(8000);
let passes = 0;
for (let t = 0; t < 1e6; t += 1000)
    passes += fast(t) ? 1 : 0;
check('a 1000 Hz stream passes about 125 times a second', passes >= 124 && passes <= 126, String(passes));
const slow = createThrottle(8000);
let slowPasses = 0;
for (let t = 0; t < 1e6; t += 16667)
    slowPasses += slow(t) ? 1 : 0;
check('a 60 Hz stream is never slowed down', slowPasses === 60, String(slowPasses));
gate.reset();
check('reset lets the next call pass at once', gate(9001) === true);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall throttle checks passed');
process.exit(failed ? 1 : 0);
