const fs = require('fs');
const path = require('path');

// All 52 languages from the user's list
const allLanguages = [
  'ar', 'am', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 
  'en_AU', 'en_GB', 'en_US', 'es', 'es_419', 'et', 'fa', 'fi', 
  'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 
  'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pl', 
  'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 
  'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW'
];

// Base English template
const englishTranslations = {
  extensionName: 'Eburon - AI-powered Live Speech Translation for Online Meetings',
  extensionDescription: 'AI-powered instant speech translation for all video meetings. Break language barriers with real-time voice translation.',
  popupTitle: 'Eburon - Supported Sites',
  openEburon: 'Open Eburon',
  chromeWebStore: 'Chrome Web Store',
  EburonAvailable: '✓ Eburon is available on $SITE_NAME$!',
  clickToStart: 'Click "Open Eburon" below to start real-time translation.',
  quickStart: 'Quick Start:',
  quickStartInstructions: 'Configure your OpenAI API key → Select "Eburon_Virtual_Mic" as microphone → Start speaking!',
  notSupported: '⚠ Not supported on this site',
  currentlyOn: 'Currently on $HOSTNAME$. Eburon works on these platforms:',
  needMoreSites: 'Need support for more sites?',
  contactUs: 'Contact us at',
  contributeCode: 'contribute to our',
  openSourceProject: 'open source project',
  unableToDetect: '⚠ Unable to detect current site',
  refreshAndTry: 'Please refresh the page and try again.',
  needMoreSitesShort: 'Need more sites?',
  contactUsShort: 'Contact us',
  contributeCodeShort: 'contribute code',
  showMoreSites: 'Show $COUNT$ more sites',
  showLessSites: 'Show less sites'
};

// Specific translations for key languages
const specificTranslations = {
  'ar': {
    extensionName: 'Eburon - ترجمة الكلام المباشر بالذكاء الاصطناعي للاجتماعات الإلكترونية',
    extensionDescription: 'ترجمة فورية للكلام بالذكاء الاصطناعي لجميع اجتماعات الفيديو. كسر حواجز اللغة مع الترجمة الصوتية في الوقت الفعلي.',
    popupTitle: 'Eburon - المواقع المدعومة',
    openEburon: 'فتح Eburon',
    chromeWebStore: 'متجر Chrome الإلكتروني',
    EburonAvailable: '✓ Eburon متاح على $SITE_NAME$!',
    clickToStart: 'انقر على "فتح Eburon" أدناه لبدء الترجمة في الوقت الفعلي.',
    quickStart: 'البدء السريع:',
    quickStartInstructions: 'قم بتكوين مفتاح OpenAI API الخاص بك ← حدد "Eburon_Virtual_Mic" كميكروفون ← ابدأ بالتحدث!',
    notSupported: '⚠ غير مدعوم على هذا الموقع',
    currentlyOn: 'حالياً على $HOSTNAME$. Eburon يعمل على هذه المنصات:',
    needMoreSites: 'تحتاج دعم لمواقع أكثر؟',
    contactUs: 'اتصل بنا على',
    contributeCode: 'ساهم في',
    openSourceProject: 'مشروعنا مفتوح المصدر',
    unableToDetect: '⚠ غير قادر على اكتشاف الموقع الحالي',
    refreshAndTry: 'يرجى تحديث الصفحة والمحاولة مرة أخرى.',
    needMoreSitesShort: 'تحتاج مواقع أكثر؟',
    contactUsShort: 'اتصل بنا',
    contributeCodeShort: 'ساهم بالكود'
  },
  'zh_CN': {
    extensionName: 'Eburon - AI驱动的在线会议实时语音翻译',
    extensionDescription: 'AI驱动的即时语音翻译，适用于所有视频会议。通过实时语音翻译打破语言障碍。',
    popupTitle: 'Eburon - 支持的网站',
    openEburon: '打开 Eburon',
    chromeWebStore: 'Chrome 网上应用店',
    EburonAvailable: '✓ Eburon 在 $SITE_NAME$ 上可用！',
    clickToStart: '点击下方的"打开 Eburon"开始实时翻译。',
    quickStart: '快速开始：',
    quickStartInstructions: '配置您的 OpenAI API 密钥 ← 选择"Eburon_Virtual_Mic"作为麦克风 ← 开始说话！',
    notSupported: '⚠ 此网站不支持',
    currentlyOn: '当前在 $HOSTNAME$。Eburon 支持这些平台：',
    needMoreSites: '需要支持更多网站？',
    contactUs: '联系我们：',
    contributeCode: '为我们的',
    openSourceProject: '开源项目贡献代码',
    unableToDetect: '⚠ 无法检测当前网站',
    refreshAndTry: '请刷新页面后重试。',
    needMoreSitesShort: '需要更多网站？',
    contactUsShort: '联系我们',
    contributeCodeShort: '贡献代码',
    showMoreSites: '显示更多 $COUNT$ 个网站',
    showLessSites: '收起网站列表'
  },
  'es': {
    extensionName: 'Eburon - Traducción de Voz en Vivo con IA para Reuniones Online',
    extensionDescription: 'Traducción instantánea de voz con IA para todas las videollamadas. Rompe las barreras del idioma con traducción de voz en tiempo real.',
    popupTitle: 'Eburon - Sitios Compatibles',
    openEburon: 'Abrir Eburon',
    chromeWebStore: 'Chrome Web Store',
    EburonAvailable: '✓ ¡Eburon está disponible en $SITE_NAME$!',
    clickToStart: 'Haz clic en "Abrir Eburon" a continuación para comenzar la traducción en tiempo real.',
    quickStart: 'Inicio Rápido:',
    quickStartInstructions: 'Configura tu clave API de OpenAI → Selecciona "Eburon_Virtual_Mic" como micrófono → ¡Comienza a hablar!',
    notSupported: '⚠ No compatible con este sitio',
    currentlyOn: 'Actualmente en $HOSTNAME$. Eburon funciona en estas plataformas:',
    needMoreSites: '¿Necesitas soporte para más sitios?',
    contactUs: 'Contáctanos en',
    contributeCode: 'contribuye a nuestro',
    openSourceProject: 'proyecto de código abierto',
    unableToDetect: '⚠ No se puede detectar el sitio actual',
    refreshAndTry: 'Por favor, actualiza la página e inténtalo de nuevo.',
    needMoreSitesShort: '¿Más sitios?',
    contactUsShort: 'Contáctanos',
    contributeCodeShort: 'contribuir código',
    showMoreSites: 'Mostrar $COUNT$ sitios más',
    showLessSites: 'Mostrar menos sitios'
  },
  'fr': {
    extensionName: 'Eburon - Traduction Vocale en Direct par IA pour Réunions en Ligne',
    extensionDescription: 'Traduction vocale instantanée par IA pour toutes les visioconférences. Brisez les barrières linguistiques avec la traduction vocale en temps réel.',
    popupTitle: 'Eburon - Sites Pris en Charge',
    openEburon: 'Ouvrir Eburon',
    chromeWebStore: 'Chrome Web Store',
    EburonAvailable: '✓ Eburon est disponible sur $SITE_NAME$ !',
    clickToStart: 'Cliquez sur "Ouvrir Eburon" ci-dessous pour commencer la traduction en temps réel.',
    quickStart: 'Démarrage Rapide :',
    quickStartInstructions: 'Configurez votre clé API OpenAI → Sélectionnez "Eburon_Virtual_Mic" comme microphone → Commencez à parler !',
    notSupported: '⚠ Non pris en charge sur ce site',
    currentlyOn: 'Actuellement sur $HOSTNAME$. Eburon fonctionne sur ces plateformes :',
    needMoreSites: 'Besoin de support pour plus de sites ?',
    contactUs: 'Contactez-nous à',
    contributeCode: 'contribuez à notre',
    openSourceProject: 'projet open source',
    unableToDetect: '⚠ Impossible de détecter le site actuel',
    refreshAndTry: 'Veuillez actualiser la page et réessayer.',
    needMoreSitesShort: 'Plus de sites ?',
    contactUsShort: 'Contactez-nous',
    contributeCodeShort: 'contribuer au code',
    showMoreSites: 'Afficher $COUNT$ sites de plus',
    showLessSites: 'Afficher moins de sites'
  },
  'ja': {
    extensionName: 'Eburon - オンライン会議用AI音声翻訳',
    extensionDescription: 'すべてのビデオ会議用のAI音声翻訳。リアルタイム音声翻訳で言語の壁を破る。',
    popupTitle: 'Eburon - 対応サイト',
    openEburon: 'Eburonを開く',
    chromeWebStore: 'Chrome ウェブストア',
    EburonAvailable: '✓ Eburonは$SITE_NAME$で利用可能です！',
    clickToStart: 'リアルタイム翻訳を開始するには、下の「Eburonを開く」をクリックしてください。',
    quickStart: 'クイックスタート：',
    quickStartInstructions: 'OpenAI APIキーを設定 ← マイクとして「Eburon_Virtual_Mic」を選択 ← 話し始める！',
    notSupported: '⚠ このサイトではサポートされていません',
    currentlyOn: '現在$HOSTNAME$にいます。Eburonはこれらのプラットフォームで動作します：',
    needMoreSites: 'より多くのサイトのサポートが必要ですか？',
    contactUs: 'お問い合わせ',
    contributeCode: '私たちの',
    openSourceProject: 'オープンソースプロジェクトに貢献',
    unableToDetect: '⚠ 現在のサイトを検出できません',
    refreshAndTry: 'ページを更新してもう一度お試しください。',
    needMoreSitesShort: 'より多くのサイト？',
    contactUsShort: 'お問い合わせ',
    contributeCodeShort: 'コード貢献',
    showMoreSites: 'さらに$COUNT$サイトを表示',
    showLessSites: 'サイトを折りたたむ'
  }
};

// Base template for messages.json
const createMessagesJson = (translations) => {
  return {
    "extensionName": {
      "message": translations.extensionName
    },
    "extensionDescription": {
      "message": translations.extensionDescription
    },
    "popupTitle": {
      "message": translations.popupTitle
    },
    "openEburon": {
      "message": translations.openEburon
    },
    "chromeWebStore": {
      "message": translations.chromeWebStore
    },
    "EburonAvailable": {
      "message": translations.EburonAvailable,
      "placeholders": {
        "site_name": {
          "content": "$1",
          "example": "Google Meet"
        }
      }
    },
    "clickToStart": {
      "message": translations.clickToStart
    },
    "quickStart": {
      "message": translations.quickStart
    },
    "quickStartInstructions": {
      "message": translations.quickStartInstructions
    },
    "notSupported": {
      "message": translations.notSupported
    },
    "currentlyOn": {
      "message": translations.currentlyOn,
      "placeholders": {
        "hostname": {
          "content": "$1",
          "example": "example.com"
        }
      }
    },
    "needMoreSites": {
      "message": translations.needMoreSites
    },
    "contactUs": {
      "message": translations.contactUs
    },
    "contributeCode": {
      "message": translations.contributeCode
    },
    "openSourceProject": {
      "message": translations.openSourceProject
    },
    "unableToDetect": {
      "message": translations.unableToDetect
    },
    "refreshAndTry": {
      "message": translations.refreshAndTry
    },
    "needMoreSitesShort": {
      "message": translations.needMoreSitesShort
    },
    "contactUsShort": {
      "message": translations.contactUsShort
    },
    "contributeCodeShort": {
      "message": translations.contributeCodeShort
    },
    "showMoreSites": {
      "message": translations.showMoreSites,
      "placeholders": {
        "count": {
          "content": "$1",
          "example": "4"
        }
      }
    },
    "showLessSites": {
      "message": translations.showLessSites
    }
  };
};

// Generate locale files
const generateAllLocaleFiles = () => {
  const extensionLocalesDir = path.join(__dirname, '..', 'extension', '_locales');
  
  // Ensure the _locales directory exists
  if (!fs.existsSync(extensionLocalesDir)) {
    fs.mkdirSync(extensionLocalesDir, { recursive: true });
  }
  
  let generatedCount = 0;
  
  // Generate files for each language
  allLanguages.forEach(langCode => {
    const langDir = path.join(extensionLocalesDir, langCode);
    
    // Create language directory
    if (!fs.existsSync(langDir)) {
      fs.mkdirSync(langDir, { recursive: true });
    }
    
    // Use specific translations if available, otherwise use English
    const translations = specificTranslations[langCode] || englishTranslations;
    
    // Create messages.json file
    const messagesJson = createMessagesJson(translations);
    const messagesPath = path.join(langDir, 'messages.json');
    
    fs.writeFileSync(messagesPath, JSON.stringify(messagesJson, null, 2), 'utf8');
    console.log(`Generated: ${langCode}/messages.json ${specificTranslations[langCode] ? '(translated)' : '(English fallback)'}`);
    generatedCount++;
  });
  
  console.log(`\nGenerated ${generatedCount} locale files successfully!`);
  console.log(`Languages with specific translations: ${Object.keys(specificTranslations).join(', ')}`);
  console.log(`Languages using English fallback: ${allLanguages.filter(lang => !specificTranslations[lang]).length}`);
};

// Run the generator
generateAllLocaleFiles(); 