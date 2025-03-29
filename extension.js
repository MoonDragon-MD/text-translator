(function() {
    // Imposta il percorso di ricerca per il typelib.
    const GIRepository = imports.gi.GIRepository;
    ["mutter", "gnome-shell", "gnome-bluetooth", "gnome-games"].forEach(
        function(path) {
            GIRepository.Repository.prepend_search_path("/usr/lib/" + path);
        }
    );
})();
const CONNECTION_IDS = {
    show_icon: 0,
    enable_shortcuts: 0
};
const St = imports.gi.St;
const GObject = imports.gi.GObject;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext;
const ExtensionUtils = imports.misc.extensionUtils;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Me = ExtensionUtils.getCurrentExtension();
const _ = Me.imports.gettext._;
const Utils = Me.imports.utils;
const TranslatorDialog = Me.imports.translator_dialog;
const StatusBar = Me.imports.status_bar;
const ButtonsBar = Me.imports.buttons_bar;
const LanguageChooser = Me.imports.language_chooser;
const TranslatorsManager = Me.imports.translators_manager;
const LanguagesStats = Me.imports.languages_stats;
const PrefsKeys = Me.imports.prefs_keys;

let textTranslator;
const TRIGGERS = {
    translate: true
};

const TIMEOUT_IDS = {
    instant_translation: 0
};

const INSTANT_TRANSLATION_DELAY = 1000; // 1 secondo
const TextTranslatorIndicator = GObject.registerClass(
class TextTranslatorIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _("Text Translator"));

        this.icon = new St.Icon({
            icon_name: 'accessories-dictionary-symbolic',
            style_class: 'system-status-icon'
        });
        this.add_child(this.icon);

        // Menu per la selezione del traduttore
        this._translatorSelector = new PopupMenu.PopupSubMenuMenuItem(_("Select Translator"));
        this.menu.addMenuItem(this._translatorSelector);

        // Menu per la selezione della lingua sorgente
        this._sourceLangSelector = new PopupMenu.PopupSubMenuMenuItem(_("Source Language"));
        this.menu.addMenuItem(this._sourceLangSelector);

        // Menu per la selezione della lingua di destinazione
        this._targetLangSelector = new PopupMenu.PopupSubMenuMenuItem(_("Target Language"));
        this.menu.addMenuItem(this._targetLangSelector);

        // Separatore
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Opzioni
        let settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
        settingsItem.connect('activate', () => {
            ExtensionUtils.openPrefs();
        });
        this.menu.addMenuItem(settingsItem);

        this._initTranslators();
        this._updateTranslatorsList();
        this._loadLanguages();
    }

    _initTranslators() {
        this._translatorManager = new TranslatorsManager.TranslatorsManager();
        
        // Carica l'ultimo traduttore usato o il predefinito
        let lastUsed = this._translatorManager.last_used;
        if (lastUsed) {
            this._translatorManager.current = lastUsed;
        }
    }

    _updateTranslatorsList() {
        // Rimuovi i vecchi elementi
        this._translatorSelector.menu.removeAll();

        // Aggiungi i traduttori disponibili
        for (let translator of this._translatorManager.available_translators) {
            let item = new PopupMenu.PopupMenuItem(translator.name);
            item.connect('activate', () => {
                this._translatorManager.current = translator;
                this._loadLanguages(); // Ricarica le lingue supportate
            });
            this._translatorSelector.menu.addMenuItem(item);

            // Evidenzia il traduttore corrente
            if (translator === this._translatorManager.current) {
                item.setOrnament(PopupMenu.Ornament.DOT);
            }
        }

        // Aggiorna il testo del menu
        this._translatorSelector.label.text = _("Translator: %s").format(
            this._translatorManager.current.name
        );
    }

    _loadLanguages() {
        // Rimuovi le vecchie voci
        this._sourceLangSelector.menu.removeAll();
        this._targetLangSelector.menu.removeAll();

        let current = this._translatorManager.current;
        if (!current || !current.get_languages) {
            log("Translator provider does not support language listing");
            return;
        }
        const languages = current.get_languages();

        // Aggiungi "Auto" solo per la lingua sorgente
        let autoItem = new PopupMenu.PopupMenuItem(_("Auto-detect"));
        autoItem.connect('activate', () => {
            Utils.SETTINGS.set_string(PrefsKeys.SOURCE_LANG_KEY, 'auto');
            this._sourceLangSelector.label.text = _("Source: Auto-detect");
        });
        this._sourceLangSelector.menu.addMenuItem(autoItem);

        // Carica le lingue supportate
        for (let lang of current.supported_languages) {
            // Lingua sorgente
            let sourceItem = new PopupMenu.PopupMenuItem(_(lang.name));
            sourceItem.connect('activate', () => {
                Utils.SETTINGS.set_string(PrefsKeys.SOURCE_LANG_KEY, lang.code);
                this._sourceLangSelector.label.text = _("Source: %s").format(_(lang.name));
            });
            this._sourceLangSelector.menu.addMenuItem(sourceItem);

            // Lingua destinazione
            let targetItem = new PopupMenu.PopupMenuItem(_(lang.name));
            targetItem.connect('activate', () => {
                Utils.SETTINGS.set_string(PrefsKeys.TARGET_LANG_KEY, lang.code);
                this._targetLangSelector.label.text = _("Target: %s").format(_(lang.name));
            });
            this._targetLangSelector.menu.addMenuItem(targetItem);
        }

        // Imposta le etichette correnti
        let currentSource = Utils.SETTINGS.get_string(PrefsKeys.SOURCE_LANG_KEY);
        let currentTarget = Utils.SETTINGS.get_string(PrefsKeys.TARGET_LANG_KEY);

        this._sourceLangSelector.label.text = currentSource === 'auto' 
            ? _("Source: Auto-detect")
            : _("Source: %s").format(_(current.get_language_name(currentSource)));

        this._targetLangSelector.label.text = _("Target: %s").format(
            _(current.get_language_name(currentTarget))
        );
    }

    destroy() {
        this._translatorManager.destroy();
        super.destroy();
    }
})

const TranslatorExtension = class TranslatorExtension { 
    constructor() {
        log("Translator Extension");
        this._current_source_lang = '';
        this._current_target_lang = '';
        this._dialog = new TranslatorDialog.TranslatorDialog(this);
        this._dialog.source.clutter_text.connect("text-changed", () => {
            let enable_instant_translation = Utils.SETTINGS.get_boolean(
                PrefsKeys.INSTANT_TRANSLATION_KEY
            );
            if (!enable_instant_translation) return;

            this._remove_timeouts("instant_translation");

            if (TRIGGERS.translate) {
                TIMEOUT_IDS.instant_translation = Mainloop.timeout_add(
                    INSTANT_TRANSLATION_DELAY,
                    () => this._translate()
                );
            } else {
                TRIGGERS.translate = true;
            }
        });
        this._dialog.dialog_layout.connect("key-press-event", (o, e) =>
            this._on_key_press_event(o, e)
        );
        this._translators_manager = new TranslatorsManager.TranslatorsManager(this);

        this._dialog.source.max_length = this._translators_manager.current.limit;
        this._dialog.source.connect("activate", () => this._translate());

        this._languages_stats = new LanguagesStats.LanguagesStats();
        this._add_topbar_buttons();
        this._add_dialog_menu_buttons();
        this._init_languages_chooser();
        this._set_current_languages();
        this._panel_button = false;

        this._init_most_used();
        Utils.SETTINGS.connect(
            "changed::%s".format(PrefsKeys.SHOW_MOST_USED_KEY),
            () => this._init_most_used()
        );
    }

    _init_most_used() {
        if (!Utils.SETTINGS.get_boolean(PrefsKeys.SHOW_MOST_USED_KEY)) return;

        this._languages_stats.connect("stats-changed", () =>
            this._show_most_used()
        );
        this._dialog.most_used.sources.connect("clicked", (object, data) => {
            this._dialog.most_used.sources.select(data.lang_code);
            this._set_current_source(data.lang_code);
            this._current_langs_changed();
        });
        this._dialog.most_used.targets.connect("clicked", (object, data) => {
            this._dialog.most_used.targets.select(data.lang_code);
            this._set_current_target(data.lang_code);
            this._current_langs_changed();
        });
    }

    _show_most_used() {
        if (!Utils.SETTINGS.get_boolean(PrefsKeys.SHOW_MOST_USED_KEY)) return;

        let most_used_sources = this._languages_stats.get_n_most_used(
            this._dialog.most_used.sources.select(this._current_source_lang),
            this._dialog.most_used.targets.select(this._current_target_lang)
        );
    }

    _most_used_bar_select_current() {
        if (!Utils.SETTINGS.get_boolean(PrefsKeys.SHOW_MOST_USED_KEY)) return;

        this._dialog.most_used.sources.select(this._current_source_lang);
        this._dialog.most_used.targets.select(this._current_target_lang);
    }

    _init_languages_chooser() {
        this._source_language_chooser = new LanguageChooser.LanguageChooser(
            "Choose source language:"
        );
        this._source_language_chooser.connect(
            "language-chose",
            (object, code, name) => {
                this._on_source_language_chose(object, { code, name });
            }
        );

        this._target_language_chooser = new LanguageChooser.LanguageChooser(
            "Choose target language:"
        );
        this._target_language_chooser.connect(
            "language-chose",
            (object, code, name) => {
                this._on_target_language_chose(object, { code, name });
            }
        );
    }

    _remove_timeouts(timeout_key) {
        if (!Utils.is_blank(timeout_key)) {
            if (TIMEOUT_IDS[timeout_key] > 0) {
                Mainloop.source_remove(TIMEOUT_IDS[timeout_key]);
            }
        } else {
            for (let key in TIMEOUT_IDS) {
                if (TIMEOUT_IDS[key] > 0) {
                    Mainloop.source_remove(TIMEOUT_IDS[key]);
                }
            }
        }
    }

    _on_key_press_event(object, event) {
        let state = event.get_state();
        let symbol = event.get_key_symbol();
        let code = event.get_key_code();

        let cyrillic_control = 8196;
        let cyrillic_shift = 8192;

        if (symbol == Clutter.KEY_Escape) {
            this.close();
        }
        // ctrl+shift+c - copy translated text to clipboard
        else if (
            (state ==
                Clutter.ModifierType.SHIFT_MASK +
                    Clutter.ModifierType.CONTROL_MASK ||
                state == Clutter.ModifierType.SHIFT_MASK + cyrillic_control) &&
            code == 54
        ) {
            let text = this._dialog.target.text;

            if (Utils.is_blank(text)) {
                this._dialog.statusbar.add_message(
                    "There is nothing to copy.",
                    1500,
                    StatusBar.MESSAGE_TYPES.error,
                    false
                );
            } else {
                let clipboard = St.Clipboard.get_default();
                clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
                this._dialog.statusbar.add_message(
                    "Translated text copied to clipboard.",
                    1500,
                    StatusBar.MESSAGE_TYPES.info,
                    false
                );
            }
        }
        // ctr+s - swap languages
        else if (
            (state == Clutter.ModifierType.CONTROL_MASK ||
                state == cyrillic_control) &&
            code == 39
        ) {
            this._swap_languages();
        }
        // ctrl+d - reset languages to default
        else if (
            (state == Clutter.ModifierType.CONTROL_MASK ||
                state == cyrillic_control) &&
            code == 40
        ) {
            this._reset_languages();
        }
        // Super - close
        else if (
            symbol == Clutter.KEY_Super_L ||
            symbol == Clutter.KEY_Super_R
        ) {
            this.close();
        } else {
            // let t = {
            //     state: state,
            //     symbol: symbol,
            //     code: code
            // };
            // log(JSON.stringify(t, null, '\t'));
        }
    }

    _set_current_translator(name) {
        this._translators_button.label = "<i>%s</i>".format(name);

        this._translators_manager.current = this._translators_manager.get_by_name(name); // Modificato qui
        this._dialog.source.max_length = this._translators_manager.current.limit;
        this._set_current_languages();
        this._show_most_used();

        this._dialog.source.grab_key_focus();
    }

    _set_current_source(lang_code) {
        this._current_source_lang = lang_code;
        this._translators_manager.current.prefs.last_source = lang_code;
    }

    _set_current_target(lang_code) {
        this._current_target_lang = lang_code;
        this._translators_manager.current.prefs.last_target = lang_code;
    }

    _set_current_languages() {
        let current_translator = this._translators_manager.current;
        let current_source = current_translator.prefs.default_source;
        let current_target = current_translator.prefs.default_target;

        if (current_translator.prefs.remember_last_lang) {
            current_source =
                current_translator.prefs.last_source !== false
                    ? current_translator.prefs.last_source
                    : current_translator.prefs.default_source;
            current_target = current_translator.prefs.last_target
                ? current_translator.prefs.last_target
                : current_translator.prefs.default_target;
        }

        this._set_current_source(current_source);
        this._set_current_target(current_target);
        this._current_langs_changed();
    }

    _swap_languages() {
        let current = this._translators_manager.current;
        let source = this._current_source_lang;
        let target = this._current_target_lang;
        this._set_current_source(target);
        this._set_current_target(source);
        this._current_langs_changed();
        this._most_used_bar_select_current();
        this._translate();
    }

    _reset_languages() {
        let current = this._translators_manager.current;
        this._set_current_source(current.prefs.default_source);
        this._set_current_target(current.prefs.default_target);
        this._current_langs_changed();
        this._most_used_bar_select_current();
    }

    _update_stats() {
        let source_data = {
            code: this._current_source_lang,
            name: this._translators_manager.current.get_language_name(
                this._current_source_lang
            )
        };
        this._languages_stats.increment(
            this._translators_manager.current.name,
            LanguagesStats.TYPE_SOURCE,
            source_data
        );
        let target_data = {
            code: this._current_target_lang,
            name: this._translators_manager.current.get_language_name(
                this._current_target_lang
            )
        };
        this._languages_stats.increment(
            this._translators_manager.current.name,
            LanguagesStats.TYPE_TARGET,
            target_data
        );
    }

    _show_help() {
        let help_dialog = new Me.imports.help_dialog.HelpDialog();
        help_dialog.open();
    }

    _on_source_language_chose(object, language) {
        this._most_used_bar_select_current();
        this._set_current_source(language.code);
        this._current_langs_changed();
        this._source_language_chooser.close();
        this._translate();
    }

    _on_target_language_chose(object, language) {
        this._most_used_bar_select_current();
        this._set_current_target(language.code);
        this._current_langs_changed();
        this._target_language_chooser.close();
        this._translate();
    }

    _current_langs_changed() {
        this._source_lang_button.label = "from <i>%s</i>".format(
            this._translators_manager.current.get_language_name(
                this._current_source_lang
            )
        );
        this._target_lang_button.label = "to <i>%s</i>".format(
            this._translators_manager.current.get_language_name(
                this._current_target_lang
            )
        );
    }

    _get_close_button() {
        let button_params = {
            button_style_class: "translator-dialog-menu-button",
            statusbar: this._dialog.statusbar
        };
        let button = new ButtonsBar.ButtonsBarButton(
            Utils.ICONS.close,  // Usa un'icona di chiusura definita in utils.js
            "",
            "Chiudi",
            button_params,
            () => this.close()
        );
        return button;
    }
	
    _get_source_lang_button() {
        let button_params = {
            button_style_class: "tranlator-top-bar-button-reactive",
            statusbar: this._dialog.statusbar
        };
        let button = new ButtonsBar.ButtonsBarButton(
            false,
            "<u>From: %s</u>".format(
                this._translators_manager.current.get_language_name(
                    this._current_source_lang
                )
            ),
            "Choose source language",
            button_params,
            () => {
                this._source_language_chooser.open();
                this._source_language_chooser.set_languages(
                    this._translators_manager.current.get_languages()
                );
                this._source_language_chooser.show_languages(
                    this._current_source_lang
                );
            }
        );

        return button;
    }

    _get_target_lang_button() {
        let button_params = {
            button_style_class: "tranlator-top-bar-button-reactive",
            statusbar: this._dialog.statusbar
        };
        let button = new ButtonsBar.ButtonsBarButton(
            false,
            "<u>To: %s</u>".format(
                this._translators_manager.current.get_language_name(
                    this._current_target_lang
                )
            ),
            "Choose target language",
            button_params,
            () => {
                this._target_language_chooser.open();
                this._target_language_chooser.set_languages(
                    this._translators_manager.current.get_pairs(
                        this._current_source_lang
                    )
                );
                this._target_language_chooser.show_languages(
                    this._current_target_lang
                );
            }
        );

        return button;
    }

    _get_swap_langs_button() {
        let button_params = {
            button_style_class: "tranlator-top-bar-button-reactive",
            statusbar: this._dialog.statusbar
        };
        let button = new ButtonsBar.ButtonsBarButton(
            false,
            " \u21C4 ",
            "Swap languages",
            button_params,
            () => this._swap_languages()
        );

        return button;
    }

    _get_translators_button() {
        let button;

        if (this._translators_manager.num_translators < 2) {
            button = new ButtonsBar.ButtonsBarLabel(
                this._translators_manager.current.name,
                "tranlator-top-bar-button"
            );
        } else {
            let button_params = {
                button_style_class: "tranlator-top-bar-button-reactive",
                statusbar: this._dialog.statusbar
            };
            button = new ButtonsBar.ButtonsBarButton(
                false,
                "<u>%s</u>".format(this._translators_manager.current.name),
                "Choose translation provider",
                button_params,
                () => {
                    let translators_popup = new TranslatorsPopup(
                        button,
                        this._dialog
                    );
                    let names = this._translators_manager.translators_names;

                    for (let i = 0; i < names.length; i++) {
                        let name = names[i];
                        if (name === this._translators_manager.current.name) {
                            continue;
                        }

                        translators_popup.add_item(name, () => {
                            this._set_current_translator(name);
                        });
                    }

                    translators_popup.open();
                }
            );
        }

        return button;
    }

    _get_translate_button() {
        let button_params = {
            button_style_class: "tranlator-top-bar-go-button",
            statusbar: this._dialog.statusbar
        };
        let button = new ButtonsBar.ButtonsBarButton(
            false,
            "Go!",
            "Translate text(<Ctrl><Enter>)",
            button_params,
            () => this._translate()
        );

        return button;
    }

    _get_help_button() {
        let button_params = {
            button_style_class: "translator-dialog-menu-button",
            statusbar: this._dialog.statusbar
        };

        let button = new ButtonsBar.ButtonsBarButton(
            Utils.ICONS.help,
            "",
            "Help",
            button_params,
            () => this._show_help()
        );

        return button;
    }

	_get_prefs_button() {
		let button_params = {
			button_style_class: "translator-dialog-menu-button",
			statusbar: this._dialog.statusbar
		};
		let button = new ButtonsBar.ButtonsBarButton(
			Utils.ICONS.preferences,
			"",
			"Preferences",
			button_params,
			() => {
				this.close();
				ExtensionUtils.openPrefs();  
			}
		);

		return button;
	}

    _get_instant_translation_button() {
        let button_params = {
            button_style_class: "translator-dialog-menu-toggle-button",
            toggle_mode: true,
            statusbar: this._dialog.statusbar
        };

        let button = new ButtonsBar.ButtonsBarButton(
            Utils.ICONS.instant_translation,
            "",
            "Enable/Disable instant translation",
            button_params,
            () => {
                let checked = button.get_checked();
                button.set_checked(checked);

                Utils.SETTINGS.set_boolean(
                    PrefsKeys.INSTANT_TRANSLATION_KEY,
                    checked
                );
            }
        );
        let checked = Utils.SETTINGS.get_boolean(
            PrefsKeys.INSTANT_TRANSLATION_KEY
        );
        button.set_checked(checked);

        return button;
    }

    _add_topbar_buttons() {
        this._source_lang_button = this._get_source_lang_button();
        this._dialog.topbar.add_button(this._source_lang_button);

        this._swap_languages_button = this._get_swap_langs_button();
        this._dialog.topbar.add_button(this._swap_languages_button);

        this._target_lang_button = this._get_target_lang_button();
        this._dialog.topbar.add_button(this._target_lang_button);

        let by_label = new ButtonsBar.ButtonsBarLabel(
            " with ",
            "tranlator-top-bar-button"
        );
        this._dialog.topbar.add_button(by_label);

        this._translators_button = this._get_translators_button();
        this._dialog.topbar.add_button(this._translators_button);

        // let translate_label = new ButtonsBar.ButtonsBarLabel(
        //     ' ',
        //     'tranlator-top-bar-button'
        // );
        // this._dialog.topbar.add_button(translate_label);

        this._translate_button = this._get_translate_button();
        this._dialog.topbar.add_button(this._translate_button);

        // Add the 'Locale' button near the close button
        this._translator_toggle_button = this._get_translator_toggle_button();
        this._dialog.topbar.add_button(this._translator_toggle_button);

    }

    _get_translator_toggle_button() {
        let button_params = {
            button_style_class: "tranlator-top-bar-button-reactive",
            statusbar: this._dialog.statusbar
        };
        let button = new ButtonsBar.ButtonsBarButton(
            false,
            this._translators_manager.current.name === "Locally" ? "Online" : "Locale",
            "Passa tra traduttore locale e online",
            button_params,
            () => {
                if (this._translators_manager.current.name === "Locally") {
                    this._set_current_translator(this._translators_manager.default.name);
                    button.label = "Locale";
                } else {
                    this._set_current_translator("Locally");
                    button.label = "Online";
                }
            }
        );
        return button;
    }
	
    _add_dialog_menu_buttons() {

        let close_button = this._get_close_button();
        this._dialog.dialog_menu.add_button(close_button);
		
        let instant_translation_button = this._get_instant_translation_button();
        this._dialog.dialog_menu.add_button(instant_translation_button);

        let help_button = this._get_help_button();
        this._dialog.dialog_menu.add_button(help_button);

        let prefs_button = this._get_prefs_button();
        this._dialog.dialog_menu.add_button(prefs_button);
    }

    _translate() {
        if (Utils.is_blank(this._dialog.source.text)) return;

        this._update_stats();
        this._dialog.target.text = "";
        let message_id = this._dialog.statusbar.add_message(
            "Translating...",
            0,
            StatusBar.MESSAGE_TYPES.info,
            true
        );

        if(this._translators_manager.current) {
            this._translators_manager.current.translate(
                this._current_source_lang,
                this._current_target_lang,
                this._dialog.source.text,
                result => {
                    this._dialog.statusbar.remove_message(message_id);

                    if (result.error) {
                        this._dialog.statusbar.add_message(
                            result.message,
                            4000,
                            StatusBar.MESSAGE_TYPES.error
                        );
                    } else {
                        this._dialog.target.markup = result;

                        if (
                            Utils.SETTINGS.get_boolean(
                                PrefsKeys.ENABLE_AUTO_SPEAK_KEY
                            )
                        ) {
                            this._dialog.google_tts.speak(
                                this._dialog.target.text,
                                this._current_target_lang
                            );
                        }
                    }
                }
            );
        } else {
            this._dialog.statusbar.add_message(
                "Translator not initialized.",
                4000,
                StatusBar.MESSAGE_TYPES.error
            );
        }
    }

    _translate_from_clipboard(clipboard_type) {
        this.open();

        let clipboard = St.Clipboard.get_default();
        clipboard.get_text(clipboard_type, (clipboard, text) => {
            if (Utils.is_blank(text)) {
                this._dialog.statusbar.add_message(
                    "Clipboard is empty.",
                    2000,
                    StatusBar.MESSAGE_TYPES.error,
                    false
                );
                return;
            }

            TRIGGERS.translate = false;
            this._dialog.source.text = text;
            this._translate();
        });
    }

    _add_keybindings() {
        Main.wm.addKeybinding(
            PrefsKeys.OPEN_TRANSLATOR_KEY,
            Utils.SETTINGS,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL |
                Shell.ActionMode.MESSAGE_TRAY |
                Shell.ActionMode.OVERVIEW,
            () => {
                this.open();
            }
        );

        Main.wm.addKeybinding(
            PrefsKeys.TRANSLATE_FROM_CLIPBOARD_KEY,
            Utils.SETTINGS,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL |
                Shell.ActionMode.MESSAGE_TRAY |
                Shell.ActionMode.OVERVIEW,
            () => {
                this._translate_from_clipboard(St.ClipboardType.CLIPBOARD);
            }
        );

        Main.wm.addKeybinding(
            PrefsKeys.TRANSLATE_FROM_SELECTION_KEY,
            Utils.SETTINGS,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL |
                Shell.ActionMode.MESSAGE_TRAY |
                Shell.ActionMode.OVERVIEW,
            () => {
                this._translate_from_clipboard(St.ClipboardType.PRIMARY);
            }
        );
    }

    _remove_keybindings() {
        Main.wm.removeKeybinding(PrefsKeys.OPEN_TRANSLATOR_KEY);
        Main.wm.removeKeybinding(PrefsKeys.TRANSLATE_FROM_CLIPBOARD_KEY);
        Main.wm.removeKeybinding(PrefsKeys.TRANSLATE_FROM_SELECTION_KEY);
    }

    _add_panel_button() {
        if (!this._panel_button) {
            this._panel_button = new TextTranslatorIndicator(this);
            Main.panel.addToStatusArea("text-translator", this._panel_button);
        }
    }

    _remove_panel_button() {
        if (this._panel_button != false) {
            this._panel_button.destroy();
            this._panel_button = false;
        }
    }

    open() {
        if (
            Utils.SETTINGS.get_boolean(PrefsKeys.REMEMBER_LAST_TRANSLATOR_KEY)
        ) {
            let translator = this._translators_manager.last_used
                ? this._translators_manager.last_used.name
                : this._translators_manager.default.name;
            this._set_current_translator(translator);
        } else {
            this._set_current_translator(
                this._translators_manager.default.name
            );
        }

        this._dialog.open();
        this._dialog.source.clutter_text.set_selection(
            0,
            this._dialog.source.length
        );
        this._dialog.source.clutter_text.grab_key_focus();
        this._dialog.source.max_length = this._translators_manager.current.limit;
        this._set_current_languages();
        this._show_most_used();

        if (this._panel_button) {
            this._panel_button.set_focus(true);
        }
    }

    close() {
        if (this._panel_button) {
            this._panel_button.set_focus(false);
        }

        this._dialog.close();
    }

    enable() {
        if (Utils.SETTINGS.get_boolean(PrefsKeys.SHOW_ICON_KEY)) {
            if (!this._panel_button) {
                this._add_panel_button();
            }
        }

        if (Utils.SETTINGS.get_boolean(PrefsKeys.ENABLE_SHORTCUTS_KEY)) {
            this._add_keybindings();
        }

        CONNECTION_IDS.show_icon = Utils.SETTINGS.connect(
            "changed::" + PrefsKeys.SHOW_ICON_KEY,
            () => {
                let show = Utils.SETTINGS.get_boolean(PrefsKeys.SHOW_ICON_KEY);

                if (show && !this._panel_button) this._add_panel_button();
                if (!show) this._remove_panel_button();
            }
        );
        CONNECTION_IDS.enable_shortcuts = Utils.SETTINGS.connect(
            "changed::" + PrefsKeys.ENABLE_SHORTCUTS_KEY,
            () => {
                let enable = Utils.SETTINGS.get_boolean(
                    PrefsKeys.ENABLE_SHORTCUTS_KEY
                );

                if (enable) this._add_keybindings();
                else this._remove_keybindings();
            }
        );
    }

    disable() {
        this.close();
        this._dialog.destroy();
        this._translators_manager.destroy();
        this._source_language_chooser.destroy();
        this._target_language_chooser.destroy();
        this._remove_keybindings();

        if (CONNECTION_IDS.show_icon > 0) {
            Utils.SETTINGS.disconnect(CONNECTION_IDS.show_icon);
        }

        if (CONNECTION_IDS.enable_shortcuts > 0) {
            Utils.SETTINGS.disconnect(CONNECTION_IDS.enable_shortcuts);
        }

        if (this._panel_button !== false) {
            this._remove_panel_button();
        }
    }

    get current_target_lang() {
        return this._current_target_lang;
    }

    get current_source_lang() {
        return this._current_source_lang;
    }
};

let translator = null;

function init() {
    Me.imports.gettext.initTranslations();
}

function enable() {
    textTranslator = new TextTranslatorIndicator();
    Main.panel.addToStatusArea('text-translator', textTranslator);

    translator = new TranslatorExtension();
    translator.enable();
}

function disable() {
    if (textTranslator) {
        textTranslator.destroy();
        textTranslator = null;
    }

    if (translator !== null) {
        translator.disable();
        translator = null;
    }
}

