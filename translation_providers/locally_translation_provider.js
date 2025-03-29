const ByteArray = imports.byteArray;
const Lang = imports.lang;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const TranslationProviderBase = Me.imports.translation_provider_base;
const GLib = imports.gi.GLib;
const _ = Me.imports.gettext._;
const TranslationProviderBase = Me.imports.translation_provider_base.TranslationProviderBase;
const Gio = imports.gi.Gio;

const ENGINE = "Locally";

var Translator = class Locally extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + ".Translate");
        this.engine = ENGINE;
        if (!GLib.find_program_in_path("translateLocally")) {
            throw new Error(_("translateLocally is not installed or not in PATH"));
        }
        this.models = this.getAvailableModels();
    }

    getAvailableModels() {
        let [success, stdout, stderr, exit_status] = GLib.spawn_command_line_sync("translateLocally -l");
        if (!success || exit_status !== 0) {
            throw new Error(_("Could not get translateLocally models: %s").format(stderr));
        }
        let models = {};
        let lines = ByteArray.toString(stdout).split("\n");
        for (let line of lines) {
            // Ignora le linee che contengono "QVariant"
            if (line.includes("QVariant")) continue;
            
            let match = line.match(/([a-zA-Z]+)-([a-zA-Z]+)\s+type:\s+(\w+)\s+version:\s+(\d+);\s+To invoke do -m ([a-zA-Z0-9-]+)/);
            if (match) {
                let [_, src, tgt, type, version, model] = match;
                if (!models[src]) models[src] = {};
                models[src][tgt] = model;
            }
        }
        log(_("Available models: %s").format(JSON.stringify(models)));
        return models;
    }

    translate(source_lang, target_lang, text, callback) {
        if (!text || text.trim().length === 0) {
            callback(null, _("Empty text to translate"));
            return;
        }

        // Normalizza i codici lingua
        source_lang = source_lang.toLowerCase();
        target_lang = target_lang.toLowerCase();

        // Traduzione diretta
        let directModel = this.models[source_lang] && this.models[source_lang][target_lang];
        if (directModel) {
            this._translateWithModel(directModel, text, callback);
            return;
        }

        // Traduzione a due passaggi con inglese come lingua ponte
        let bridgeLang = "en";
        let firstModel = this.models[source_lang] && this.models[source_lang][bridgeLang];
        let secondModel = this.models[bridgeLang] && this.models[bridgeLang][target_lang];
        if (firstModel && secondModel) {
            this._translateWithModel(firstModel, text, (intermediateText, error) => {
                if (error) {
                    callback(null, error);
                    return;
                }
                this._translateWithModel(secondModel, intermediateText, callback);
            });
            return;
        }

        // Nessun percorso disponibile
        callback(null, _("No model available to translate from %s to %s").format(source_lang, target_lang));
    }
	
    translateFile(inputPath, sourceLang, targetLang) {
        // Normalizza i codici lingua
        sourceLang = sourceLang.toLowerCase();
        targetLang = targetLang.toLowerCase();

        // Determina il modello da usare
        let model = this.models[sourceLang] && this.models[sourceLang][targetLang];
        if (!model) {
            log(`No direct model available for ${sourceLang} to ${targetLang}`);
            return null;
        }

        // Crea il percorso del file di output
        let outputPath = inputPath.slice(0, inputPath.lastIndexOf('.')) + 
                        '_translateLocally-' + sourceLang + '-' + targetLang + '.txt';
        
        try {
            // Verifica che il file di input esista
            let inputFile = Gio.File.new_for_path(inputPath);
            if (!inputFile.query_exists(null)) {
                throw new Error(_("Input file does not exist"));
            }

            // Esegui la traduzione
            let command = `cat "${inputPath}" | translateLocally -m ${model} > "${outputPath}"`;
            let [success, stdout, stderr, exit_status] = GLib.spawn_command_line_sync(command);

            if (!success || exit_status !== 0) {
                throw new Error(ByteArray.toString(stderr));
            }

            // Verifica che il file di output sia stato creato
            let outputFile = Gio.File.new_for_path(outputPath);
            if (!outputFile.query_exists(null)) {
                throw new Error(_("Failed to create output file"));
            }

            return outputPath;
        } catch (e) {
            log(`Error translating file: ${e.message}`);
            return null;
        }
    }

    // Metodo per verificare se un file può essere tradotto
    canTranslateFile(sourceLang, targetLang) {
        sourceLang = sourceLang.toLowerCase();
        targetLang = targetLang.toLowerCase();
        return !!(this.models[sourceLang] && this.models[sourceLang][targetLang]);
    }

    _translateWithModel(model, text, callback) {
        let command = ["translateLocally", "-m", model];
        let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            null, command, null, GLib.SpawnFlags.SEARCH_PATH, null
        );
        if (!success) {
            callback(null, _("Error executing translateLocally"));
            return;
        }
        
        let stdinStream = GLib.fdopen(stdin, "w");
        stdinStream.write(text + "\n");
        stdinStream.close();
        
        let stdoutStream = GLib.IOChannel.unix_new(stdout);
        stdoutStream.set_encoding(null);
        
        let watch_id = GLib.io_add_watch(stdout, GLib.PRIORITY_DEFAULT,
            GLib.IOCondition.IN | GLib.IOCondition.HUP,
            (channel, condition) => {
                if (condition & GLib.IOCondition.IN) {
                    try {
                        let [status, output] = channel.read_line();
                        if (status) {
                            let line = ByteArray.toString(output);
                            if (!line.includes("QVariant")) {
                                callback(line.trim(), null);
                            }
                        }
                        return true;
                    } catch (e) {
                        callback(null, _("Error reading output: %s").format(e.message));
                        return false;
                    }
                }
                
                if (condition & GLib.IOCondition.HUP) {
                    GLib.source_remove(watch_id);
                    GLib.close(stdout);
                    return false;
                }
                return true;
            }
        );
    }

    isAvailable() {
        return GLib.find_program_in_path("translateLocally") !== null;
    }
};

Translator.NAME = ENGINE;