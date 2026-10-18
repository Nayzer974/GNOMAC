// Prayer times, computed on the machine from the sun's position: no network,
// no account. The formulas are the usual astronomical ones (solar declination
// and equation of time, then the hour at which the sun reaches a given angle
// below or above the horizon). Nothing here touches the shell: it only turns
// a date and a place into times, so it can be tested on its own.

const DEG = Math.PI / 180;
const sin = d => Math.sin(d * DEG);
const cos = d => Math.cos(d * DEG);
const tan = d => Math.tan(d * DEG);
const asin = x => Math.asin(x) / DEG;
const acos = x => Math.acos(x) / DEG;
const atan2 = (y, x) => Math.atan2(y, x) / DEG;
const acot = x => Math.atan(1 / x) / DEG;
const fix = (a, b) => {
    const r = a - b * Math.floor(a / b);
    return r < 0 ? r + b : r;
};
const fixAngle = a => fix(a, 360);
const fixHour = a => fix(a, 24);

// Fajr and Isha angles (degrees below the horizon). `ishaMinutes`: Isha a
// fixed time after Maghrib instead of an angle. `offsets` are the small
// corrections some authorities add (minutes, by prayer).
export const METHODS = {
    mwl: {name: 'Muslim World League', fajr: 18, isha: 17},
    uoif: {name: 'UOIF (France)', fajr: 12, isha: 12},
    makkah: {name: 'Umm al-Qura (Makkah)', fajr: 18.5, ishaMinutes: 90},
    isna: {name: 'ISNA (North America)', fajr: 15, isha: 15},
    egypt: {name: 'Egyptian General Authority', fajr: 19.5, isha: 17.5},
    karachi: {name: 'Karachi (University of Islamic Sciences)', fajr: 18, isha: 18},
    turkey: {name: 'Diyanet (Turkey)', fajr: 18, isha: 17},
    algeria: {name: 'Algeria', fajr: 18, isha: 17},
    tunisia: {name: 'Tunisia', fajr: 18, isha: 18},
    morocco: {name: 'Morocco', fajr: 19, isha: 17},
};

export const PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

// Sun position for a Julian date: declination (degrees) and the equation of
// time (hours).
function sunPosition(jd) {
    const d = jd - 2451545.0;
    const g = fixAngle(357.529 + 0.98560028 * d);
    const q = fixAngle(280.459 + 0.98564736 * d);
    const L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
    const e = 23.439 - 0.00000036 * d;
    const ra = fixHour(atan2(cos(e) * sin(L), cos(L)) / 15);
    return {declination: asin(sin(e) * sin(L)), equation: q / 15 - ra};
}

function julian(year, month, day) {
    if (month <= 2) {
        year -= 1;
        month += 12;
    }
    const a = Math.floor(year / 100);
    const b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

// Hours of the day (local time, 0..24, NaN when the sun never gets there)
// for one date and place.
//   place: {latitude, longitude}; method: key of METHODS; options:
//   {asr: 'standard' | 'hanafi', highLatitude: 'angle' | 'seventh' | 'middle',
//    elevation: metres, offsets: [fajr, sunrise, dhuhr, asr, maghrib, isha] in minutes}
export function computeHours({year, month, day}, {latitude, longitude}, timezone, methodKey = 'mwl', options = {}) {
    const method = METHODS[methodKey] ?? METHODS.mwl;
    const {asr: asrKind = 'standard', highLatitude = 'angle', elevation = 0, offsets = []} = options;
    const jd = julian(year, month, day) - longitude / (15 * 24);

    const midDay = t => fixHour(12 - sunPosition(jd + t).equation);
    const angleTime = (angle, t, ccw) => {
        const {declination} = sunPosition(jd + t);
        const noon = midDay(t);
        const x = (-sin(angle) - sin(declination) * sin(latitude)) / (cos(declination) * cos(latitude));
        const delta = acos(x) / 15;
        return noon + (ccw ? -delta : delta);
    };
    const asrTime = (factor, t) => {
        const {declination} = sunPosition(jd + t);
        return angleTime(-acot(factor + tan(Math.abs(latitude - declination))), t);
    };
    const horizon = 0.833 + 0.0347 * Math.sqrt(Math.max(0, elevation));

    // Two passes: the first guess of each hour is refined with the sun's
    // position at that hour.
    let guess = {fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, maghrib: 18, isha: 18};
    let times = {};
    for (let pass = 0; pass < 2; pass++) {
        const t = Object.fromEntries(Object.entries(guess).map(([k, v]) => [k, v / 24]));
        times = {
            fajr: angleTime(method.fajr, t.fajr, true),
            sunrise: angleTime(horizon, t.sunrise, true),
            dhuhr: midDay(t.dhuhr),
            asr: asrTime(asrKind === 'hanafi' ? 2 : 1, t.asr),
            sunset: angleTime(horizon, t.sunset, false),
            maghrib: angleTime(horizon, t.maghrib, false),
            isha: method.ishaMinutes ? NaN : angleTime(method.isha, t.isha, false),
        };
        guess = times;
    }

    // To local time.
    const shift = timezone - longitude / 15;
    for (const key of Object.keys(times))
        times[key] += shift;

    // High latitudes: the sun may never reach the angle, or reach it too
    // early. Fall back on a share of the night.
    const night = fixHour(times.sunrise - times.sunset);
    const portion = angle => ({angle: angle / 60, seventh: 1 / 7, middle: 1 / 2}[highLatitude] ?? angle / 60) * night;
    const diff = (a, b) => fixHour(b - a);
    // Guard against NaN: at extreme latitudes sunrise/sunset may never reach
    // the required angle, returning NaN. Clamp to a fallback time instead.
    if (Number.isNaN(times.fajr) || diff(times.fajr, times.sunrise) > portion(method.fajr) || Number.isNaN(times.sunrise))
        times.fajr = (Number.isNaN(times.sunrise) ? 5 : times.sunrise) - portion(method.fajr);
    if (method.ishaMinutes) {
        times.isha = times.maghrib + method.ishaMinutes / 60;
    } else if (Number.isNaN(times.isha) || diff(times.sunset, times.isha) > portion(method.isha) || Number.isNaN(times.sunset)) {
        times.isha = (Number.isNaN(times.sunset) ? 19 : times.sunset) + portion(method.isha);
    }

    const result = {};
    PRAYERS.forEach((key, i) => {
        result[key] = times[key] + (offsets[i] ?? 0) / 60;
    });
    return result;
}

// "13:07" from hours (rounded to the nearest minute, as printed timetables do).
export function formatHours(hours, h24 = true) {
    if (!Number.isFinite(hours))
        return '--:--';
    const total = Math.round(fixHour(hours) * 60) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h24)
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
