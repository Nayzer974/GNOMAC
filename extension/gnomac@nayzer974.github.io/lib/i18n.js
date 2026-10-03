// Minimal two-language strings until proper gettext catalogs exist.

import GLib from 'gi://GLib';

const french = (GLib.get_language_names()[0] ?? '').startsWith('fr');

export function t(english, francais) {
    return french ? francais : english;
}
