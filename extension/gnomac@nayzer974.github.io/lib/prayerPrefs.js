// The "Heures de prière" group of the preferences window. It lives apart from
// prefs.js because it is long, and because it runs in the preferences process
// (GTK, no shell): it imports no shell module.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';

import {METHODS} from './prayerTimes.js';

const PRAYERS = [
    ['fajr', 'Fajr'], ['sunrise', 'Chourouk (lever du soleil)'], ['dhuhr', 'Dhor'],
    ['asr', 'Asr'], ['maghrib', 'Maghrib'], ['isha', 'Icha'],
];

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';

// Looks a place up by name. Only done when the user asks for it, and only the
// text typed is sent. Resolves to [{label, latitude, longitude, timezone}].
export function searchPlace(session, name) {
    return new Promise((resolve, reject) => {
        const url = `${GEOCODING}?name=${encodeURIComponent(name)}&count=6&format=json`;
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK)
                    throw new Error(`HTTP ${message.get_status()}`);
                const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                resolve((json.results ?? []).map(r => ({
                    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
                    city: r.name,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    timezone: r.timezone ?? '',
                })));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function addPrayerPreferences(settings, {group, toggle, spin}) {
    const prayers = group('Heures de prière',
        'Calculées sur ton ordinateur, sans compte. Désactivées par défaut : l’onglet « Prières » de l’encoche et les notifications n’apparaissent qu’une fois activées.');
    toggle(prayers, 'prayer-enabled', 'Activer les heures de prière',
        'Ajoute l’onglet « Prières » à l’encoche et envoie une notification à chaque prière');

    // -- place
    const place = group('Lieu', 'Les heures dépendent de la position : cherche ta ville, ou saisis les coordonnées.');
    const here = new Adw.ActionRow({title: 'Lieu actuel'});
    const describe = () => {
        const lat = settings.get_double('prayer-latitude');
        const lon = settings.get_double('prayer-longitude');
        const city = settings.get_string('prayer-city');
        here.subtitle = lat === 0 && lon === 0
            ? 'Aucun lieu choisi'
            : `${city ? `${city} · ` : ''}${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    };
    describe();
    place.add(here);

    const search = new Adw.EntryRow({title: 'Chercher une ville', show_apply_button: true});
    place.add(search);
    const results = new Adw.ComboRow({title: 'Résultats', visible: false});
    place.add(results);
    let found = [];
    let applying = false;
    // Created on the first search, inside the running main loop.
    let session = null;
    const getSession = () => (session ??= new Soup.Session({timeout: 8}));

    const apply = r => {
        applying = true;
        settings.set_double('prayer-latitude', Math.round(r.latitude * 10000) / 10000);
        settings.set_double('prayer-longitude', Math.round(r.longitude * 10000) / 10000);
        settings.set_string('prayer-city', r.city);
        applying = false;
        describe();
        const system = GLib.TimeZone.new_local().get_identifier();
        search.title = r.timezone && system && r.timezone !== system
            ? `Chercher une ville (fuseau ${r.timezone}, différent de celui du système : ${system})`
            : 'Chercher une ville';
    };
    search.connect('apply', async () => {
        const name = search.text.trim();
        if (!name)
            return;
        search.title = 'Recherche…';
        try {
            found = await searchPlace(getSession(), name);
        } catch (e) {
            found = [];
            search.title = `Recherche impossible (${e.message})`;
            results.visible = false;
            return;
        }
        if (!found.length) {
            search.title = 'Aucun résultat';
            results.visible = false;
            return;
        }
        search.title = 'Chercher une ville';
        results.model = Gtk.StringList.new(found.map(r => r.label));
        results.selected = 0;
        results.visible = true;
        apply(found[0]);
    });
    results.connect('notify::selected', () => {
        const r = found[results.selected];
        if (r && results.visible)
            apply(r);
    });
    spin(place, 'prayer-latitude', 'Latitude', -90, 90, 0.0001, 4);
    spin(place, 'prayer-longitude', 'Longitude', -180, 180, 0.0001, 4);
    for (const key of ['prayer-latitude', 'prayer-longitude', 'prayer-city']) {
        settings.connect(`changed::${key}`, () => {
            if (!applying)
                describe();
        });
    }

    // -- calculation
    const calc = group('Calcul', 'Choisis la méthode de ton organisme ou de ta mosquée.');
    const combo = (g, key, title, subtitle, choices) => {
        const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(choices.map(([, label]) => label))});
        row.selected = Math.max(0, choices.findIndex(([value]) => value === settings.get_string(key)));
        row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));
        g.add(row);
    };
    const methodLabels = {
        mwl: 'Ligue islamique mondiale (Fajr 18°, Icha 17°)',
        uoif: 'UOIF, France (Fajr 12°, Icha 12°)',
        makkah: 'Umm al-Qura, La Mecque (Fajr 18,5°, Icha 90 min après Maghrib)',
        isna: 'ISNA, Amérique du Nord (15°, 15°)',
        egypt: 'Autorité égyptienne (19,5°, 17,5°)',
        karachi: 'Karachi (18°, 18°)',
        turkey: 'Diyanet, Turquie (18°, 17°)',
        algeria: 'Algérie (18°, 17°)',
        tunisia: 'Tunisie (18°, 18°)',
        morocco: 'Maroc (19°, 17°)',
    };
    combo(calc, 'prayer-method', 'Méthode de calcul', null,
        Object.keys(METHODS).map(key => [key, methodLabels[key] ?? METHODS[key].name]));
    combo(calc, 'prayer-asr', 'Asr', 'Ombre égale à l’objet (la plupart des écoles) ou deux fois l’objet (hanafite)', [
        ['standard', 'Standard (chaféite, malikite, hanbalite)'],
        ['hanafi', 'Hanafite'],
    ]);
    combo(calc, 'prayer-high-latitude', 'Hautes latitudes',
        'En été, loin de l’équateur, le soleil ne descend pas assez pour Fajr ou Icha : on les place alors à une part de la nuit', [
            ['angle', 'Selon l’angle (recommandé)'],
            ['seventh', 'Un septième de la nuit'],
            ['middle', 'Milieu de la nuit'],
        ]);

    const offsets = new Adw.ExpanderRow({title: 'Ajustements (minutes)',
        subtitle: 'Pour coller à l’horaire de ta mosquée : ajoute ou retire quelques minutes à chaque prière'});
    const current = () => settings.get_value('prayer-offsets').deepUnpack();
    PRAYERS.forEach(([, label], i) => {
        const row = Adw.SpinRow.new_with_range(-30, 30, 1);
        row.title = label;
        row.value = current()[i] ?? 0;
        row.connect('notify::value', () => {
            const list = current();
            while (list.length < PRAYERS.length)
                list.push(0);
            list[i] = Math.round(row.value);
            settings.set_value('prayer-offsets', new GLib.Variant('ai', list));
        });
        offsets.add_row(row);
    });
    calc.add(offsets);

    // -- notifications
    const alerts = group('Notifications', 'Une notification (dans l’encoche si « Notifications dans l’île » est activé) à l’heure de chaque prière cochée.');
    PRAYERS.forEach(([id, label]) => {
        const row = new Adw.SwitchRow({title: label, active: settings.get_strv('prayer-notify').includes(id)});
        row.connect('notify::active', () => {
            const set = new Set(settings.get_strv('prayer-notify'));
            if (row.active)
                set.add(id);
            else
                set.delete(id);
            settings.set_strv('prayer-notify', PRAYERS.map(([key]) => key).filter(key => set.has(key)));
        });
        alerts.add(row);
    });
    spin(alerts, 'prayer-before-minutes', 'Rappel avant la prière (minutes, 0 = aucun)', 0, 60, 1);
    toggle(alerts, 'prayer-sound', 'Son', 'Un court son du thème de sons à l’heure de la prière');
    // Handed back so a test can drive the place search.
    return {search, results, here, getSession};
}
