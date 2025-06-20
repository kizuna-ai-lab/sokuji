const fs = require('fs');
const path = require('path');

// All supported languages
const allLanguages = [
  'ar', 'am', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 
  'en_AU', 'en_GB', 'en_US', 'es', 'es_419', 'et', 'fa', 'fi', 
  'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 
  'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pl', 
  'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 
  'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW'
];

// Whereby messages for different languages
const wherebyMessages = {
  // English variants
  'en': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'To use Sokuji, please select <strong>"Sokuji Virtual Microphone"</strong> in your microphone settings and <strong>disable Noise reduction</strong> for better performance.'
  },
  'en_AU': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'To use Sokuji, please select <strong>"Sokuji Virtual Microphone"</strong> in your microphone settings and <strong>disable Noise reduction</strong> for better performance.'
  },
  'en_GB': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'To use Sokuji, please select <strong>"Sokuji Virtual Microphone"</strong> in your microphone settings and <strong>disable Noise reduction</strong> for better performance.'
  },
  'en_US': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'To use Sokuji, please select <strong>"Sokuji Virtual Microphone"</strong> in your microphone settings and <strong>disable Noise reduction</strong> for better performance.'
  },
  // Chinese
  'zh_CN': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: '要使用 Sokuji，请在麦克风设置中选择<strong>"Sokuji Virtual Microphone"</strong>，并<strong>关闭噪声抑制</strong>以获得更好的性能。'
  },
  'zh_TW': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: '要使用 Sokuji，請在麥克風設置中選擇<strong>"Sokuji Virtual Microphone"</strong>，並<strong>關閉噪聲抑制</strong>以獲得更好的性能。'
  },
  // Spanish
  'es': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Para usar Sokuji, selecciona <strong>"Sokuji Virtual Microphone"</strong> en la configuración del micrófono y <strong>desactiva la reducción de ruido</strong> para un mejor rendimiento.'
  },
  'es_419': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Para usar Sokuji, selecciona <strong>"Sokuji Virtual Microphone"</strong> en la configuración del micrófono y <strong>desactiva la reducción de ruido</strong> para un mejor rendimiento.'
  },
  // French
  'fr': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Pour utiliser Sokuji, sélectionnez <strong>"Sokuji Virtual Microphone"</strong> dans les paramètres du microphone et <strong>désactivez la réduction de bruit</strong> pour de meilleures performances.'
  },
  // German
  'de': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Um Sokuji zu verwenden, wählen Sie <strong>"Sokuji Virtual Microphone"</strong> in den Mikrofoneinstellungen und <strong>deaktivieren Sie die Rauschunterdrückung</strong> für bessere Leistung.'
  },
  // Japanese
  'ja': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokujiを使用するには、マイク設定で<strong>"Sokuji Virtual Microphone"</strong>を選択し、より良いパフォーマンスのために<strong>ノイズ除去を無効</strong>にしてください。'
  },
  // Korean
  'ko': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji를 사용하려면 마이크 설정에서 <strong>"Sokuji Virtual Microphone"</strong>을 선택하고 더 나은 성능을 위해 <strong>노이즈 감소를 비활성화</strong>하세요.'
  },
  // Arabic
  'ar': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'لاستخدام Sokuji، يرجى تحديد <strong>"Sokuji Virtual Microphone"</strong> في إعدادات الميكروفون و<strong>إلغاء تنشيط تقليل الضوضاء</strong> للحصول على أداء أفضل.'
  },
  // Russian
  'ru': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Чтобы использовать Sokuji, выберите <strong>"Sokuji Virtual Microphone"</strong> в настройках микрофона и <strong>отключите шумоподавление</strong> для лучшей производительности.'
  },
  // Portuguese
  'pt_BR': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Para usar o Sokuji, selecione <strong>"Sokuji Virtual Microphone"</strong> nas configurações do microfone e <strong>desative a redução de ruído</strong> para melhor performance.'
  },
  'pt_PT': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Para usar o Sokuji, seleccione <strong>"Sokuji Virtual Microphone"</strong> nas definições do microfone e <strong>desactive a redução de ruído</strong> para melhor performance.'
  },
  // Italian
  'it': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Per utilizzare Sokuji, seleziona <strong>"Sokuji Virtual Microphone"</strong> nelle impostazioni del microfono e <strong>disabilita la riduzione del rumore</strong> per prestazioni migliori.'
  },
  // Dutch
  'nl': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Om Sokuji te gebruiken, selecteer <strong>"Sokuji Virtual Microphone"</strong> in de microfooninstellingen en <strong>schakel ruisonderdrukking uit</strong> voor betere prestaties.'
  },
  // Hindi
  'hi': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji का उपयोग करने के लिए, माइक्रोफ़ोन सेटिंग्स में <strong>"Sokuji Virtual Microphone"</strong> चुनें और बेहतर प्रदर्शन के लिए <strong>शोर में कमी को अक्षम</strong> करें।'
  },
  // Thai
  'th': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'หากต้องการใช้ Sokuji โปรดเลือก <strong>"Sokuji Virtual Microphone"</strong> ในการตั้งค่าไมโครโฟนและ<strong>ปิดการลดเสียงรบกวน</strong>เพื่อประสิทธิภาพที่ดีกว่า'
  },
  // Vietnamese
  'vi': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Để sử dụng Sokuji, vui lòng chọn <strong>"Sokuji Virtual Microphone"</strong> trong cài đặt microphone và <strong>tắt tính năng giảm tiếng ồn</strong> để có hiệu suất tốt hơn.'
  },
  // Indonesian
  'id': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Untuk menggunakan Sokuji, silakan pilih <strong>"Sokuji Virtual Microphone"</strong> di pengaturan mikrofon dan <strong>nonaktifkan pengurangan noise</strong> untuk performa yang lebih baik.'
  },
  // Malay
  'ms': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Untuk menggunakan Sokuji, sila pilih <strong>"Sokuji Virtual Microphone"</strong> dalam tetapan mikrofon dan <strong>nyahaktifkan pengurangan hingar</strong> untuk prestasi yang lebih baik.'
  },
  // Turkish
  'tr': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji\'yi kullanmak için mikrofon ayarlarından <strong>"Sokuji Virtual Microphone"</strong> seçin ve daha iyi performans için <strong>gürültü azaltmayı devre dışı bırakın</strong>.'
  },
  // Polish
  'pl': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Aby używać Sokuji, wybierz <strong>"Sokuji Virtual Microphone"</strong> w ustawieniach mikrofonu i <strong>wyłącz redukcję szumów</strong> dla lepszej wydajności.'
  },
  // Czech
  'cs': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Chcete-li používat Sokuji, vyberte <strong>"Sokuji Virtual Microphone"</strong> v nastavení mikrofonu a <strong>zakažte redukci šumu</strong> pro lepší výkon.'
  },
  // Finnish
  'fi': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Käyttääksesi Sokuji-sovellusta, valitse <strong>"Sokuji Virtual Microphone"</strong> mikrofoniasetuksista ja <strong>poista kohinanvaimennus käytöstä</strong> paremman suorituskyvyn saavuttamiseksi.'
  },
  // Swedish
  'sv': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'För att använda Sokuji, välj <strong>"Sokuji Virtual Microphone"</strong> i mikrofoninställningarna och <strong>inaktivera brusreducering</strong> för bättre prestanda.'
  },
  // Norwegian
  'no': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'For å bruke Sokuji, velg <strong>"Sokuji Virtual Microphone"</strong> i mikrofoninnstillingene og <strong>deaktiver støyreduksjon</strong> for bedre ytelse.'
  },
  // Danish
  'da': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'For at bruge Sokuji skal du vælge <strong>"Sokuji Virtual Microphone"</strong> i mikrofonindstillingerne og <strong>deaktivere støjreduktion</strong> for bedre ydeevne.'
  },
  // Hebrew
  'he': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'כדי להשתמש ב-Sokuji, אנא בחר <strong>"Sokuji Virtual Microphone"</strong> בהגדרות המיקרופון ו<strong>השבת את הפחתת הרעש</strong> לביצועים טובים יותר.'
  },
  // Bengali
  'bn': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji ব্যবহার করতে, মাইক্রোফোন সেটিংসে <strong>"Sokuji Virtual Microphone"</strong> নির্বাচন করুন এবং আরও ভাল পারফরম্যান্সের জন্য <strong>শব্দ হ্রাস অক্ষম</strong> করুন।'
  },
  // Tamil
  'ta': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji ஐ பயன்படுத்த, மைக்ரோஃபோன் அமைப்புகளில் <strong>"Sokuji Virtual Microphone"</strong> ஐ தேர்ந்தெடுத்து, சிறந்த செயல்திறனுக்காக <strong>சத்தம் குறைப்பை முடக்கவும்</strong>.'
  },
  // Telugu  
  'te': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji ని ఉపయోగించడానికి, మైక్రోఫోన్ సెట్టింగ్‌లలో <strong>"Sokuji Virtual Microphone"</strong> ని ఎంచుకోండి మరియు మెరుగైన పనితీరు కోసం <strong>శబ్దం తగ్గింపును నిలిపివేయండి</strong>.'
  },
  // Gujarati
  'gu': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji નો ઉપયોગ કરવા માટે, માઇક્રોફોન સેટિંગ્સમાં <strong>"Sokuji Virtual Microphone"</strong> પસંદ કરો અને વધુ સારી કામગીરી માટે <strong>અવાજ ઘટાડવાને અક્ષમ</strong> કરો.'
  },
  // Marathi
  'mr': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji वापरण्यासाठी, मायक्रोफोन सेटिंग्जमध्ये <strong>"Sokuji Virtual Microphone"</strong> निवडा आणि चांगल्या कामगिरीसाठी <strong>आवाज कमी करणे अक्षम</strong> करा.'
  },
  // Kannada
  'kn': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji ಬಳಸಲು, ಮೈಕ್ರೊಫೋನ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ <strong>"Sokuji Virtual Microphone"</strong> ಆಯ್ಕೆಮಾಡಿ ಮತ್ತು ಉತ್ತಮ ಕಾರ್ಯಕ್ಷಮತೆಗಾಗಿ <strong>ಶಬ್ದ ಕಡಿಮೆ ಮಾಡುವಿಕೆಯನ್ನು ನಿಷ್ಕ್ರಿಯಗೊಳಿಸಿ</strong>.'
  },
  // Malayalam
  'ml': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji ഉപയോഗിക്കാൻ, മൈക്രോഫോൺ സെറ്റിംഗുകളിൽ <strong>"Sokuji Virtual Microphone"</strong> തിരഞ്ഞെടുക്കുക, മികച്ച പ്രകടനത്തിനായി <strong>ശബ്ദം കുറയ്ക്കൽ പ്രവർത്തനരഹിതമാക്കുക</strong>.'
  },
  // Ukrainian
  'uk': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Щоб використовувати Sokuji, виберіть <strong>"Sokuji Virtual Microphone"</strong> у налаштуваннях мікрофона та <strong>вимкніть шумоподавлення</strong> для кращої продуктивності.'
  },
  // Greek
  'el': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Για να χρησιμοποιήσετε το Sokuji, επιλέξτε <strong>"Sokuji Virtual Microphone"</strong> στις ρυθμίσεις μικροφώνου και <strong>απενεργοποιήστε τη μείωση θορύβου</strong> για καλύτερη απόδοση.'
  },
  // Bulgarian
  'bg': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'За да използвате Sokuji, моля изберете <strong>"Sokuji Virtual Microphone"</strong> в настройките на микрофона и <strong>деактивирайте намаляването на шума</strong> за по-добра производителност.'
  },
  // Romanian
  'ro': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Pentru a utiliza Sokuji, vă rugăm să selectați <strong>"Sokuji Virtual Microphone"</strong> în setările microfonului și <strong>dezactivați reducerea zgomotului</strong> pentru o performanță mai bună.'
  },
  // Serbian
  'sr': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Да бисте користили Sokuji, молимо изаберите <strong>"Sokuji Virtual Microphone"</strong> у подешавањима микрофона и <strong>онемогућите смањење буке</strong> за боље перформансе.'
  },
  // Croatian
  'hr': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Za korištenje Sokuji, molimo odaberite <strong>"Sokuji Virtual Microphone"</strong> u postavkama mikrofona i <strong>onemogućite smanjenje buke</strong> za bolju izvedbu.'
  },
  // Slovak
  'sk': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Ak chcete používať Sokuji, vyberte <strong>"Sokuji Virtual Microphone"</strong> v nastaveniach mikrofónu a <strong>zakážte redukciu šumu</strong> pre lepší výkon.'
  },
  // Slovenian
  'sl': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Za uporabo Sokuji izberite <strong>"Sokuji Virtual Microphone"</strong> v nastavitvah mikrofona in <strong>onemogočite zmanjšanje hrupa</strong> za boljšo zmogljivost.'
  },
  // Estonian
  'et': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji kasutamiseks valige mikrofoni seadetes <strong>"Sokuji Virtual Microphone"</strong> ja <strong>keelake müra vähendamine</strong> parema jõudluse tagamiseks.'
  },
  // Latvian
  'lv': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Lai izmantotu Sokuji, mikrofona iestatījumos izvēlieties <strong>"Sokuji Virtual Microphone"</strong> un <strong>atspējojiet trokšņa samazināšanu</strong> labākai veiktspējai.'
  },
  // Lithuanian
  'lt': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Norėdami naudoti Sokuji, mikrofono nustatymuose pasirinkite <strong>"Sokuji Virtual Microphone"</strong> ir <strong>išjunkite triukšmo mažinimą</strong> geresniam našumui.'
  },
  // Hungarian
  'hu': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'A Sokuji használatához válassza a <strong>"Sokuji Virtual Microphone"</strong> lehetőséget a mikrofon beállításaiban, és <strong>tiltsa le a zajcsökkentést</strong> a jobb teljesítmény érdekében.'
  },
  // Persian/Farsi
  'fa': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'برای استفاده از Sokuji، لطفاً <strong>"Sokuji Virtual Microphone"</strong> را در تنظیمات میکروفون انتخاب کنید و <strong>کاهش نویز را غیرفعال</strong> کنید تا عملکرد بهتری داشته باشید.'
  },
  // Filipino
  'fil': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Upang magamit ang Sokuji, pakipili ang <strong>"Sokuji Virtual Microphone"</strong> sa mga setting ng mikropono at <strong>i-disable ang noise reduction</strong> para sa mas magandang performance.'
  },
  // Amharic
  'am': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Sokuji ን ለመጠቀም፣ እባክዎን <strong>"Sokuji Virtual Microphone"</strong> ን በማይክሮፎን ቅንብሮች ውስጥ ይምረጡ እና <strong>ድምፅ መቀነስን ያሰናክሉ</strong> በተሻለ አፈጻጸም።'
  },
  // Swahili
  'sw': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Ili kutumia Sokuji, tafadhali chagua <strong>"Sokuji Virtual Microphone"</strong> katika mipangilio ya mikrofoni na <strong>zima kupunguza kelele</strong> kwa utendakazi bora zaidi.'
  },
  // Catalan
  'ca': {
    wherebyTitle: 'Sokuji for Whereby',
    wherebyGuidance: 'Per utilitzar Sokuji, seleccioneu <strong>"Sokuji Virtual Microphone"</strong> a la configuració del micròfon i <strong>desactiveu la reducció de soroll</strong> per obtenir un millor rendiment.'
  }
};

// Function to add Whereby messages to a locale file
function addWherebyMessages(langCode) {
  const localeDir = path.join(__dirname, '..', 'extension', '_locales', langCode);
  const messagesFile = path.join(localeDir, 'messages.json');
  
  if (!fs.existsSync(messagesFile)) {
    console.warn(`Messages file not found for ${langCode}: ${messagesFile}`);
    return false;
  }
  
  try {
    // Read existing messages
    const existingMessages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
    
    // Get Whereby messages for this language (fallback to English)
    const wherebyMsg = wherebyMessages[langCode] || wherebyMessages['en'];
    
    // Add or update Whereby messages after gatherTownGuidance and before gotIt
    const newMessages = {};
    
    // Copy all existing messages and update/add Whereby messages
    let foundGatherTownGuidance = false;
    let addedWhereby = false;
    
    for (const [key, value] of Object.entries(existingMessages)) {
      newMessages[key] = value;
      
      if (key === 'gatherTownGuidance') {
        foundGatherTownGuidance = true;
        // Add/update Whereby messages after gatherTownGuidance
        newMessages.wherebyTitle = {
          message: wherebyMsg.wherebyTitle
        };
        newMessages.wherebyGuidance = {
          message: wherebyMsg.wherebyGuidance
        };
        addedWhereby = true;
      }
      // Skip existing Whereby messages - we'll overwrite them
      else if (key === 'wherebyTitle' || key === 'wherebyGuidance') {
        // Skip - we'll add updated ones after gatherTownGuidance
        continue;
      }
    }
    
    // If gatherTownGuidance was not found, add Whereby messages before gotIt
    if (!foundGatherTownGuidance && !addedWhereby) {
      const tempMessages = {};
      
      for (const [key, value] of Object.entries(newMessages)) {
        if (key === 'gotIt') {
          // Add Whereby messages before gotIt
          tempMessages.wherebyTitle = {
            message: wherebyMsg.wherebyTitle
          };
          tempMessages.wherebyGuidance = {
            message: wherebyMsg.wherebyGuidance
          };
          addedWhereby = true;
        }
        tempMessages[key] = value;
      }
      
      Object.assign(newMessages, tempMessages);
    }
    
    // Write updated messages
    fs.writeFileSync(messagesFile, JSON.stringify(newMessages, null, 2), 'utf8');
    console.log(`${langCode}: Updated Whereby messages successfully`);
    return true;
    
  } catch (error) {
    console.error(`Error processing ${langCode}:`, error.message);
    return false;
  }
}

// Main function
function addWherebyToAllLocales() {
  console.log('Adding Whereby messages to all locale files...\n');
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const langCode of allLanguages) {
    if (addWherebyMessages(langCode)) {
      successCount++;
    } else {
      errorCount++;
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Successfully processed: ${successCount} languages`);
  console.log(`Errors: ${errorCount} languages`);
  console.log(`Total: ${allLanguages.length} languages`);
}

// Run the script
if (require.main === module) {
  addWherebyToAllLocales();
}

module.exports = { addWherebyToAllLocales, addWherebyMessages }; 