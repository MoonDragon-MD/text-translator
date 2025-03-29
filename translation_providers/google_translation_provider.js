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

        // Lista delle lingue supportate
        this.supported_languages = [
            { code: 'af', name: 'Afrikaans' },
            { code: 'ar', name: 'Arabic' },
            { code: 'az', name: 'Azerbaijani' },
            { code: 'be', name: 'Belarusian' },
            { code: 'bg', name: 'Bulgarian' },
            { code: 'bn', name: 'Bengali' },
            { code: 'bs', name: 'Bosnian' },
            { code: 'ca', name: 'Catalan' },
            { code: 'ceb', name: 'Cebuano' },
            { code: 'cs', name: 'Czech' },
            { code: 'cy', name: 'Welsh' },
            { code: 'da', name: 'Danish' },
            { code: 'de', name: 'German' },
            { code: 'el', name: 'Greek' },
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
            { code: 'et', name: 'Estonian' },
            { code: 'eu', name: 'Basque' },
            { code: 'fa', name: 'Persian' },
            { code: 'fi', name: 'Finnish' },
            { code: 'fr', name: 'French' },
            { code: 'ga', name: 'Irish' },
            { code: 'gl', name: 'Galician' },
            { code: 'hi', name: 'Hindi' },
            { code: 'hr', name: 'Croatian' },
            { code: 'hu', name: 'Hungarian' },
            { code: 'id', name: 'Indonesian' },
            { code: 'is', name: 'Icelandic' },
            { code: 'it', name: 'Italian' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'lt', name: 'Lithuanian' },
            { code: 'lv', name: 'Latvian' },
            { code: 'nl', name: 'Dutch' },
            { code: 'no', name: 'Norwegian' },
            { code: 'pl', name: 'Polish' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'ro', name: 'Romanian' },
            { code: 'ru', name: 'Russian' },
            { code: 'sk', name: 'Slovak' },
            { code: 'sl', name: 'Slovenian' },
            { code: 'sr', name: 'Serbian' },
            { code: 'sv', name: 'Swedish' },
            { code: 'th', name: 'Thai' },
            { code: 'tr', name: 'Turkish' },
            { code: 'uk', name: 'Ukrainian' },
            { code: 'vi', name: 'Vietnamese' },
            { code: 'zh', name: 'Chinese' },
			{ code: 'eo', name: 'Esperanto' },
			{ code: 'gu', name: 'Gujarati' },
			{ code: 'ha', name: 'Hausa' },
			{ code: 'he', name: 'Hebrew' },
			{ code: 'hmn', name: 'Hmong' },
			{ code: 'ht', name: 'Haitian Creole' },
			{ code: 'hy', name: 'Armenian' },
			{ code: 'ig', name: 'Igbo' },
			{ code: 'jw', name: 'Javanese' },
			{ code: 'ka', name: 'Georgian' },
			{ code: 'kk', name: 'Kazakh' },
			{ code: 'km', name: 'Khmer' },
			{ code: 'kn', name: 'Kannada' },
			{ code: 'la', name: 'Latin' },
			{ code: 'lo', name: 'Lao' },
			{ code: 'mg', name: 'Malagasy' },
			{ code: 'mi', name: 'Maori' },
			{ code: 'mk', name: 'Macedonian' },
			{ code: 'ml', name: 'Malayalam' },
			{ code: 'mn', name: 'Mongolian' },
			{ code: 'mr', name: 'Marathi' },
			{ code: 'ms', name: 'Malay' },
			{ code: 'mt', name: 'Maltese' },
			{ code: 'my', name: 'Myanmar (Burmese)' },
			{ code: 'ne', name: 'Nepali' },
			{ code: 'ny', name: 'Chichewa' },
			{ code: 'pa', name: 'Punjabi' },
			{ code: 'si', name: 'Sinhala' },
			{ code: 'so', name: 'Somali' },
			{ code: 'sq', name: 'Albanian' },
			{ code: 'st', name: 'Sesotho' },
			{ code: 'su', name: 'Sundanese' },
			{ code: 'sw', name: 'Swahili' },
			{ code: 'ta', name: 'Tamil' },
			{ code: 'te', name: 'Telugu' },
			{ code: 'tg', name: 'Tajik' },
			{ code: 'tl', name: 'Filipino' },
			{ code: 'ur', name: 'Urdu' },
			{ code: 'uz', name: 'Uzbek' },
			{ code: 'yi', name: 'Yiddish' },
			{ code: 'yo', name: 'Yoruba' },
			{ code: 'zu', name: 'Zulu' }
        ];
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
        return this.supported_languages.some(lang => lang.code === code.toLowerCase());
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
	
    get_languages() {
        let result = {};
        for (let lang of this.supported_languages) {
            result[lang.code] = lang.name;
        }
        return result;
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