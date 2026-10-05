// Weather for the desktop widget, from wttr.in (JSON, no API key). With no
// city configured the service locates the request by IP address, so the
// widget can be turned off or pinned to a city in the preferences.

import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const REFRESH_MS = 30 * 60 * 1000;

// wttr.in weather codes -> symbolic icon names.
function iconFor(code) {
    code = Number(code);
    if (code === 113)
        return 'weather-clear-symbolic';
    if (code === 116)
        return 'weather-few-clouds-symbolic';
    if ([119, 122].includes(code))
        return 'weather-overcast-symbolic';
    if ([143, 248, 260].includes(code))
        return 'weather-fog-symbolic';
    if ([200, 386, 389, 392, 395].includes(code))
        return 'weather-storm-symbolic';
    if ([179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362,
        365, 368, 371, 374, 377].includes(code))
        return 'weather-snow-symbolic';
    return 'weather-showers-symbolic';
}

export class WeatherSource {
    constructor(settings, onChange) {
        this._settings = settings;
        this._onChange = onChange;
        this._session = new Soup.Session({timeout: 8});
        this.data = null;
        this._id = 0;
    }

    start() {
        this.refresh();
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, REFRESH_MS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._id) {
            GLib.source_remove(this._id);
            this._id = 0;
        }
        this._session?.abort();
        this._session = null;
        this._onChange = null;
    }

    refresh() {
        if (!this._session)
            return;
        const city = encodeURIComponent(this._settings.get_string('widget-weather-city').trim());
        const message = Soup.Message.new('GET', `https://wttr.in/${city}?format=j1`);
        message.request_headers.append('User-Agent', 'curl/8 GNOMAC');
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                const current = json.current_condition[0];
                const today = json.weather[0];
                this.data = {
                    temp: Number(current.temp_C),
                    description: current.weatherDesc?.[0]?.value ?? '',
                    icon: iconFor(current.weatherCode),
                    high: Number(today.maxtempC),
                    low: Number(today.mintempC),
                    city: json.nearest_area?.[0]?.areaName?.[0]?.value ?? '',
                };
            } catch {
                // Offline or malformed: keep the last good reading.
            }
            this._onChange?.();
        });
    }
}
