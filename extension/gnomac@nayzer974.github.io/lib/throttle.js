// Lets an event handler run at most once per interval. A mouse sends motion
// events at 125 Hz to 1000 Hz; the screen shows at most one picture per frame,
// so work done for every event beyond that is wasted.
//
//   const gate = createThrottle(8000);            // microseconds
//   if (gate(GLib.get_monotonic_time())) { ...do the work... }
//
// The first call always passes. `gate.reset()` lets the next one pass at once
// (use it on enter and leave events, which must never be dropped).
export function createThrottle(intervalUs) {
    let last = -Infinity;
    const gate = nowUs => {
        if (nowUs - last < intervalUs)
            return false;
        last = nowUs;
        return true;
    };
    gate.reset = () => {
        last = -Infinity;
    };
    return gate;
}
