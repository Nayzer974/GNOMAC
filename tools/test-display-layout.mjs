// lib/displayLayout.js: what is asked of Mutter for each multi-monitor action.
// Run: node tools/test-display-layout.mjs
import {applyArguments, availableActions, logicalSize, parseState, planLayout} from '../extension/gnomac@nayzer974.github.io/lib/displayLayout.js';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};

const mode = (id, w, h, hz, extra = {}) => [id, w, h, hz, 1, [1, 2], extra];
const monitor = (connector, name, modes) => [[connector, 'VEN', 'PROD', 'SER'], modes, {'display-name': name}];
const placed = (connector, x, y, scale, primary) => [x, y, scale, 0, primary, [[connector, 'VEN', 'PROD', 'SER']], {}];

// A laptop panel (2880x1800 shown at scale 2) and a 2560x1440 monitor on its right.
const laptop = monitor('eDP-1', 'Built-in display', [
    mode('2880x1800@60', 2880, 1800, 60, {'is-current': true, 'is-preferred': true}),
    mode('1920x1080@60', 1920, 1080, 60),
]);
const external = monitor('DP-2', 'Dell U2723QE', [
    mode('2560x1440@60', 2560, 1440, 60, {'is-current': true, 'is-preferred': true}),
    mode('2560x1440@144', 2560, 1440, 144),
    mode('1920x1080@60', 1920, 1080, 60),
]);
const both = parseState([7, [laptop, external], [placed('eDP-1', 0, 0, 2, true), placed('DP-2', 1440, 0, 1, false)], {}]);

const d = both.displays;
check('names come from display-name', d[0].name === 'Built-in display' && d[1].name === 'Dell U2723QE');
check('enabled and primary are read', d[0].enabled && d[0].primary && d[1].enabled && !d[1].primary);
check('the scale is read, and the logical size follows it', d[0].scale === 2 && logicalSize(d[0]).width === 1440);
check('displays at different places are not mirrored', !d[0].mirrored && !d[1].mirrored);

// Main display.
let plan = planLayout(d, 'primary', 'DP-2');
check('primary: the other display becomes primary', plan.logical.find(l => l.monitors[0].connector === 'DP-2').primary &&
    !plan.logical.find(l => l.monitors[0].connector === 'eDP-1').primary);
check('primary: places and scales are kept', plan.logical.find(l => l.monitors[0].connector === 'DP-2').x === 1440 &&
    plan.logical.find(l => l.monitors[0].connector === 'eDP-1').scale === 2);
check('primary: exactly one primary', plan.logical.filter(l => l.primary).length === 1);

// Off.
plan = planLayout(d, 'off', 'DP-2');
check('off: one display left, at the origin and primary', plan.logical.length === 1 && plan.logical[0].x === 0 && plan.logical[0].primary);
plan = planLayout(d, 'off', 'eDP-1');
check('off the primary: the other takes over, at the origin', plan.logical.length === 1 && plan.logical[0].monitors[0].connector === 'DP-2' &&
    plan.logical[0].x === 0 && plan.logical[0].primary);
const one = parseState([8, [laptop, external], [placed('eDP-1', 0, 0, 2, true)], {}]).displays;
check('off: the last display is never turned off', planLayout(one, 'off', 'eDP-1').error !== undefined);
check('off: a display already off is refused', planLayout(one, 'off', 'DP-2').error !== undefined);

// A gap is closed: three displays, the middle one goes.
const third = monitor('HDMI-1', 'TV', [mode('1920x1080@60', 1920, 1080, 60, {'is-current': true, 'is-preferred': true})]);
const three = parseState([9, [laptop, external, third],
    [placed('eDP-1', 0, 0, 2, true), placed('DP-2', 1440, 0, 1, false), placed('HDMI-1', 4000, 0, 1, false)], {}]).displays;
plan = planLayout(three, 'off', 'DP-2');
check('off in the middle: the right one moves up against the left one', plan.logical.length === 2 && plan.logical[1].x === 1440, JSON.stringify(plan.logical.map(l => l.x)));

// On.
plan = planLayout(one, 'on', 'DP-2');
check('on: the display comes back on the right, in its preferred mode', plan.logical.length === 2 &&
    plan.logical[1].x === 1440 && plan.logical[1].monitors[0].mode === '2560x1440@60' && plan.logical[0].primary);
check('on: a display that is on is refused', planLayout(d, 'on', 'DP-2').error !== undefined);

// Mirror.
plan = planLayout(d, 'mirror');
check('mirror: one logical monitor holding both', plan.logical.length === 1 && plan.logical[0].monitors.length === 2);
check('mirror: the largest shared size, 1920x1080', plan.logical[0].monitors.every(m => m.mode.startsWith('1920x1080')));
check('mirror: at the origin, scale 1, primary', plan.logical[0].x === 0 && plan.logical[0].y === 0 && plan.logical[0].scale === 1 && plan.logical[0].primary);
const odd = parseState([10, [laptop, monitor('DP-3', 'Odd', [mode('1024x600@60', 1024, 600, 60, {'is-current': true})])],
    [placed('eDP-1', 0, 0, 2, true), placed('DP-3', 1440, 0, 1, false)], {}]).displays;
check('mirror: no shared size is an error, not a guess', planLayout(odd, 'mirror').error !== undefined);
check('mirror: a single display is refused', planLayout(parseState([1, [laptop], [placed('eDP-1', 0, 0, 2, true)], {}]).displays, 'mirror').error !== undefined);

// Extend after a mirror.
const mirrored = parseState([11, [laptop, external],
    [[0, 0, 1, 0, true, [['eDP-1', 'V', 'P', 'S'], ['DP-2', 'V', 'P', 'S']], {}]], {}]).displays;
check('mirrored displays are recognised', mirrored.every(x => x.mirrored));
plan = planLayout(mirrored, 'extend');
check('extend: each display gets its own place, side by side', plan.logical.length === 2 && plan.logical[0].x === 0 && plan.logical[1].x > 0);
check('extend: exactly one primary', plan.logical.filter(l => l.primary).length === 1);
check('primary is refused while mirrored', planLayout(mirrored, 'primary', 'DP-2').error !== undefined);

// What is sent.
const args = applyArguments(7, planLayout(d, 'primary', 'DP-2').logical);
check('arguments: serial, temporary method, logical monitors, no properties', args[0] === 7 && args[1] === 1 && args[2].length === 2 && Object.keys(args[3]).length === 0);
check('arguments: each logical monitor is (x, y, scale, transform, primary, monitors)', args[2][0].length === 6 && Array.isArray(args[2][0][5][0]) && args[2][0][5][0].length === 3);

// What a menu offers.
const say = (en, fr, name) => en.replace('%s', name);
const labels = actions => actions.map(a => a.label);
check('nothing is offered with one display', availableActions(parseState([1, [laptop], [placed('eDP-1', 0, 0, 2, true)], {}]).displays, say).length === 0);
let offered = labels(availableActions(d, say));
check('two displays: main, mirror, off for each', offered.includes('Make “Dell U2723QE” the Main Display') && offered.includes('Mirror Displays') &&
    offered.includes('Turn Off “Dell U2723QE”') && offered.includes('Turn Off “Built-in display”') && !offered.includes('Extend Displays'), JSON.stringify(offered));
offered = labels(availableActions(one, say));
check('one of two on: turn the other on, extend', offered.includes('Turn On “Dell U2723QE”') && offered.includes('Extend Displays') && !offered.some(l => l.startsWith('Turn Off')), JSON.stringify(offered));
offered = labels(availableActions(mirrored, say));
check('mirrored: extend only', offered.length === 1 && offered[0] === 'Extend Displays', JSON.stringify(offered));

// Two displays of one model: the connector tells them apart.
const twin = (connector) => monitor(connector, 'Dell U2723QE', [mode('2560x1440@60', 2560, 1440, 60, {'is-current': true, 'is-preferred': true})]);
const twins = parseState([12, [twin('DP-1'), twin('DP-2')], [placed('DP-1', 0, 0, 1, true), placed('DP-2', 2560, 0, 1, false)], {}]).displays;
offered = labels(availableActions(twins, say));
check('identical names get their connector', offered.includes('Turn Off “Dell U2723QE (DP-1)”') && offered.includes('Turn Off “Dell U2723QE (DP-2)”'), JSON.stringify(offered));
check('different names are left alone', labels(availableActions(d, say)).includes('Turn Off “Dell U2723QE”'));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall display layout checks passed');
process.exit(failed ? 1 : 0);
