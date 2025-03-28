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
        let lines = ByteArray.toString(stdout).split("\\n");
        for (let line of lines) {
            let match = line.match(/(\\w+)-(\\w+)\\s+type:\\s+(\\w+)\\s+version:\\s+(\\d+);\\s+To invoke do -m (\\w+-\\w+-\\w+)/);
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
        let stdinStream = GLib.fdopen(stdin, "w");
        stdinStream.write(text + "\\n");
        stdinStream.close();
        let stdoutStream = GLib.IOChannel.unix_new(stdout);
        stdoutStream.set_encoding(null);
        stdoutStream.read_to_end_async(0, (chan, res) => {
            try {
                let [data] = stdoutStream.read_to_end_finish(res);
                let output = data.toString().trim();
                callback(output, null);
            } catch (e) {
                callback(null, `Errore nella lettura dell'output: ${e}`);
            }
            GLib.close(stdout);
        });
    }
};

Translator.NAME = ENGINE;