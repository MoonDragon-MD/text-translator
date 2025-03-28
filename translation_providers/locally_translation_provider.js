// Ensure the 'Locally' translation feature correctly fetches and uses available models
const ByteArray = imports.byteArray;
const Lang = imports.lang;
const Extension = imports.misc.extensionUtils.get_text_translator_extension();
const TranslationProviderBase = Extension.imports.translation_provider_base;
const GLib = imports.gi.GLib;

const ENGINE = "Locally";

var Translator = class Locally extends TranslationProviderBase.TranslationProviderBase {
    constructor() {
        super(ENGINE + ".Translate");
        this.engine = ENGINE;
        if (!GLib.find_program_in_path("translateLocally")) {
            throw new Error("translateLocally non è installato o non è nel PATH.");
        }
        this.models = this.getAvailableModels();
    }

    getAvailableModels() {
        let [success, stdout, stderr, exit_status] = GLib.spawn_command_line_sync("translateLocally -l");
        if (!success || exit_status !== 0) {
            throw new Error("Impossibile ottenere i modelli di translateLocally: " + stderr);
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
        log('Modelli disponibili: ' + JSON.stringify(models));
        return models;
    }

    translate(source_lang, target_lang, text, callback) {
        if (!text || text.trim().length === 0) {
            callback(null, "Il testo da tradurre non può essere vuoto.");
            return;
        }

        // Normalizza i codici lingua
        source_lang = source_lang.toLowerCase();
        target_lang = target_lang.toLowerCase();

        // Traduzione diretta
        let directModel = this.models[source_lang] && this.models[source_lang][target_lang];
        if (directModel) {
            if (this._isValidModel(directModel)) {
                this._translateWithModel(directModel, text, callback);
                return;
            }
        }

        // Traduzione a due passaggi con inglese come lingua ponte
        let bridgeLang = "en";
        let firstModel = this.models[source_lang] && this.models[source_lang][bridgeLang];
        let secondModel = this.models[bridgeLang] && this.models[bridgeLang][target_lang];
        
        if (firstModel && secondModel && this._isValidModel(firstModel) && this._isValidModel(secondModel)) {
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
        callback(null, `Nessun modello disponibile per tradurre da ${source_lang} a ${target_lang}.`);
    }

    _translateWithModel(model, text, callback) {
        let command = ["translateLocally", "-m", model];
        let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
            null, command, null, GLib.SpawnFlags.SEARCH_PATH, null
        );
        if (!success) {
            callback(null, "Errore nell'esecuzione di translateLocally.");
            return;
        }

        // Utilizziamo un buffer per accumulare l'output
        let outputBuffer = '';
        
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
                            // Ignora le linee che contengono "QVariant"
                            if (!line.includes("QVariant")) {
                                outputBuffer += line;
                            }
                        }
                        return true;
                    } catch (e) {
                        callback(null, `Errore nella lettura dell'output: ${e}`);
                        return false;
                    }
                }
                
                if (condition & GLib.IOCondition.HUP) {
                    GLib.source_remove(watch_id);
                    GLib.close(stdout);
                    // Restituisci il testo tradotto pulito
                    callback(outputBuffer.trim(), null);
                    return false;
                }
                return true;
            }
        );
    }
	
    _isValidModel(modelName) {
        // Verifica che il nome del modello sia nel formato corretto (es: en-it-tiny)
        return /^[a-z]{2}-[a-z]{2}-[a-z]+$/.test(modelName);
    }
};

Translator.NAME = ENGINE;