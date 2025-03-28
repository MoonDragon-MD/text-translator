const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const TranslationProviderBase = Me.imports.translation_provider_base;
const Utils = Me.imports.utils;
const Soup = imports.gi.Soup;
const _ = Me.imports.gettext._;

const ENGINE = "Yandex";
const API_URL = "https://translate.yandex.net/api/v1.5/tr.json/translate";

var Translator = class Yandex extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + ".Translate");
        this.engine = ENGINE;
        this._httpSession = null;
        this._initHttpSession();
        
        // Recupera la chiave API dalle impostazioni
        this.api_key = Utils.SETTINGS.get_string("yandex-api-key");
        
        // Valida la chiave API
        if (!this._validateApiKey(this.api_key)) {
            log(_("Yandex: API key not configured or invalid"));
            this.api_key = null;
        }
        
        // Connetti il segnale per aggiornare la chiave API quando cambia
        this._settingsChangedId = Utils.SETTINGS.connect(
            'changed::yandex-api-key',
            () => {
                this.api_key = Utils.SETTINGS.get_string("yandex-api-key");
                if (!this._validateApiKey(this.api_key)) {
                    log(_("Yandex: New API key is invalid"));
                    this.api_key = null;
                }
            }
        );
    }

    _initHttpSession() {
        if (this._httpSession) return;
        
        this._httpSession = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(
            this._httpSession,
            new Soup.ProxyResolverDefault()
        );
    }

    _validateApiKey(key) {
        return key && key.length > 0;
    }

    _validateLanguageCode(code) {
        // Validazione codici lingua supportati da Yandex
        const supported = [
            'az','be','bg','ca','cs','da','de','el','en','es','et','fi','fr',
            'he','hr','hu','hy','it','lt','lv','mk','nl','no','pl','pt','ro',
            'ru','sk','sl','sq','sr','sv','tr','uk','vi'
        ];
        return supported.includes(code.toLowerCase());
    }

    translate(source_lang, target_lang, text, callback) {
        if (!this.isAvailable()) {
            callback(null, _("Yandex: API key not configured or invalid. Configure it in extension preferences."));
            return;
        }

        if (!text || text.trim().length === 0) {
            callback(null, _("Empty text to translate"));
            return;
        }

        // Normalizza e valida i codici lingua
        source_lang = source_lang.toLowerCase();
        target_lang = target_lang.toLowerCase();

        if (!this._validateLanguageCode(target_lang)) {
            callback(null, _("Target language '%s' not supported by Yandex").format(target_lang));
            return;
        }

        if (source_lang !== 'auto' && !this._validateLanguageCode(source_lang)) {
            callback(null, _("Source language '%s' not supported by Yandex").format(source_lang));
            return;
        }

        let lang = source_lang === 'auto' ? target_lang : source_lang + '-' + target_lang;
        let params = {
            'key': this.api_key,
            'text': text,
            'lang': lang,
            'format': 'plain'
        };

        let message = Soup.form_request_new_from_hash('POST', API_URL, params);
        
        try {
            this._initHttpSession();
            this._httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    let errorMsg;
                    try {
                        let error = JSON.parse(msg.response_body.data);
                        errorMsg = _("Yandex Error: %s").format(error.message || msg.status_code);
                    } catch(e) {
                        errorMsg = _("HTTP Error %d").format(msg.status_code);
                    }
                    callback(null, errorMsg);
                    return;
                }

                try {
                    let response = JSON.parse(msg.response_body.data);
                    if (response.text && response.text.length > 0) {
                        callback(response.text.join(' '), null);
                    } else {
                        callback(null, _("Invalid response from Yandex"));
                    }
                } catch(e) {
                    callback(null, _("Error parsing response: %s").format(e.message));
                }
            });
        } catch(e) {
            callback(null, _("Error sending request: %s").format(e.message));
        }
    }

    isAvailable() {
        return this._validateApiKey(this.api_key);
    }

    destroy() {
        if (this._settingsChangedId) {
            Utils.SETTINGS.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        super.destroy();
    }
};

Translator.NAME = ENGINE;