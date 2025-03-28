#!/bin/bash

# Crea le directory necessarie
mkdir -p locale/it/LC_MESSAGES/

# Compila il file .po in .mo
msgfmt po/it.po -o locale/it/LC_MESSAGES/text-translator.mo

# Aggiorna i permessi
chmod +x locale/it/LC_MESSAGES/text-translator.mo
