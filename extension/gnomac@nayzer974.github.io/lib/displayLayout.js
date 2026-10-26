// Multi-monitor layouts: from what Mutter's DisplayConfig service reports to
// what it is asked to apply. Only arithmetic lives here (nothing touches the
// shell), so it can be tested on its own (tools/test-display-layout.mjs).
//
// A display is {connector, name, width, height, mode, scale, transform, x, y,
// enabled, primary, modes: [{id, width, height, hz}]}. The layout asked for is
// a list of logical monitors, each {x, y, scale, transform, primary,
// monitors: [{connector, mode}]}; two monitors in one logical monitor are
// mirrored.

// The logical size of a display: its mode divided by the scale, swapped when
// it is rotated a quarter turn.
export function logicalSize(display) {
    const rotated = display.transform % 2 === 1;
    const scale = display.scale > 0 ? display.scale : 1;
    const width = Math.round((rotated ? display.height : display.width) / scale);
    const height = Math.round((rotated ? display.width : display.height) / scale);
    return {width, height};
}

// GetCurrentState: (serial, monitors, logical_monitors, properties) as
// recursively unpacked by GJS.
export function parseState([serial, monitors, logical]) {
    const placed = new Map();
    for (const [x, y, scale, transform, primary, specs] of logical) {
        for (const spec of specs)
            placed.set(spec[0], {x, y, scale, transform, primary});
    }
    const displays = monitors.map(([[connector, vendor, product], modes, props]) => {
        const current = modes.find(mode => mode[6]?.['is-current']) ?? null;
        const preferred = modes.find(mode => mode[6]?.['is-preferred']) ?? modes[0] ?? null;
        const shown = current ?? preferred;
        const where = placed.get(connector);
        return {
            connector,
            name: props?.['display-name'] || [vendor, product].filter(Boolean).join(' ') || connector,
            width: shown?.[1] ?? 0,
            height: shown?.[2] ?? 0,
            mode: shown?.[0] ?? '',
            scale: where?.scale ?? 1,
            transform: where?.transform ?? 0,
            x: where?.x ?? 0,
            y: where?.y ?? 0,
            enabled: !!where,
            primary: !!where?.primary,
            modes: modes.map(mode => ({id: mode[0], width: mode[1], height: mode[2], hz: mode[3]})),
            preferredMode: preferred?.[0] ?? '',
            preferredWidth: preferred?.[1] ?? 0,
            preferredHeight: preferred?.[2] ?? 0,
        };
    });
    // Mirrored displays share one logical monitor: they sit at the same place.
    const mirrored = new Set();
    for (const a of displays) {
        for (const b of displays) {
            if (a !== b && a.enabled && b.enabled && a.x === b.x && a.y === b.y)
                mirrored.add(a.connector);
        }
    }
    for (const display of displays)
        display.mirrored = mirrored.has(display.connector);
    return {serial, displays};
}

const entry = (display, x, y, primary, mode = display.mode) => ({
    x, y, scale: display.scale, transform: display.transform, primary,
    monitors: [{connector: display.connector, mode}],
});

// Displays side by side, left to right in the given order, tops aligned: the
// first one at the origin. The primary one is kept primary, or else the first.
function packRow(list, primaryConnector) {
    const primary = list.some(d => d.connector === primaryConnector) ? primaryConnector : list[0].connector;
    let x = 0;
    return list.map(display => {
        const at = x;
        x += logicalSize(display).width;
        return entry(display, at, 0, display.connector === primary);
    });
}

const byPosition = (a, b) => (a.x - b.x) || (a.y - b.y);

// What to ask Mutter for. `action`: 'primary' | 'off' | 'on' | 'mirror' |
// 'extend'; `connector` names the display it concerns (not needed for
// mirror and extend). Returns {logical} or {error}.
export function planLayout(displays, action, connector = null) {
    const enabled = displays.filter(d => d.enabled).sort(byPosition);
    const target = displays.find(d => d.connector === connector) ?? null;
    const primary = enabled.find(d => d.primary)?.connector ?? enabled[0]?.connector ?? null;

    switch (action) {
    case 'primary': {
        if (!target?.enabled)
            return {error: 'that display is off'};
        if (target.mirrored)
            return {error: 'displays are mirrored'};
        // Same places, only the primary changes.
        return {logical: enabled.map(d => entry(d, d.x, d.y, d.connector === target.connector))};
    }
    case 'off': {
        if (!target?.enabled)
            return {error: 'that display is already off'};
        const rest = enabled.filter(d => d.connector !== target.connector);
        if (!rest.length)
            return {error: 'the last display cannot be turned off'};
        // Closing the gap: displays must touch.
        return {logical: packRow(rest, primary)};
    }
    case 'on': {
        if (!target || target.enabled)
            return {error: 'that display is already on'};
        const shown = {...target, mode: target.preferredMode || target.mode,
            width: target.preferredWidth || target.width, height: target.preferredHeight || target.height,
            scale: 1, transform: 0};
        return {logical: packRow([...enabled, shown], primary)};
    }
    case 'extend': {
        if (enabled.length < 2 && displays.length < 2)
            return {error: 'there is only one display'};
        const all = enabled.length > 1 ? enabled : [...enabled, ...displays.filter(d => !d.enabled).map(d => ({
            ...d, mode: d.preferredMode || d.mode, width: d.preferredWidth || d.width,
            height: d.preferredHeight || d.height, scale: 1, transform: 0}))];
        // Mirrored displays share a place: give each its own, in a row.
        return {logical: packRow(all, primary)};
    }
    case 'mirror': {
        const all = displays.filter(d => d.enabled || displays.length > 1);
        if (all.length < 2)
            return {error: 'there is only one display'};
        // The largest resolution every display can show.
        const sizes = all.map(d => new Set(d.modes.map(m => `${m.width}x${m.height}`)));
        const common = [...sizes[0]].filter(size => sizes.every(set => set.has(size)))
            .map(size => size.split('x').map(Number))
            .sort((a, b) => (b[0] * b[1]) - (a[0] * a[1]))[0];
        if (!common)
            return {error: 'no resolution is shared by every display'};
        const [width, height] = common;
        const monitors = all.map(d => {
            // The fastest mode at that size.
            const best = d.modes.filter(m => m.width === width && m.height === height)
                .sort((a, b) => b.hz - a.hz)[0];
            return {connector: d.connector, mode: best.id};
        });
        const lead = all.find(d => d.connector === primary) ?? all[0];
        return {logical: [{x: 0, y: 0, scale: 1, transform: lead.transform % 2 === 0 ? lead.transform : 0, primary: true, monitors}]};
    }
    default:
        return {error: `unknown action ${action}`};
    }
}

// The argument of ApplyMonitorsConfig: (uua(iiduba(ssa{sv}))a{sv}), the
// serial from the state the plan was made from, method 1 (temporary: it does
// not outlive the session, so a bad layout is never kept).
export function applyArguments(serial, logical) {
    return [serial, 1, logical.map(l => [l.x, l.y, l.scale, l.transform, l.primary,
        l.monitors.map(m => [m.connector, m.mode, {}])]), {}];
}

// What can be done now, for a menu or a search: [{action, connector, label}].
// `say(english, french, name)` is the translation function of the caller.
export function availableActions(displays, say) {
    // Two displays of one model have the same name: the connector tells them apart.
    const shown = new Map(displays.map(d => [d.connector,
        displays.filter(x => x.name === d.name).length > 1 ? `${d.name} (${d.connector})` : d.name]));
    const enabled = displays.filter(d => d.enabled);
    const out = [];
    if (displays.length < 2)
        return out;
    const mirroredNow = enabled.some(d => d.mirrored);
    if (!mirroredNow) {
        for (const d of enabled) {
            if (!d.primary && enabled.length > 1)
                out.push({action: 'primary', connector: d.connector, label: say('Make “%s” the Main Display', 'Définir « %s » comme écran principal', shown.get(d.connector))});
        }
    }
    if (enabled.length > 1 && !mirroredNow)
        out.push({action: 'mirror', connector: null, label: say('Mirror Displays', 'Dupliquer les écrans', '')});
    if (mirroredNow || enabled.length < displays.length)
        out.push({action: 'extend', connector: null, label: say('Extend Displays', 'Étendre les écrans', '')});
    if (enabled.length > 1 && !mirroredNow) {
        for (const d of enabled)
            out.push({action: 'off', connector: d.connector, label: say('Turn Off “%s”', 'Éteindre « %s »', shown.get(d.connector))});
    }
    for (const d of displays.filter(x => !x.enabled))
        out.push({action: 'on', connector: d.connector, label: say('Turn On “%s”', 'Allumer « %s »', shown.get(d.connector))});
    return out;
}
