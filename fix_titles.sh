#!/bin/bash

# French
sed -i 's/"Sokuji for Gather Town"/"Sokuji pour Gather Town"/g' extension/_locales/fr/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji pour Whereby"/g' extension/_locales/fr/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji pour Discord"/g' extension/_locales/fr/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji pour Slack"/g' extension/_locales/fr/messages.json

# German
sed -i 's/"Sokuji for Gather Town"/"Sokuji für Gather Town"/g' extension/_locales/de/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji für Whereby"/g' extension/_locales/de/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji für Discord"/g' extension/_locales/de/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji für Slack"/g' extension/_locales/de/messages.json

# Spanish
sed -i 's/"Sokuji for Gather Town"/"Sokuji para Gather Town"/g' extension/_locales/es/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji para Whereby"/g' extension/_locales/es/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji para Discord"/g' extension/_locales/es/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji para Slack"/g' extension/_locales/es/messages.json

# Spanish (Latin America)
sed -i 's/"Sokuji for Gather Town"/"Sokuji para Gather Town"/g' extension/_locales/es_419/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji para Whereby"/g' extension/_locales/es_419/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji para Discord"/g' extension/_locales/es_419/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji para Slack"/g' extension/_locales/es_419/messages.json

# Portuguese (Brazil)
sed -i 's/"Sokuji for Gather Town"/"Sokuji para Gather Town"/g' extension/_locales/pt_BR/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji para Whereby"/g' extension/_locales/pt_BR/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji para Discord"/g' extension/_locales/pt_BR/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji para Slack"/g' extension/_locales/pt_BR/messages.json

# Portuguese (Portugal)
sed -i 's/"Sokuji for Gather Town"/"Sokuji para Gather Town"/g' extension/_locales/pt_PT/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji para Whereby"/g' extension/_locales/pt_PT/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji para Discord"/g' extension/_locales/pt_PT/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji para Slack"/g' extension/_locales/pt_PT/messages.json

# Dutch
sed -i 's/"Sokuji for Gather Town"/"Sokuji voor Gather Town"/g' extension/_locales/nl/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji voor Whereby"/g' extension/_locales/nl/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji voor Discord"/g' extension/_locales/nl/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji voor Slack"/g' extension/_locales/nl/messages.json

# Russian
sed -i 's/"Sokuji for Gather Town"/"Sokuji для Gather Town"/g' extension/_locales/ru/messages.json
sed -i 's/"Sokuji for Whereby"/"Sokuji для Whereby"/g' extension/_locales/ru/messages.json
sed -i 's/"Sokuji for Discord"/"Sokuji для Discord"/g' extension/_locales/ru/messages.json
sed -i 's/"Sokuji for Slack"/"Sokuji для Slack"/g' extension/_locales/ru/messages.json

echo "Fixed titles for all major languages"
