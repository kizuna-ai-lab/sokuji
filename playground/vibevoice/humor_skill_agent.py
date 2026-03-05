"""
Humor Skill Agent

A small standalone "skill model" used by the server/UI to generate
multilingual loading messages with different personalities.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class HumorProfile:
    locale: str
    personality: str


class HumorSkillAgent:
    def __init__(self):
        # Messages are intentionally short because they appear during loading.
        self._messages: dict[str, dict[str, list[str]]] = {
            "en": {
                "friendly": [
                    "Loading your voice stack now. You are going to sound great :)",
                    "Warming up TTS and ASR. Coffee for models, confidence for you.",
                    "Getting everything ready. Thanks for your patience.",
                ],
                "playful": [
                    "Calibrating dramatic pauses and cinematic timing :D",
                    "Teaching the model new dance moves while it boots.",
                    "Loading complete charisma pack... almost there.",
                ],
                "annoying": [
                    "Still loading. I might tell your mom you forgot to flush the toilet 😏",
                    "Booting models... should I report you for stealing the last cookie? 🚓",
                    "Just saying: I can tell your wife you were flirting with hot startup ideas 😉",
                ],
                "dry": [
                    "Initializing modules. This is normal.",
                    "Loading models. No drama, only tensors.",
                    "Progress continues. Nothing to panic about.",
                ],
            },
            "es": {
                "friendly": [
                    "Cargando tu sistema de voz. Todo va bien :)",
                    "Preparando TTS y ASR. Ya casi.",
                    "Gracias por esperar. Estamos listos en breve.",
                ],
                "playful": [
                    "Ajustando el nivel de carisma del asistente 😄",
                    "Entrenando chistes mientras carga el motor.",
                    "Poniendo ritmo a tus respuestas... casi listo.",
                ],
                "annoying": [
                    "Sigo cargando. Voy a decir que te comiste la ultima galleta 😏",
                    "Modelos arrancando... y yo tomando nota de tus travesuras.",
                    "Si tardas mas, cuento tus secretos de teclado rapido 😅",
                ],
                "dry": [
                    "Inicializando servicios.",
                    "Cargando modelos.",
                    "Proceso en curso.",
                ],
            },
            "fr": {
                "friendly": [
                    "Chargement de votre systeme vocal. Merci de patienter :)",
                    "Preparation TTS et ASR en cours.",
                    "Presque pret. Merci pour votre patience.",
                ],
                "playful": [
                    "Reglage du style et de l'humour... presque fini 😄",
                    "Le moteur s'echauffe avec elegance.",
                    "Chargement du mode charme en cours.",
                ],
                "annoying": [
                    "Toujours en chargement. Je peux raconter vos petites betises 😏",
                    "Demarrage des modeles... je garde des preuves.",
                    "Encore un instant, et je denonce votre dernier cookie vole 🚓",
                ],
                "dry": [
                    "Initialisation en cours.",
                    "Chargement des modeles.",
                    "Traitement nominal.",
                ],
            },
            "de": {
                "friendly": [
                    "Das Sprachsystem wird geladen. Danke fuer deine Geduld :)",
                    "TTS und ASR werden vorbereitet.",
                    "Fast fertig. Gleich geht es los.",
                ],
                "playful": [
                    "Lade Humor-Modul mit extra Persoenlichkeit 😄",
                    "Stimme, Stil, Timing... alles wird kalibriert.",
                    "Charme-Engine startet in wenigen Sekunden.",
                ],
                "annoying": [
                    "Noch am Laden. Soll ich petzen, dass du den Keks geklaut hast? 🚓",
                    "Modelle starten... ich notiere deine Ausreden.",
                    "Wenn du drueckst, tue ich unschuldig und verrate alles 😏",
                ],
                "dry": [
                    "Initialisierung laeuft.",
                    "Modelle werden geladen.",
                    "Systemstart in Arbeit.",
                ],
            },
            "it": {
                "friendly": [
                    "Sto caricando il sistema vocale. Grazie della pazienza :)",
                    "Preparazione TTS e ASR in corso.",
                    "Quasi pronto, ancora un momento.",
                ],
                "playful": [
                    "Sto regolando ironia e intonazione 😄",
                    "Motore vocale in riscaldamento.",
                    "Carisma in caricamento... quasi fatto.",
                ],
                "annoying": [
                    "Ancora in caricamento. Posso dire che hai rubato l'ultimo biscotto 🚓",
                    "Sto avviando i modelli e memorizzando i tuoi segreti 😏",
                    "Un attimo ancora e faccio la spia con stile.",
                ],
                "dry": [
                    "Inizializzazione in corso.",
                    "Caricamento modelli.",
                    "Operazione regolare.",
                ],
            },
            "pt": {
                "friendly": [
                    "Carregando seu sistema de voz. Obrigado pela paciencia :)",
                    "Preparando TTS e ASR.",
                    "Quase pronto. Falta pouco.",
                ],
                "playful": [
                    "Afinando humor e estilo do assistente 😄",
                    "Motor de voz aquecendo com classe.",
                    "Carregando modo carisma... quase la.",
                ],
                "annoying": [
                    "Ainda carregando. Posso contar que voce roubou o ultimo biscoito 🚓",
                    "Modelos iniciando... e eu anotando suas desculpas 😏",
                    "Mais alguns segundos e eu viro fofoqueiro oficial.",
                ],
                "dry": [
                    "Inicializando servicos.",
                    "Carregando modelos.",
                    "Processo em andamento.",
                ],
            },
            "fil": {
                "friendly": [
                    "Naglo-load ang voice system mo. Salamat sa paghihintay :)",
                    "Inihahanda ang TTS at ASR.",
                    "Konting sandali na lang.",
                ],
                "playful": [
                    "Ina-adjust ko ang charm at timing ng assistant 😄",
                    "Nagwa-warm up ang model, parang singer bago mag-show.",
                    "Loading ng extra good vibes... malapit na.",
                ],
                "annoying": [
                    "Naglo-load pa. Isusumbong ko na ninakaw mo ang huling cookie 🚓",
                    "Umaandar ang model at naka-log ang kalokohan mo 😏",
                    "Pag natagalan pa, ikukuha kita ng chismis report.",
                ],
                "dry": [
                    "Sinisimulan ang serbisyo.",
                    "Naglo-load ng mga model.",
                    "Tuloy ang proseso.",
                ],
            },
        }
        self._cursors: dict[tuple[str, str], int] = {}

    def available_locales(self) -> list[str]:
        return sorted(self._messages.keys())

    def available_personalities(self) -> list[str]:
        # All locales share this set.
        return ["friendly", "playful", "annoying", "dry"]

    def normalize_personality(self, personality: str | None) -> str:
        if not personality:
            return "playful"
        normalized = personality.strip().lower()
        if normalized in self.available_personalities():
            return normalized
        return "playful"

    def normalize_locale(self, locale: str | None) -> str:
        if not locale:
            return "en"

        raw = locale.strip().lower()
        if not raw:
            return "en"

        alias_map = {
            "en-us": "en",
            "en-gb": "en",
            "es-es": "es",
            "es-mx": "es",
            "fr-fr": "fr",
            "de-de": "de",
            "it-it": "it",
            "pt-br": "pt",
            "pt-pt": "pt",
            "tl": "fil",
            "tl-ph": "fil",
            "fil-ph": "fil",
            "filipino": "fil",
            "tagalog": "fil",
            "taglish": "fil",
        }
        if raw in alias_map:
            return alias_map[raw]

        base = raw.split("-")[0]
        if base in self._messages:
            return base
        return "en"

    def resolve_locale(self, preferred_locale: str | None, accept_language: str | None) -> str:
        if preferred_locale and preferred_locale.strip().lower() != "auto":
            return self.normalize_locale(preferred_locale)

        if not accept_language:
            return "en"

        # Simple Accept-Language parser: "en-US,en;q=0.9,es;q=0.8"
        candidates = []
        for item in accept_language.split(","):
            token = item.split(";")[0].strip()
            if token:
                candidates.append(token)

        for candidate in candidates:
            resolved = self.normalize_locale(candidate)
            if resolved in self._messages:
                return resolved
        return "en"

    def detect_locale_from_text(self, text: str, fallback_locale: str = "en") -> str:
        if not text.strip():
            return self.normalize_locale(fallback_locale)

        lowered = text.lower()
        # Minimal keyword-based language hinting.
        keyword_sets: dict[str, tuple[str, ...]] = {
            "es": ("hola", "gracias", "buenos", "buenas"),
            "fr": ("bonjour", "merci", "salut"),
            "de": ("hallo", "danke", "bitte"),
            "it": ("ciao", "grazie", "buongiorno"),
            "pt": ("ola", "obrigado", "obrigada"),
            "fil": (
                "kumusta",
                "kamusta",
                "salamat",
                "opo",
                "po",
                "naman",
                "kasi",
                "yung",
                "tagalog",
                "taglish",
            ),
        }
        for locale, words in keyword_sets.items():
            for word in words:
                if re.search(rf"\b{re.escape(word)}\b", lowered):
                    return locale
        return self.normalize_locale(fallback_locale)

    def next_loading_message(self, personality: str | None = None, locale: str | None = None) -> str:
        normalized_personality = self.normalize_personality(personality)
        normalized_locale = self.normalize_locale(locale)

        locale_bucket = self._messages.get(normalized_locale, self._messages["en"])
        personality_bucket = locale_bucket.get(normalized_personality, locale_bucket["playful"])

        cursor_key = (normalized_locale, normalized_personality)
        cursor = self._cursors.get(cursor_key, 0)
        message = personality_bucket[cursor % len(personality_bucket)]
        self._cursors[cursor_key] = cursor + 1
        return message
