#!/bin/bash

# Directory delle traduzioni
LOCALE_DIR="locale"
PO_DIR="locale/po"
DOMAIN="text-translator"

# Assicurati che le directory necessarie esistano
mkdir -p "${LOCALE_DIR}/it/LC_MESSAGES"

# Aggiorna il file POT
xgettext --from-code=UTF-8 \
         --output="${PO_DIR}/${DOMAIN}.pot" \
         --package-name="Text Translator GNOME Extension" \
         --copyright-holder="MoonDragon-MD" \
         --msgid-bugs-address="moondragon.md@example.com" \
         --add-comments=TRANSLATORS: \
         --keyword=_ \
         --keyword=N_ \
         --keyword=C_:1c,2 \
         --keyword=NC_:1c,2 \
         --keyword=gettext \
         --keyword=ngettext:1,2 \
         --keyword=pgettext:1c,2 \
         --keyword=npgettext:1c,2,3 \
         extension.js \
         prefs.js \
         translation_providers/*.js \
         *.js

# Aggiorna il file PO italiano
if [ -f "${PO_DIR}/it.po" ]; then
    msgmerge --update --backup=none "${PO_DIR}/it.po" "${PO_DIR}/${DOMAIN}.pot"
else
    msginit --input="${PO_DIR}/${DOMAIN}.pot" \
            --output-file="${PO_DIR}/it.po" \
            --locale=it \
            --no-translator
fi

# Compila il file PO in MO
msgfmt "${PO_DIR}/it.po" -o "${LOCALE_DIR}/it/LC_MESSAGES/${DOMAIN}.mo"

echo "Traduzioni aggiornate e compilate con successo!"

# Mostra statistiche della traduzione
echo "Statistiche della traduzione italiana:"
msgfmt --statistics "${PO_DIR}/it.po"
