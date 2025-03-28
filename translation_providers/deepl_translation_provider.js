const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Lang = imports.lang;
const TranslationProviderBase = Me.imports.translation_provider_base;
const Soup = imports.gi.Soup;

const ENGINE = "Deepl";
const DEEPL_FREE_API_URL = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_API_URL = "https://api.deepl.com/v2/translate";

var Translator = class Deepl extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + ".Translate");
        this.engine = ENGINE;
        this._httpSession = null;
        
        // Recupera la chiave API dalle impostazioni
        this.api_key = Utils.SETTINGS.get_string("deepl-api-key");
        
        // Valida la chiave API
        if (!this._validateApiKey(this.api_key)) {
            log("Deepl: API key non valida o mancante");
            this.api_key = null;
        }
        
        // Connetti il segnale per aggiornare la chiave API quando cambia
        this._settingsChangedId = Utils.SETTINGS.connect(
            'changed::deepl-api-key',
            () => {
                this.api_key = Utils.SETTINGS.get_string("deepl-api-key");
                if (!this._validateApiKey(this.api_key)) {
                    log("Deepl: Nuova API key non valida");
                    this.api_key = null;
                }
            }
        );
    }

    _initHttpSession() {
        if (this._httpSession)
            return;
            
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

    _validateApiKey(key) {
        // Verifica che la chiave API sia nel formato corretto
        if (!key) return false;
        
        // Verifica il formato della chiave API Deepl
        // Le chiavi free iniziano con 'fx' dopo i due punti
        const freeApiPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:fx$/;
        // Le chiavi pro non hanno il suffisso ':fx'
        const proApiPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
        
        return freeApiPattern.test(key) || proApiPattern.test(key);
    }

    isAvailable() {
        return this._validateApiKey(this.api_key);
    }

    translate(source_lang, target_lang, text, callback) {
        if (!this.isAvailable()) {
            callback(null, "Deepl: API key non configurata o non valida. Configurala nelle preferenze dell'estensione.");
            return;
        }

        // Normalizza e valida i codici lingua
        source_lang = source_lang.toUpperCase();
        target_lang = target_lang.toUpperCase();

        if (!this._validateLanguageCode(target_lang)) {
            callback(null, `Lingua di destinazione '${target_lang}' non supportata da Deepl.`);
            return;
        }

        if (source_lang !== 'AUTO' && !this._validateLanguageCode(source_lang)) {
            callback(null, `Lingua sorgente '${source_lang}' non supportata da Deepl.`);
            return;
        }

        let url = this._getApiUrl();
        let params = {
            "auth_key": this.api_key,
            "text": text,
            "target_lang": target_lang
        };

        // Aggiungi source_lang solo se non è 'AUTO'
        if (source_lang !== 'AUTO') {
            params["source_lang"] = source_lang;
        }

        try {
            this._initHttpSession();
            let message = Soup.form_request_new_from_hash('POST', url, params);
            
            // Aggiungi headers necessari
            message.request_headers.append('Content-Type', 'application/x-www-form-urlencoded');
            message.request_headers.append('User-Agent', 'GnomeShellExtension/1.0');

            this._httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    let errorMsg;
                    try {
                        let error = JSON.parse(msg.response_body.data);
                        errorMsg = error.message || `Errore HTTP ${msg.status_code}`;
                    } catch(e) {
                        errorMsg = `Errore Deepl: ${msg.status_code} - ${msg.response_body.data}`;
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
                        callback(null, "Risposta non valida da Deepl");
                    }
                } catch(e) {
                    callback(null, `Errore nel parsing della risposta: ${e.message}`);
                }
            });
        } catch(e) {
            callback(null, `Errore nell'invio della richiesta: ${e.message}`);
        }
    }

    destroy() {
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        super.destroy();
    }
};

Translator.NAME = ENGINE;