// The transport buttons of the island (lib/mprisClient.js skipControl).
//   gjs -m tools/test-island-logic.js
import {skipControl} from '../extension/gnomac@nayzer974.github.io/lib/mprisClient.js';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};
const j = x => JSON.stringify(x);

// A music player with both neighbours.
const full = {canGoNext: true, canGoPrevious: true, canSeek: true};
check('both neighbours: both skip', j(skipControl(full, 1)) === '{"enabled":true,"kind":"skip"}' &&
    j(skipControl(full, -1)) === '{"enabled":true,"kind":"skip"}');

// The issue's two cases.
const previousOnly = {canGoNext: false, canGoPrevious: true, canSeek: false};
check('only "previous": the previous button works, the next one is off',
    skipControl(previousOnly, -1).enabled === true && skipControl(previousOnly, -1).kind === 'skip' &&
    skipControl(previousOnly, 1).enabled === false, j([skipControl(previousOnly, -1), skipControl(previousOnly, 1)]));
const nextOnly = {canGoNext: true, canGoPrevious: false, canSeek: false};
check('only "next", not seekable: the back button is off instead of doing nothing',
    skipControl(nextOnly, -1).enabled === false && skipControl(nextOnly, 1).enabled === true,
    j([skipControl(nextOnly, -1), skipControl(nextOnly, 1)]));

// A browser tab: no track to go to, but seeking: ten seconds each way.
const browser = {canGoNext: false, canGoPrevious: false, canSeek: true};
check('seeking alone: both buttons jump 10 s', j(skipControl(browser, 1)) === '{"enabled":true,"kind":"seek"}' &&
    j(skipControl(browser, -1)) === '{"enabled":true,"kind":"seek"}');
const nothing = {canGoNext: false, canGoPrevious: false, canSeek: false};
check('nothing at all: both buttons off', !skipControl(nothing, 1).enabled && !skipControl(nothing, -1).enabled);
check('missing fields count as "no"', !skipControl({}, 1).enabled && !skipControl({}, -1).enabled);

print(failed ? `\n${failed} check(s) FAILED` : '\nall transport button checks passed');
imports.system.exit(failed ? 1 : 0);
