#!/usr/bin/env python3
"""Generate benchmark-config.json from local wasm directories."""
import os, json, re

BASE = os.path.dirname(os.path.abspath(__file__))

TEXTS = {
    'en': 'The quick brown fox jumps over the lazy dog near the river bank. She sells sea shells by the sea shore every morning.',
    'de': 'Der schnelle braune Fuchs springt über den faulen Hund am Flussufer. Dies ist ein Test der Sprachsynthese für heute.',
    'fr': 'Le renard brun rapide saute par dessus le chien paresseux près de la rivière. Ceci est un test de synthèse vocale.',
    'zh': '快速的棕色狐狸跳过了河边懒惰的狗。这是一个语音合成系统的测试，今天天气非常好，我们一起出去走走吧。',
    'ja': 'すばやい茶色のキツネが怠けたイヌを飛び越えます。これは音声合成システムのテストです。今日はいい天気ですね。',
    'es': 'El rápido zorro marrón salta sobre el perro perezoso cerca del río. Esta es una prueba de síntesis de voz.',
    'ru': 'Быстрая коричневая лиса прыгает через ленивую собаку у реки. Это тест системы синтеза речи сегодня.',
    'ar': 'الثعلب البني السريع يقفز فوق الكلب الكسول بالقرب من النهر. هذا اختبار لنظام تحويل النص إلى كلام.',
    'ko': '빠른 갈색 여우가 게으른 개를 뛰어넘습니다. 이것은 음성 합성 시스템의 테스트입니다. 오늘 날씨가 좋습니다.',
    'pt': 'A rápida raposa marrom pula sobre o cachorro preguiçoso perto do rio. Este é um teste de síntese de voz.',
    'it': 'La veloce volpe marrone salta sopra il cane pigro vicino al fiume. Questo è un test di sintesi vocale.',
    'nl': 'De snelle bruine vos springt over de luie hond bij de rivier. Dit is een test van het spraaksynthesesysteem.',
    'pl': 'Szybki brązowy lis przeskakuje nad leniwym psem nad rzeką. To jest test systemu syntezy mowy dzisiaj.',
    'hi': 'तेज़ भूरी लोमड़ी आलसी कुत्ते के ऊपर से कूदती है। यह वाक् संश्लेषण प्रणाली का परीक्षण है।',
    'tr': 'Hızlı kahverengi tilki tembel köpeğin üzerinden atlar nehrin yanında. Bu bir konuşma sentezi sistemi testidir.',
    'fi': 'Nopea ruskea kettu hyppää laiskan koiran yli joen rannalla. Tämä on puhesynteesin testi tänään.',
    'sv': 'Den snabba bruna räven hoppar över den lata hunden vid floden. Detta är ett test av talsyntesen idag.',
    'uk': 'Швидка коричнева лисиця стрибає через лінивого собаку біля річки. Це тест системи синтезу мовлення.',
    'cs': 'Rychlá hnědá liška skočí přes líného psa u řeky. Toto je test systému syntézy řeči dnes.',
    'hu': 'A gyors barna róka átugrik a lusta kutya felett a folyónál. Ez egy beszédszintézis teszt ma.',
    'fa': 'روباه قهوه‌ای سریع از روی سگ تنبل در کنار رودخانه می‌پرد. این یک آزمایش سیستم تبدیل متن به گفتار است.',
    'vi': 'Con cáo nâu nhanh nhẹn nhảy qua con chó lười gần bờ sông. Đây là bài kiểm tra hệ thống tổng hợp giọng nói.',
    'ca': 'La ràpida guineu marró salta per sobre el gos mandrós a la vora del riu. Aquesta és una prova de síntesi de veu.',
    'is': 'Fljóti brúni refurinn hoppar yfir lata hundinn við ána. Þetta er próf á talgervli dagsins.',
    'ne': 'छिटो खैरो फ्याउरो अल्छी कुकुरमाथि उफ्रिन्छ नदी नजिकै। यो वाणी संश्लेषण प्रणालीको परीक्षण हो।',
    'ro': 'Vulpea brună rapidă sare peste câinele leneș lângă râu. Acesta este un test al sistemului de sinteză vocală.',
    'cy': "Mae'r llwynog brown cyflym yn neidio dros y ci diog ger yr afon. Prawf system synthesis lleferydd yw hwn.",
    'da': 'Den hurtige brune ræv springer over den dovne hund ved floden. Dette er en test af talesyntese i dag.',
    'el': 'Η γρήγορη καφέ αλεπού πηδάει πάνω από τον τεμπέλη σκύλο κοντά στο ποτάμι. Αυτή είναι δοκιμή σύνθεσης ομιλίας.',
    'kk': 'Жылдам қоңыр түлкі жалқау иттің үстінен секіреді өзен жанында. Бұл сөйлеу синтезі жүйесінің сынағы.',
    'ml': 'വേഗമുള്ള തവിട്ട് കുറുക്കൻ മടിയൻ നായയുടെ മുകളിൽ ചാടുന്നു. ഇത് ശബ്ദ സംയോജന പരീക്ഷണമാണ്.',
    'sl': 'Hitra rjava lisica skoči čez lenega psa ob reki. To je test sistema za sintezo govora danes.',
    'no': 'Den raske brune reven hopper over den late hunden ved elva. Dette er en test av talesyntese i dag.',
    'bg': 'Бързата кафява лисица скача над мързеливото куче край реката. Това е тест на система за синтез на реч.',
    'et': 'Kiire pruun rebane hüppab üle laisa koera jõe ääres. See on kõnesünteesi süsteemi test täna.',
    'ga': 'Léimeann an sionnach donn tapa thar an madra leisciúil in aice na habhann. Is tástáil córais sintéise cainte é seo.',
    'hr': 'Brza smeđa lisica skače preko lijenog psa kraj rijeke. Ovo je test sustava za sintezu govora.',
    'mt': "Il volpi kannella velocci taqbez fuq il kelb ghazziena hdejn ix xmara. Dan huwa test tas sistema ta sinteezi tal vuci.",
    'sk': 'Rýchla hnedá líška skočí cez lenivého psa pri rieke. Toto je test systému syntézy reči dnes.',
    'lt': 'Greita ruda lapė šoka per tingų šunį prie upės. Tai kalbos sintezės sistemos testas šiandien.',
    'lv': 'Ātrā brūnā lapsa lec pāri slinkajam sunim pie upes. Šis ir runas sintēzes sistēmas tests šodien.',
    'lb': 'De schnelle brong Fuuss spréngt iwwer de faulen Hond beim Floss. Dëst ass en Test vum Sprooichsynthesesystem.',
    'gu': 'ઝડપી ભૂરા શિયાળ આળસુ કૂતરા ઉપરથી કૂદે છે નદી પાસે. આ વાક્ સંશ્લેષણ પ્રણાલીની કસોટી છે.',
    'bn': 'দ্রুত বাদামী শিয়াল অলস কুকুরের উপর দিয়ে লাফ দেয় নদীর ধারে। এটি একটি বাক্ সংশ্লেষণ পরীক্ষা আজ।',
    'af': "Die vinnige bruin jakkals spring oor die lui hond by die rivier. Dit is 'n toets van die spraaksintesisstelsel.",
    'tn': 'Phokojwe e e lebelo e tlola ntša e e botswa gaufi le noka. Se ke teko ya tsamaiso ya go bua gompieno.',
    'th': 'สุนัขจิ้งจอกสีน้ำตาลกระโดดข้ามสุนัขขี้เกียจข้างแม่น้ำ นี่คือการทดสอบระบบสังเคราะห์เสียงวันนี้',
    'nan': '一隻快速的咖啡色狐狸跳過一隻懶惰的狗佇溪仔邊。這是語音合成系統的測試，今仔日天氣真好。',
    'sw': 'Mbweha mwenye rangi ya kahawia anayeruka juu ya mbwa mvivu karibu na mto. Hii ni jaribio la mfumo wa usanisi wa hotuba.',
    'yue': '快速嘅啡色狐狸跳過懶惰嘅狗仔喺河邊。呢個係語音合成系統嘅測試，今日天氣好好呀。',
    'sr': 'Брза смеђа лисица скаче преко лењог пса поред реке. Ово је тест система за синтезу говора данас.',
    'ka': 'სწრაფი ყავისფერი მელა ხტება ზარმაც ძაღლზე მდინარესთან. ეს არის მეტყველების სინთეზის ტესტი დღეს.',
    'id': 'Rubah coklat yang cepat melompati anjing malas di dekat sungai. Ini adalah tes sistem sintesis suara hari ini.',
    'multi': 'The quick brown fox jumps over the lazy dog near the river. 快速的棕色狐狸跳过了懒狗。今天天气很好。',
}

MMS_LANG = {'deu':'de','eng':'en','fra':'fr','nan':'nan','rus':'ru','spa':'es','tha':'th','ukr':'uk'}

def detect_lang(model_id):
    if model_id.startswith('kitten'): return 'en'
    if model_id.startswith('kokoro'): return 'multi'
    if model_id.startswith('pocket'): return 'multi'
    if model_id.startswith('zipvoice'): return 'zh'
    if model_id.startswith('cantonese'): return 'yue'
    if model_id.startswith('zh-ll'): return 'zh'
    if model_id.startswith('melo-tts-zh'): return 'zh'
    if model_id.startswith('melo-tts-en'): return 'en'
    if model_id.startswith('icefall-zh'): return 'zh'
    if model_id.startswith('icefall-en'): return 'en'
    if model_id.startswith('matcha-'):
        rest = model_id[7:]
        if rest.startswith('zh'): return 'zh'
        if rest.startswith('en'): return 'en'
        if rest.startswith('fa'): return 'fa'
        return 'en'
    if model_id.startswith('mms-'):
        return MMS_LANG.get(model_id[4:], 'en')
    # Piper
    if model_id.startswith('piper-'):
        rest = model_id[6:]
        if rest.startswith('fa-en-'): return 'fa'
        if rest.startswith('es-ar-'): return 'es'
        if rest.startswith('es-mx-'): return 'es'
        if rest.startswith('pt-br-'): return 'pt'
        if rest.startswith('en-gb-'): return 'en'
        if rest.startswith('nl-be-'): return 'nl'
        m = re.match(r'^([a-z]{2})(?:-|$)', rest)
        if m: return m.group(1)
    # Coqui
    if model_id.startswith('coqui-'):
        m = re.match(r'^([a-z]{2})(?:-|$)', model_id[6:])
        if m: return m.group(1)
    # Mimic3
    if model_id.startswith('mimic3-'):
        m = re.match(r'^([a-z]{2})(?:-|$)', model_id[7:])
        if m: return m.group(1)
    return 'en'

def get_size_mb(wasm_dir):
    total = 0
    dp = os.path.join(BASE, wasm_dir)
    for f in os.listdir(dp):
        fp = os.path.join(dp, f)
        if os.path.isfile(fp):
            total += os.path.getsize(fp)
    return round(total / 1024 / 1024, 1)

models = []
for d in sorted(os.listdir(BASE)):
    if not d.startswith('wasm-') or not os.path.isdir(os.path.join(BASE, d)):
        continue
    dp = os.path.join(BASE, d)
    required = ['sherpa-onnx-wasm-main-tts.js','sherpa-onnx-wasm-main-tts.wasm',
                'sherpa-onnx-wasm-main-tts.data','sherpa-onnx-tts.js']
    if not all(os.path.exists(os.path.join(dp, f)) for f in required):
        continue
    mid = d[5:]  # strip "wasm-"
    is_int8 = mid.endswith('-int8')
    base_id = mid[:-5] if is_int8 else mid
    lang = detect_lang(base_id)
    models.append({
        'id': mid,
        'wasm': d,
        'lang': lang,
        'int8': is_int8,
        'sizeMB': get_size_mb(d),
    })

out = os.path.join(BASE, 'benchmark-config.json')
with open(out, 'w') as f:
    json.dump({'models': models, 'texts': TEXTS}, f, ensure_ascii=False)
print(f'{len(models)} models → {out}')
