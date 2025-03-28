const ExtensionUtils = imports.misc.extensionUtils;  // Importa ExtensionUtils
const Me = ExtensionUtils.getCurrentExtension();     // Ottieni l'estensione corrente
const Utils = Me.imports.utils;                      // Importa utils.js
const Lang = imports.lang;                           // Importa il modulo lang (se necessario)
const TranslationProviderBase = Me.imports.translation_provider_base;  // Importa la base provider
const Soup = imports.gi.Soup;                        // Importa Soup per le richieste HTTP

const ENGINE = "Deepl";

var Translator = class Deepl extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + "Deepl.Translate");
        this.engine = ENGINE;
        // Recupera la chiave API dalle impostazioni
        this.api_key = Utils.SETTINGS.get_string("deepl-api-key");
        if (!this.api_key) {
            throw new Error("Deepl API key non configurata. Impostala nelle preferenze.");
        }
    }

    // Override del metodo di traduzione
    translate(source_lang, target_lang, text, callback) {
        let url = "https://api.deepl.com/v2/translate";
        let params = {
            "auth_key": this.api_key,
            "text": text,
            "source_lang": source_lang.toUpperCase(),
            "target_lang": target_lang.toUpperCase()
        };

        let session = new Soup.Session();
        let message = Soup.form_request_new_from_hash("POST", url, params);

        session.queue_message(message, (session, msg) => {
            if (msg.status_code !== 200) {
                callback(null, `Errore Deepl: ${msg.status_code} - ${msg.response_body.data}`);
                return;
            }
            let response = JSON.parse(msg.response_body.data);
            let translatedText = response.translations[0].text;
            callback(translatedText, null);
        });
    }
};

Translator.NAME = ENGINE;