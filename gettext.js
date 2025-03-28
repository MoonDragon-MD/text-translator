const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function initTranslations() {
    let localeDir = Me.dir.get_child('locale');
    if (localeDir.query_exists(null)) {
        Gettext.bindtextdomain('text-translator', localeDir.get_path());
    }
}

function getTranslation(str) {
    return Gettext.gettext(str);
}

// Funzione helper per tradurre stringhe
var _ = getTranslation;
