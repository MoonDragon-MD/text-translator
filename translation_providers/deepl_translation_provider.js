const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Lang = imports.lang;
const TranslationProviderBase = Me.imports.translation_provider_base;
const Soup = imports.gi.Soup;
const _ = Me.imports.gettext._;

const ENGINE = "Deepl";
const DEEPL_FREE_API_URL = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_API_URL = "https://api.deepl.com/v2/translate";

var Translator = class Deepl extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + ".Translate");
        this.engine = ENGINE;
        this._httpSession = null;
        this._initHttpSession();
        
        // Recupera la chiave API dalle impostazioni
        this.api_key = Utils.SETTINGS.get_string("deepl-api-key");
        
        // Valida la chiave API
        if (!this._validateApiKey(this.api_key)) {
            log(_("Deepl: API key not configured or invalid"));
            this.api_key = null;
        }
        
        // Connetti il segnale per aggiornare la chiave API quando cambia
        this._settingsChangedId = Utils.SETTINGS.connect(
            'changed::deepl-api-key',
            () => {
                this.api_key = Utils.SETTINGS.get_string("deepl-api-key");
                if (!this._validateApiKey(this.api_key)) {
                    log(_("Deepl: New API key is invalid"));
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

    _getApiUrl() {
        // Se la chiave API contiene ":fx", usa l'API gratuita
        return this.api_key.includes(":fx") ? DEEPL_FREE_API_URL : DEEPL_PRO_API_URL;
    }

    _validateLanguageCode(code) {
        // Validazione codici lingua supportati da Deepl
        const supported = [
            'BG','CS','DA','DE','EL','EN','ES','ET','FI','FR','HU','ID',
            'IT','JA','LT','LV','NL','PL','PT','RO','RU','SK','SL','SV',
            'TR','UK','ZH'
        ];
        return supported.includes(code.toUpperCase());
    }

    translate(source_lang, target_lang, text, callback) {
        if (!this.isAvailable()) {
            callback(null, _("Deepl: API key not configured or invalid. Configure it in extension preferences."));
            return;
        }

        if (!text || text.trim().length === 0) {
            callback(null, _("Empty text to translate"));
            return;
        }

        // Normalizza e valida i codici lingua
        source_lang = source_lang.toUpperCase();
        target_lang = target_lang.toUpperCase();

        if (!this._validateLanguageCode(target_lang)) {
            callback(null, _("Target language '%s' not supported by Deepl").format(target_lang));
            return;
        }

        if (source_lang !== 'AUTO' && !this._validateLanguageCode(source_lang)) {
            callback(null, _("Source language '%s' not supported by Deepl").format(source_lang));
            return;
        }

        let url = this._getApiUrl();
        let params = {
            "auth_key": this.api_key,
            "text": text,
            "target_lang": target_lang
        };

        if (source_lang !== 'AUTO') {
            params["source_lang"] = source_lang;
        }

        try {
            this._initHttpSession();
            let message = Soup.form_request_new_from_hash('POST', url, params);
            
            message.request_headers.append('Content-Type', 'application/x-www-form-urlencoded');
            message.request_headers.append('User-Agent', 'GnomeShellExtension/1.0');

            this._httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    let errorMsg;
                    try {
                        let error = JSON.parse(msg.response_body.data);
                        errorMsg = error.message || _("HTTP Error %d").format(msg.status_code);
                    } catch(e) {
                        errorMsg = _("Deepl Error: %d - %s").format(msg.status_code, msg.response_body.data);
                    }
                    callback(null, errorMsg);
                    return;
                }

                try {
                    let response = JSON.parse(msg.response_body.data);
                    if (response.translations && response.translations.length > 0) {
                        let translatedText = response.translations[0].text;
                        callback(translatedText, null);
                    } else {
                        callback(null, _("Invalid response from Deepl"));
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