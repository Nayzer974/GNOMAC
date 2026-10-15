// Checks lib/prayerSchedule.js: which prayer is current and next, the wall
// clock around a daylight-saving change, and the alerts. It runs under gjs
// with the time zone forced to Paris:
//
//   TZ=Europe/Paris gjs -m tools/test-prayer-schedule.js
import GLib from 'gi://GLib';

import {PrayerAlerts, countdown, entriesAround, stateAt} from '../extension/gnomac@nayzer974.github.io/lib/prayerSchedule.js';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};
const at = (y, mo, d, h, mi, s = 0) => GLib.DateTime.new_local(y, mo, d, h, mi, s);
const clock = dt => dt.format('%H:%M');

const config = {
    enabled: true, place: {latitude: 48.8566, longitude: 2.3522}, method: 'mwl', asr: 'standard',
    highLatitude: 'angle', offsets: [0, 0, 0, 0, 0, 0], notify: new Set(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']),
    before: 0, h24: true,
};

check('the test runs in Paris time', GLib.TimeZone.new_local().get_identifier() === 'Europe/Paris' ||
    at(2026, 7, 1, 12, 0).get_utc_offset() === 7200e6, GLib.TimeZone.new_local().get_identifier());

// 15 Oct 2026 (summer time, UTC+2): the same times as the reference timetable.
let s = stateAt(config, at(2026, 10, 15, 12, 0));
check('noon: Fajr has begun, Dhuhr is next', s.current.key === 'fajr' && s.next.key === 'dhuhr', `${s.current?.key} ${s.next?.key}`);
check('noon: Fajr time is over (after sunrise)', s.afterSunrise === true);
check('noon: Dhuhr is at 13:36', clock(s.next.at) === '13:36', clock(s.next.at));
s = stateAt(config, at(2026, 10, 15, 13, 40));
check('13:40: Dhuhr current, Asr next at 16:28', s.current.key === 'dhuhr' && s.next.key === 'asr' && clock(s.next.at) === '16:28',
    `${s.current?.key} ${s.next?.key} ${clock(s.next.at)}`);
check('13:40: not after sunrise any more', s.afterSunrise === false);
s = stateAt(config, at(2026, 10, 15, 21, 30));
check('21:30: Isha current, next is tomorrow\'s Fajr', s.current.key === 'isha' && s.next.key === 'fajr' &&
    s.next.at.get_day_of_month() === 16, `${s.current?.key} ${s.next?.key} ${s.next?.at.get_day_of_month()}`);
s = stateAt(config, at(2026, 10, 16, 2, 0));
check('02:00: yesterday\'s Isha is still current, Fajr is next', s.current.key === 'isha' &&
    s.current.at.get_day_of_month() === 15 && s.next.key === 'fajr', `${s.current?.key} ${s.next?.key}`);
check('today lists six times', stateAt(config, at(2026, 10, 15, 12, 0)).today.length === 6);

// Summer: Isha after midnight lands on the next civil day, at 00:11.
const june = entriesAround(config, at(2026, 6, 21, 12, 0)).filter(e => e.key === 'isha' && e.at.get_day_of_month() === 22);
check('21 Jun: Isha is at 00:11 on the 22nd', june.length === 1 && clock(june[0].at) === '00:11', june.map(e => clock(e.at)).join());

// Daylight saving ends on 25 Oct 2026 (03:00 -> 02:00): wall-clock times stay right.
const dst = stateAt(config, at(2026, 10, 25, 12, 0));
const fajrDst = dst.entries.find(e => e.key === 'fajr' && e.at.get_day_of_month() === 25);
const dhuhrDst = dst.entries.find(e => e.key === 'dhuhr' && e.at.get_day_of_month() === 25);
check('25 Oct (DST change): Fajr 06:xx, Dhuhr 12:xx in local time', /^0[5-6]:/.test(clock(fajrDst.at)) && /^12:/.test(clock(dhuhrDst.at)),
    `${clock(fajrDst.at)} ${clock(dhuhrDst.at)}`);

// No place chosen: nothing to show, nothing to alert.
check('no place: no times', stateAt({...config, place: null}, at(2026, 10, 15, 12, 0)).entries.length === 0);

check('countdown', countdown(75 * 60).includes('1 h 15') && countdown(300).includes('5 min') && countdown(40).includes('40'),
    [countdown(75 * 60), countdown(300), countdown(40)].join(' | '));

// Alerts.
const fired = [];
const alerts = new PrayerAlerts(a => fired.push(`${a.key}:${a.kind}@${clock(a.at)}`));
alerts.tick(config, at(2026, 10, 15, 13, 34, 0));      // first tick only remembers
alerts.tick(config, at(2026, 10, 15, 13, 35, 30));
check('nothing fires before the prayer', fired.length === 0, fired.join());
alerts.tick(config, at(2026, 10, 15, 13, 36, 1));
check('Dhuhr fires once at 13:36', fired.length === 1 && fired[0] === 'dhuhr:now@13:36', fired.join());
alerts.tick(config, at(2026, 10, 15, 13, 36, 5));
alerts.tick(config, at(2026, 10, 15, 13, 40, 0));
check('and never twice', fired.length === 1, fired.join());

// The clock goes back (time sync) and forward again over the same minute.
alerts.tick(config, at(2026, 10, 15, 13, 35, 30));
alerts.tick(config, at(2026, 10, 15, 13, 36, 10));
check('a clock set back does not announce the same prayer twice', fired.length === 1, fired.join());

const filtered = [];
const a2 = new PrayerAlerts(a => filtered.push(a.key));
const cfg2 = {...config, notify: new Set(['asr'])};
a2.tick(cfg2, at(2026, 10, 15, 13, 35, 0));
a2.tick(cfg2, at(2026, 10, 15, 13, 36, 30));
a2.tick(cfg2, at(2026, 10, 15, 16, 28, 20));
check('only the chosen prayers alert', filtered.join() === 'asr', filtered.join());

const early = [];
const a3 = new PrayerAlerts(a => early.push(`${a.key}:${a.kind}@${clock(a.at)}`));
const cfg3 = {...config, before: 10};
a3.tick(cfg3, at(2026, 10, 15, 16, 17, 0));
a3.tick(cfg3, at(2026, 10, 15, 16, 18, 5));
check('a reminder fires 10 minutes before Asr', early.join() === 'asr:before@16:28', early.join());
a3.tick(cfg3, at(2026, 10, 15, 16, 28, 5));
check('then the prayer itself', early.join() === 'asr:before@16:28,asr:now@16:28', early.join());

const slept = [];
const a4 = new PrayerAlerts(a => slept.push(a.key));
a4.tick(config, at(2026, 10, 15, 9, 0, 0));
a4.tick(config, at(2026, 10, 15, 18, 0, 0));   // the machine slept through Dhuhr and Asr
check('prayers slept through are dropped, not announced late', slept.length === 0, slept.join());

const off = [];
const a5 = new PrayerAlerts(a => off.push(a.key));
const cfg5 = {...config, enabled: false};
a5.tick(cfg5, at(2026, 10, 15, 13, 35, 0));
a5.tick(cfg5, at(2026, 10, 15, 13, 37, 0));
check('disabled: no alert', off.length === 0, off.join());

print(failed ? `\n${failed} check(s) FAILED` : '\nall prayer schedule checks passed');
imports.system.exit(failed ? 1 : 0);
