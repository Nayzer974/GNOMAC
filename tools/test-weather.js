// The "Weather widget" setting must stop every request to wttr.in. WeatherSource
// is given a stand-in for its HTTP session that only counts requests.
//   gjs -m tools/test-weather.js
import GLib from 'gi://GLib';

import {WeatherSource} from '../extension/gnomac@nayzer974.github.io/lib/weather.js';

let failed = 0;
const check = (label, ok, detail = '') => {
    if (!ok)
        failed++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  ${detail}`}`);
};

function source(enabled, city = '') {
    const settings = {
        get_string: key => (key === 'widget-weather-city' ? city : ''),
        get_boolean: key => (key === 'widget-weather' ? enabled : false),
    };
    const s = new WeatherSource(settings, () => {});
    const requests = [];
    s._session = {
        send_and_read_async: (message) => requests.push(message.get_uri().to_string()),
        abort() {},
    };
    return {s, requests};
}

let {s, requests} = source(false);
s.start();
s.refresh();
check('off: start() and refresh() send nothing (not even the lookup by IP)', requests.length === 0, requests.join());
check('off: no refresh timer is armed', s._id === 0, String(s._id));
s.stop();

({s, requests} = source(true, 'Lyon'));
s.start();
check('on: one request for the chosen city', requests.length === 1 && requests[0].includes('wttr.in/Lyon'), requests.join());
check('on: a refresh timer is armed', s._id !== 0);
s.stop();

// A settings object with no widget-weather key (older callers) behaves as before.
const legacy = new WeatherSource({get_string: () => ''}, () => {});
const sent = [];
legacy._session = {send_and_read_async: m => sent.push(m.get_uri().to_string()), abort() {}};
legacy.start();
check('a caller without the setting is not silenced', sent.length === 1, sent.join());
legacy.stop();

print(failed ? `\n${failed} check(s) FAILED` : '\nall weather checks passed');
imports.system.exit(failed ? 1 : 0);
