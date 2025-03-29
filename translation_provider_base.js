const Soup = imports.gi.Soup;
const ExtensionUtils = imports.misc.extensionUtils;

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const PrefsKeys = Me.imports.prefs_keys;

var _httpSession = Utils._httpSession;

const LANGUAGES_LIST = {
    auto: "Detect language",
    af: "Afrikaans",
    ar: "Arabic",
    az: "Azerbaijani",
    be: "Belarusian",
    bg: "Bulgarian",
    bn: "Bengali",
    ca: "Catalan",
    cs: "Czech",
    cy: "Welsh",
    da: "Danish",
    de: "German",
    el: "Greek",
    en: "English",
    es: "Spanish",
    et: "Estonian",
    eu: "Basque",
    fa: "Persian",
    fi: "Finnish",
    fr: "French",
    ga: "Irish",
    gl: "Galician",
    gu: "Gujarati",
    hi: "Hindi",
    hr: "Croatian",
    ht: "HaitianCreole",
    hu: "Hungarian",
    hy: "Armenian",
    id: "Indonesian",
    is: "Icelandic",
    it: "Italian",
    iw: "Hebrew",
    ja: "Japanese",
    ka: "Georgian",
    kn: "Kannada",
    ko: "Korean",
    la: "Latin",
    lo: "Lao",
    lt: "Lithuanian",
    lv: "Latvian",
    mk: "Macedonian",
    ms: "Malay",
    mt: "Maltese",
    nl: "Dutch",
    no: "Norwegian",
    pl: "Polish",
    pt: "Portuguese",
    ro: "Romanian",
    ru: "Russian",
    sk: "Slovak",
    sl: "Slovenian",
    sq: "Albanian",
    sr: "Serbian",
    sv: "Swedish",
    sw: "Swahili",
    ta: "Tamil",
    te: "Telugu",
    th: "Thai",
    tl: "Filipino",
    tr: "Turkish",
    uk: "Ukrainian",
    ur: "Urdu",
    vi: "Vietnamese",
    yi: "Yiddish",
    "zh-CN": "Chinese Simplified",
    "zh-TW": "Chinese Traditional"
};

var TranslationProviderPrefs = class TranslationProviderPrefs {
    constructor(provider_name) {
        this._name = provider_name;

        this._settings_connect_id = Utils.SETTINGS.connect(
            "changed::" + PrefsKeys.TRANSLATORS_PREFS_KEY,
            () => this._load_prefs()
        );

        // this._last_source;
        // this._last_target;
        // this._default_source;
        // this._default_target;
        // this._remember_last_lang;

        this._load_prefs();
    }

    _load_prefs() {
        let json_string = Utils.SETTINGS.get_string(PrefsKeys.TRANSLATORS_PREFS_KEY);
        let prefs = {};
        try {
            prefs = JSON.parse(json_string);
        } catch (e) {
            prefs = {};
        }

        // Se le preferenze per questo traduttore non esistono, creale
        if (prefs[this._name] === undefined) {
            prefs[this._name] = {
                default_source: "en",
                default_target: "it",
                last_source: "",
                last_target: "",
                remember_last_lang: true
            };
            // Salva le preferenze aggiornate
            Utils.SETTINGS.set_string(PrefsKeys.TRANSLATORS_PREFS_KEY, JSON.stringify(prefs));
        }

        let provider_prefs = prefs[this._name];
        this._default_source = provider_prefs.default_source || "en";
        this._default_target = provider_prefs.default_target || "it";
        this._last_source = provider_prefs.last_source || "";
        this._last_target = provider_prefs.last_target || "";
        this._remember_last_lang = provider_prefs.remember_last_lang || false;
    }

    save_prefs(new_prefs) {
        let json_string = Utils.SETTINGS.get_string(
            PrefsKeys.TRANSLATORS_PREFS_KEY
        );
        let current_prefs = JSON.parse(json_string);
        let temp = {};

        if (current_prefs[this._name] != undefined) {
            temp = current_prefs[this._name];
        }

        for (let key in new_prefs) {
            temp[key] = new_prefs[key];
        }

        current_prefs[this._name] = temp;

        Utils.SETTINGS.set_string(
            PrefsKeys.TRANSLATORS_PREFS_KEY,
            JSON.stringify(current_prefs)
        );
    }

    destroy() {
        if (this._settings_connect_id > 0) {
            Utils.SETTINGS.disconnect(this._settings_connect_id);
        }
    }

    get last_source() {
        return !Utils.is_blank(this._last_source) ? this._last_source : false;
    }

    set last_source(lang_code) {
        this._last_source = lang_code;
        this.save_prefs({
            last_source: lang_code
        });
    }

    get last_target() {
        return !Utils.is_blank(this._last_target) ? this._last_target : false;
    }

    set last_target(lang_code) {
        this._last_target = lang_code;
        this.save_prefs({
            last_target: lang_code
        });
    }

    get default_source() {
        return this._default_source;
    }

    set default_source(lang_code) {
        this._default_source = lang_code;
        this.save_prefs({
            default_source: lang_code
        });
    }

    get default_target() {
        return this._default_target;
    }

    set default_target(lang_code) {
        this._default_target = lang_code;
        this.save_prefs({
            default_target: lang_code
        });
    }

    get remember_last_lang() {
        return this._remember_last_lang;
    }

    set remember_last_lang(enable) {
        enable = enable === true ? true : false;
        this._remember_last_lang = enable;
        this.save_prefs({
            remember_last_lang: enable
        });
    }
};

var TranslationProviderBase = class TranslationProviderBase {
    constructor(name, limit, url) {
        this._name = name;
        this._limit = limit;
        this._url = url;
        this.engine = name.split('.')[0].toLowerCase(); // Estrae il nome del motore
        this.prefs = new TranslationProviderPrefs(this._name);
        this.supported_languages = [];
    }

    _validateApiKey(key) {
        return typeof key === 'string' && key.length > 0;
    }
    
    _get_data_async(url, callback) {
        if (!_httpSession) {
            log("Error: _httpSession not initialized");
            callback("");
            return;
        }

        let request = Soup.Message.new("GET", url);

        _httpSession.queue_message(request, (_httpSession, message) => {
            if (message.status_code === 200) {
                try {
                    callback(request.response_body.data);
                } catch (e) {
                    log("Error: " + e);
                    callback("");
                }
            } else {
                callback("");
            }
        });
    }

    make_url(source_lang, target_lang, text) {
        let result = this._url.format(
            source_lang,
            target_lang,
            encodeURIComponent(text)
        );
        return result;
    }

    get_languages() {
        let result = {};
        for (let lang of this.supported_languages) {
            result[lang.code] = lang.name;
        }
        return result;
    }

    get_language_name(code) {
        let languages = this.get_languages();
        return languages[code] || code;
    }

    get_pairs(source) {
        return this.get_languages();
    }

    parse_response(helper_source_data) {
        throw new Error("Not implemented");
    }

    translate(source_lang, target_lang, text, callback) {
        let command = [
            "trans",
            "-e",
            this.engine,
            "--show-original",
            "n",
            "--show-languages",
            "n",
            "--show-prompt-message",
            "n",
            "--no-bidi",
            "-s",
            source_lang,
            "-t",
            target_lang,
            text
        ];

        log('translating: ' + command.join(' '))

        this._exec(command, (out, err) => {
            callback(
                err
                    ? this._escape_html(
                          "Please make sure both gawk and translate-shell are installed. Error: " +
                              err
                      )
                    : this._escape_translation(out)
            );
            //   : command.join(' '))
        });
    }

    _escape_translation(str) {
        if (!str) return "";

        let stuff = {
            "\x1B[1m": "<b>",
            "\x1B[22m": "</b>",
            "\x1B[4m": "<u>",
            "\x1B[24m": "</u>"
        };
        str = this._escape_html(str);
        for (let hex in stuff) {
            str = this._replace_all(str, hex, stuff[hex]);
        }
        return str;
    }

    _replace_all(str, find, replace) {
        return (str || "").split(find).join(replace);
    }

    _escape_html(str) {
        return (str || "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    _exec(cmd, exec_cb) {
        try {
            var [res, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(
                null,
                cmd,
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
            var out_reader = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({ fd: out_fd })
            });
        } catch (e) {
            exec_cb && exec_cb(null, e);
            return;
        }

        let output = "";
        function _SocketRead(source_object, res) {
            const [chunk, length] = out_reader.read_upto_finish(res);
            if (chunk !== null) {
                output += chunk + "\n";
                // output+= ".,"+chunk+",."+ (typeof chunk)+'||'+length+'\n';
                out_reader.read_line_async(null, null, _SocketRead);
            } else {
                exec_cb && exec_cb(output);
            }
        }
        out_reader.read_line_async(null, null, _SocketRead);
    }

    get name() {
        return this._name;
    }

    get limit() {
        return this._limit;
    }

    destroy() {
        this.prefs.destroy();
    }
};
