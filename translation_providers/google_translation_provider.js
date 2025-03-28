const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const TranslationProviderBase = Me.imports.translation_provider_base;
const Soup = imports.gi.Soup;
const _ = Me.imports.gettext._;

const ENGINE = "Google";
const API_URL = "https://translate.googleapis.com/translate_a/single";

var Translator = class Google extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + ".Translate");
        this.engine = ENGINE;
        this._httpSession = null;
        this._initHttpSession();
    }

    _initHttpSession() {
        if (this._httpSession) return;
        
        this._httpSession = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(
            this._httpSession,
            new Soup.ProxyResolverDefault()
        );
    }

    _validateLanguageCode(code) {
        // Validazione codici lingua supportati da Google
        const supported = [
            'af','ar','az','be','bg','bn','bs','ca','ceb','cs','cy','da','de',
            'el','en','eo','es','et','eu','fa','fi','fr','ga','gl','gu','ha',
            'he','hi','hmn','hr','ht','hu','hy','id','ig','is','it','ja','jw',
            'ka','kk','km','kn','ko','la','lo','lt','lv','mg','mi','mk','ml',
            'mn','mr','ms','mt','my','ne','nl','no','ny','pa','pl','pt','ro',
            'ru','si','sk','sl','so','sq','sr','st','su','sv','sw','ta','te',
            'tg','th','tl','tr','uk','ur','uz','vi','yi','yo','zh','zu'
        ];
        return supported.includes(code.toLowerCase());
    }

    translate(source_lang, target_lang, text, callback) {
        if (!text || text.trim().length === 0) {
            callback(null, _("Empty text to translate"));
            return;
        }

        // Normalizza e valida i codici lingua
        source_lang = source_lang.toLowerCase();
        target_lang = target_lang.toLowerCase();

        if (!this._validateLanguageCode(target_lang)) {
            callback(null, _("Target language '%s' not supported by Google").format(target_lang));
            return;
        }

        if (source_lang !== 'auto' && !this._validateLanguageCode(source_lang)) {
            callback(null, _("Source language '%s' not supported by Google").format(source_lang));
            return;
        }

        let params = {
            'client': 'gtx',
            'sl': source_lang,
            'tl': target_lang,
            'dt': 't',
            'q': text
        };

        let message = Soup.form_request_new_from_hash('GET', API_URL, params);
        
        message.request_headers.append('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        message.request_headers.append('Accept', '*/*');

        try {
            this._initHttpSession();
            this._httpSession.queue_message(message, (session, msg) => {
                if (msg.status_code !== 200) {
                    callback(null, _("HTTP Error %d").format(msg.status_code));
                    return;
                }

                try {
                    let response = JSON.parse(msg.response_body.data);
                    if (response && response[0] && response[0][0]) {
                        let translatedText = '';
                        // Concatena tutte le parti tradotte
                        for (let part of response[0]) {
                            if (part[0]) {
                                translatedText += part[0];
                            }
                        }
                        callback(translatedText.trim(), null);
                    } else {
                        callback(null, _("Invalid response from Google"));
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
        return true; // Il traduttore Google è sempre disponibile
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