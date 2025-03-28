const Lang = imports.lang;
const ExtensionUtils = imports.misc.extensionUtils;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Me = ExtensionUtils.getCurrentExtension();
const PrefsKeys = Me.imports.prefs_keys;
const Utils = Me.imports.utils;
const TranslationProviderBase = Me.imports.translation_provider_base.TranslationProviderBase;

var TranslatorsManager = class TranslatorsManager {
    constructor(extension_object) {
        this._extension_object = extension_object;
        this._translators = [];
        this._available_translators = [];
        this._load_translators();
        
        // Imposta il traduttore predefinito
        let default_name = Utils.SETTINGS.get_string(PrefsKeys.DEFAULT_TRANSLATOR_KEY);
        this._default = this.get_by_name(default_name) || this._get_fallback_translator();
        this._current = this._default;
        
        // Connetti il segnale per gli aggiornamenti delle impostazioni
        this._settingsChangedId = Utils.SETTINGS.connect(
            'changed::deepl-api-key',
            () => this._on_settings_changed()
        );
    }

    _load_translators() {
        let translators_imports = Me.imports.translation_providers;
        let files_list = Utils.get_files_in_dir(Me.path + "/translation_providers");

        for (let i = 0; i < files_list.length; i++) {
            let file_name = files_list[i];
            let module_name = file_name.slice(0, -3);

            if (!Utils.ends_with(file_name, "_translation_provider.js")) {
                continue;
            }

            try {
                let translator = new translators_imports[module_name].Translator(
                    this._extension_object
                );
                translator.file_name = file_name;
                
                // Verifica se il traduttore è disponibile
                if (this._is_translator_available(translator)) {
                    this._available_translators.push(translator);
                }
                
                this._translators.push(translator);
                log('Caricato traduttore: ' + translator.name);
            } catch(e) {
                log('Errore nel caricamento del traduttore ' + module_name + ': ' + e.message);
            }
        }
    }

    _is_translator_available(translator) {
        // Verifica se il traduttore è disponibile
        if (translator.name === "Deepl") {
            return translator.isAvailable && translator.isAvailable();
        } else if (translator.name === "Locally") {
            return GLib.find_program_in_path("translateLocally") !== null;
        }
        return true; // Altri traduttori sono sempre disponibili
    }

    _get_fallback_translator() {
        // Cerca un traduttore di fallback nell'ordine: Google, Locally, qualsiasi altro disponibile
        let fallback_order = ['Google', 'Locally'];
        
        for (let name of fallback_order) {
            let translator = this.get_by_name(name);
            if (translator && this._is_translator_available(translator)) {
                return translator;
            }
        }

        // Se nessun traduttore preferito è disponibile, usa il primo disponibile
        return this._available_translators[0] || this._translators[0];
    }

    _on_settings_changed() {
        // Ricarica lo stato dei traduttori
        this._available_translators = [];
        for (let translator of this._translators) {
            if (this._is_translator_available(translator)) {
                this._available_translators.push(translator);
            }
        }

        // Se il traduttore corrente non è più disponibile, passa al fallback
        if (!this._is_translator_available(this._current)) {
            this._current = this._get_fallback_translator();
            // Notifica il cambio di traduttore se c'è un oggetto extension
            if (this._extension_object && this._extension_object._dialog) {
                this._extension_object._dialog.statusbar.add_message(
                    `Traduttore cambiato a ${this._current.name} (il precedente non era disponibile)`,
                    3000
                );
            }
        }
    }

    get_by_name(name) {
        if (Utils.is_blank(name)) return false;

        for (let translator of this._translators) {
            if (translator.name.toLowerCase() === name.toLowerCase()) {
                return translator;
            }
        }

        return false;
    }

    get current() {
        return this._current;
    }

    set current(translator_object_or_name) {
        let name = translator_object_or_name;
        let translator = translator_object_or_name;

        if (translator_object_or_name instanceof TranslationProviderBase) {
            name = translator_object_or_name.name;
        } else {
            translator = this.get_by_name(name);
        }

        if (!translator || !this._is_translator_available(translator)) {
            translator = this._get_fallback_translator();
            name = translator.name;
        }

        this._current = translator;
        Utils.SETTINGS.set_string(PrefsKeys.LAST_TRANSLATOR_KEY, name);
    }

    get last_used() {
        let name = Utils.SETTINGS.get_string(PrefsKeys.LAST_TRANSLATOR_KEY);
        let translator = this.get_by_name(name);
        
        if (!translator || !this._is_translator_available(translator)) {
            return false;
        }

        return translator;
    }

    get default() {
        return this._default;
    }

    get available_translators_names() {
        return this._available_translators.map(t => t.name);
    }

    get translators_names() {
        return this._translators.map(t => t.name);
    }

    get available_translators() {
        return this._available_translators;
    }

    get translators() {
        return this._translators;
    }

    get num_translators() {
        return this._available_translators.length;
    }

    destroy() {
        if (this._settingsChangedId) {
            Utils.SETTINGS.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        for (let translator of this._translators) {
            translator.destroy();
        }
        
        this._translators = [];
        this._available_translators = [];
    }
};