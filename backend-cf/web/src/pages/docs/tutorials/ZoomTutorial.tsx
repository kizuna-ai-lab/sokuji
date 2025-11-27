/**
 * Zoom Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Zoom',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content:
        'This guide will walk you through setting up and using Sokuji with Zoom for real-time language translation during your meetings.',
    },
    steps: [
      {
        title: 'Open Zoom Meeting Link',
        content:
          'Open your Zoom meeting link in Chrome or Edge browser. The browser will attempt to open the Zoom desktop application.',
        screenshot: '1.png',
        tip: 'Make sure you have the Sokuji extension installed and enabled in your browser.',
      },
      {
        title: 'Decline Native App',
        content:
          'When prompted to open the Zoom desktop application, click <strong>Cancel</strong> or close the dialog box to stay in the browser.',
        screenshot: '2.png',
        tip: 'This is important - you must use the browser version of Zoom for Sokuji to work.',
      },
      {
        title: 'Join from Browser',
        content:
          'After declining the desktop app, look for the <strong>Join from your browser</strong> link that appears on the page and click it.',
        screenshot: '3.png',
        tip: 'This link may appear at the bottom of the page or in a notification message.',
      },
      {
        title: 'Open Sokuji Sidebar',
        content:
          'Click the Sokuji extension icon in the top-right corner of your browser, then click to open the Sokuji sidebar panel.',
        screenshot: '4.png',
        tip: 'The sidebar will open on the right side of your browser window.',
      },
      {
        title: 'Configure Sokuji Settings',
        content:
          'In the Sokuji sidebar, configure your translation settings including source and target languages, AI provider, and other preferences.',
        screenshot: '5.png',
        tip: 'Make sure to test your microphone and select the appropriate input device.',
      },
      {
        title: 'Select Virtual Microphone in Zoom',
        content:
          "In Zoom's audio settings, click the microphone dropdown and select <strong>Sokuji Virtual Microphone</strong> as your input device.",
        screenshot: '6.png',
        tip: 'You can access audio settings by clicking the arrow next to the microphone icon in Zoom.',
      },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Speak clearly and avoid background noise',
        'Pause briefly between sentences for better translation accuracy',
        'Check your internet connection for smooth performance',
        'Test your audio before important meetings',
      ],
    },
    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          question: "Why can't I see the Sokuji Virtual Microphone?",
          answer:
            "Make sure the Sokuji extension is installed and active. Try refreshing the Zoom page. If the issue persists, check that you've granted microphone permissions to the extension.",
        },
        {
          question: 'Can other participants hear both languages?',
          answer:
            "By default, participants only hear the translated audio. However, when you enable 'Original Audio Passthrough' in Sokuji's audio settings, participants will hear both your original voice and the translation simultaneously. This feature is useful when you want listeners to hear both languages for context or verification.",
        },
        {
          question: 'Does Sokuji work with Zoom recordings?',
          answer:
            "Yes, the translated audio will be included in the meeting recording if you're using Sokuji Virtual Microphone.",
        },
        {
          question: 'What is Original Audio Passthrough?',
          answer:
            'Original Audio Passthrough is a feature that allows your original voice to be transmitted alongside the translation. When enabled, listeners hear both languages simultaneously - your natural speech at a lower volume (30% by default) mixed with the AI translation. This is particularly useful for bilingual audiences or when you want to maintain the emotional tone and nuance of your original speech.',
        },
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content:
        'If you encounter any issues, please visit our <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub repository</a> or contact us at <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> for support.',
    },
  },
  zh: {
    pageTitle: '在 Zoom 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content: '本指南将指导您如何在 Zoom 中设置和使用 Sokuji，实现会议中的实时语言翻译。',
    },
    steps: [
      {
        title: '打开 Zoom 会议链接',
        content:
          '在 Chrome 或 Edge 浏览器中打开您的 Zoom 会议链接。浏览器会尝试打开 Zoom 桌面应用程序。',
        screenshot: '1.png',
        tip: '确保您已在浏览器中安装并启用了 Sokuji 扩展。',
      },
      {
        title: '拒绝打开原生应用',
        content:
          '当提示打开 Zoom 桌面应用程序时，点击<strong>取消</strong>或关闭对话框以留在浏览器中。',
        screenshot: '2.png',
        tip: '这很重要 - 您必须使用浏览器版本的 Zoom 才能使 Sokuji 工作。',
      },
      {
        title: '从浏览器加入',
        content: '拒绝桌面应用后，在页面上查找<strong>从您的浏览器加入</strong>链接并点击它。',
        screenshot: '3.png',
        tip: '此链接可能出现在页面底部或通知消息中。',
      },
      {
        title: '打开 Sokuji 侧边栏',
        content: '点击浏览器右上角的 Sokuji 扩展图标，然后点击打开 Sokuji 侧边栏面板。',
        screenshot: '4.png',
        tip: '侧边栏将在浏览器窗口的右侧打开。',
      },
      {
        title: '配置 Sokuji 设置',
        content:
          '在 Sokuji 侧边栏中，配置您的翻译设置，包括源语言和目标语言、AI 提供商和其他偏好设置。',
        screenshot: '5.png',
        tip: '确保测试您的麦克风并选择适当的输入设备。',
      },
      {
        title: '在 Zoom 中选择虚拟麦克风',
        content:
          '在 Zoom 的音频设置中，点击麦克风下拉菜单，选择 <strong>Sokuji Virtual Microphone</strong> 作为您的输入设备。',
        screenshot: '6.png',
        tip: '您可以通过点击 Zoom 中麦克风图标旁边的箭头来访问音频设置。',
      },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '清晰说话，避免背景噪音',
        '句子之间稍作停顿以提高翻译准确性',
        '检查网络连接以确保流畅性能',
        '重要会议前测试音频',
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        {
          question: '为什么看不到 Sokuji 虚拟麦克风？',
          answer:
            '确保 Sokuji 扩展已安装并处于活动状态。尝试刷新 Zoom 页面。如果问题仍然存在，请检查是否已授予扩展麦克风权限。',
        },
        {
          question: '其他参与者能听到两种语言吗？',
          answer:
            '默认情况下，参与者只能听到翻译后的音频。但是，当您在 Sokuji 的音频设置中启用"原声音频透传"功能时，参与者将同时听到您的原始声音和翻译。当您希望听众听到两种语言以便理解上下文或进行验证时，此功能非常有用。',
        },
        {
          question: 'Sokuji 支持 Zoom 录制吗？',
          answer: '是的，如果您使用 Sokuji 虚拟麦克风，翻译后的音频将包含在会议录制中。',
        },
        {
          question: '什么是原声音频透传？',
          answer:
            '原声音频透传是一项允许您的原始声音与翻译一起传输的功能。启用后，听众会同时听到两种语言 - 您的自然语音以较低的音量（默认为 30%）与 AI 翻译混合。这对于双语听众或当您想要保持原始语音的情感语调和细微差别时特别有用。',
        },
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content:
        '如果遇到任何问题，请访问我们的 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 仓库</a> 或发送邮件至 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> 获取支持。',
    },
  },
  ja: {
    pageTitle: 'Zoom で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content:
        'このガイドでは、Zoom で Sokuji を設定して使用し、会議中にリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Zoom ミーティングリンクを開く',
        content:
          'Chrome または Edge ブラウザで Zoom ミーティングリンクを開きます。ブラウザは Zoom デスクトップアプリケーションを開こうとします。',
        screenshot: '1.png',
        tip: 'ブラウザに Sokuji 拡張機能がインストールされ、有効になっていることを確認してください。',
      },
      {
        title: 'ネイティブアプリを拒否',
        content:
          'Zoom デスクトップアプリケーションを開くように求められたら、<strong>キャンセル</strong>をクリックするか、ダイアログボックスを閉じてブラウザに留まります。',
        screenshot: '2.png',
        tip: 'これは重要です - Sokuji を動作させるには、ブラウザ版の Zoom を使用する必要があります。',
      },
      {
        title: 'ブラウザから参加',
        content:
          'デスクトップアプリを拒否した後、ページに表示される<strong>ブラウザから参加してください</strong>リンクを探してクリックします。',
        screenshot: '3.png',
        tip: 'このリンクはページの下部または通知メッセージに表示される場合があります。',
      },
      {
        title: 'Sokuji サイドバーを開く',
        content:
          'ブラウザの右上隅にある Sokuji 拡張機能アイコンをクリックし、Sokuji サイドバーパネルを開きます。',
        screenshot: '4.png',
        tip: 'サイドバーはブラウザウィンドウの右側に開きます。',
      },
      {
        title: 'Sokuji 設定を構成',
        content:
          'Sokuji サイドバーで、ソース言語とターゲット言語、AI プロバイダー、その他の設定を含む翻訳設定を構成します。',
        screenshot: '5.png',
        tip: 'マイクをテストして、適切な入力デバイスを選択してください。',
      },
      {
        title: 'Zoom で仮想マイクを選択',
        content:
          'Zoom のオーディオ設定で、マイクのドロップダウンをクリックし、入力デバイスとして <strong>Sokuji Virtual Microphone</strong> を選択します。',
        screenshot: '6.png',
        tip: 'Zoom のマイクアイコンの横にある矢印をクリックして、オーディオ設定にアクセスできます。',
      },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        'はっきりと話し、背景ノイズを避ける',
        '翻訳精度を向上させるため、文の間で少し一時停止する',
        'スムーズなパフォーマンスのためにインターネット接続を確認する',
        '重要な会議の前にオーディオをテストする',
      ],
    },
    faq: {
      title: 'よくある質問',
      items: [
        {
          question: 'Sokuji 仮想マイクが表示されないのはなぜですか？',
          answer:
            'Sokuji 拡張機能がインストールされ、アクティブであることを確認してください。Zoom ページを更新してみてください。問題が解決しない場合は、拡張機能にマイクの権限を付与したかどうかを確認してください。',
        },
        {
          question: '他の参加者は両方の言語を聞くことができますか？',
          answer:
            'デフォルトでは、参加者は翻訳された音声のみを聞きます。ただし、Sokuji のオーディオ設定で「オリジナル音声パススルー」を有効にすると、参加者はあなたの元の声と翻訳を同時に聞くことができます。この機能は、リスナーにコンテキストの理解や検証のために両方の言語を聞いてもらいたい場合に便利です。',
        },
        {
          question: 'Sokuji は Zoom の録画で動作しますか？',
          answer:
            'はい、Sokuji 仮想マイクを使用している場合、翻訳された音声が会議の録画に含まれます。',
        },
        {
          question: 'オリジナル音声パススルーとは何ですか？',
          answer:
            'オリジナル音声パススルーは、あなたの元の声を翻訳と一緒に送信できる機能です。有効にすると、リスナーは両方の言語を同時に聞くことができます - あなたの自然な話し声を低い音量（デフォルトは 30%）で AI 翻訳とミックスして聞きます。これは、バイリンガルの聴衆や、元の話し声の感情的なトーンやニュアンスを維持したい場合に特に便利です。',
        },
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content:
        '問題が発生した場合は、<a href="https://github.com/kizuna-ai-lab/sokuji">GitHub リポジトリ</a>を訪問するか、<a href="mailto:support@kizuna.ai">support@kizuna.ai</a> までメールでお問い合わせください。',
    },
  },
  ko: {
    pageTitle: 'Zoom에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content:
        '이 가이드는 Zoom에서 Sokuji를 설정하고 사용하여 회의 중 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Zoom 회의 링크 열기',
        content:
          'Chrome 또는 Edge 브라우저에서 Zoom 회의 링크를 엽니다. 브라우저가 Zoom 데스크톱 애플리케이션을 열려고 시도합니다.',
        screenshot: '1.png',
        tip: '브라우저에 Sokuji 확장 프로그램이 설치되고 활성화되어 있는지 확인하세요.',
      },
      {
        title: '네이티브 앱 거부',
        content:
          'Zoom 데스크톱 애플리케이션을 열라는 메시지가 표시되면 <strong>취소</strong>를 클릭하거나 대화 상자를 닫아 브라우저에 남아있으세요.',
        screenshot: '2.png',
        tip: '이것은 중요합니다 - Sokuji가 작동하려면 브라우저 버전의 Zoom을 사용해야 합니다.',
      },
      {
        title: '브라우저에서 참여',
        content:
          '데스크톱 앱을 거부한 후 페이지에 나타나는 <strong>브라우저에서 참가</strong> 링크를 찾아 클릭하세요.',
        screenshot: '3.png',
        tip: '이 링크는 페이지 하단이나 알림 메시지에 나타날 수 있습니다.',
      },
      {
        title: 'Sokuji 사이드바 열기',
        content:
          '브라우저 오른쪽 상단의 Sokuji 확장 프로그램 아이콘을 클릭한 다음 Sokuji 사이드바 패널을 엽니다.',
        screenshot: '4.png',
        tip: '사이드바는 브라우저 창의 오른쪽에 열립니다.',
      },
      {
        title: 'Sokuji 설정 구성',
        content:
          'Sokuji 사이드바에서 소스 언어와 대상 언어, AI 제공업체 및 기타 환경 설정을 포함한 번역 설정을 구성하세요.',
        screenshot: '5.png',
        tip: '마이크를 테스트하고 적절한 입력 장치를 선택하세요.',
      },
      {
        title: 'Zoom에서 가상 마이크 선택',
        content:
          'Zoom의 오디오 설정에서 마이크 드롭다운을 클릭하고 입력 장치로 <strong>Sokuji Virtual Microphone</strong>을 선택하세요.',
        screenshot: '6.png',
        tip: 'Zoom의 마이크 아이콘 옆 화살표를 클릭하여 오디오 설정에 액세스할 수 있습니다.',
      },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '명확하게 말하고 배경 소음을 피하세요',
        '번역 정확도 향상을 위해 문장 사이에 잠시 멈추세요',
        '원활한 성능을 위해 인터넷 연결을 확인하세요',
        '중요한 회의 전에 오디오를 테스트하세요',
      ],
    },
    faq: {
      title: '자주 묻는 질문',
      items: [
        {
          question: 'Sokuji 가상 마이크가 보이지 않는 이유는 무엇인가요?',
          answer:
            'Sokuji 확장 프로그램이 설치되고 활성화되어 있는지 확인하세요. Zoom 페이지를 새로 고쳐 보세요. 문제가 지속되면 확장 프로그램에 마이크 권한을 부여했는지 확인하세요.',
        },
        {
          question: '다른 참가자들이 두 언어를 모두 들을 수 있나요?',
          answer:
            "기본적으로 참가자들은 번역된 오디오만 듣습니다. 그러나 Sokuji의 오디오 설정에서 '원본 오디오 패스스루'를 활성화하면 참가자들이 당신의 원래 목소리와 번역을 동시에 들을 수 있습니다. 이 기능은 청취자가 맥락 이해나 검증을 위해 두 언어를 모두 들어야 할 때 유용합니다.",
        },
        {
          question: 'Sokuji가 Zoom 녹화에서 작동하나요?',
          answer: '네, Sokuji 가상 마이크를 사용하는 경우 번역된 오디오가 회의 녹화에 포함됩니다.',
        },
        {
          question: '원본 오디오 패스스루란 무엇인가요?',
          answer:
            '원본 오디오 패스스루는 당신의 원래 목소리를 번역과 함께 전송할 수 있는 기능입니다. 활성화하면 청취자는 두 언어를 동시에 들을 수 있습니다 - 당신의 자연스러운 말소리를 낮은 볼륨(기본값 30%)으로 AI 번역과 믹스하여 듣습니다. 이것은 이중 언어 청중이나 원래 말소리의 감정적인 톤과 뉘앙스를 유지하고 싶을 때 특히 유용합니다.',
        },
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content:
        '문제가 발생하면 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 저장소</a>를 방문하거나 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a>로 이메일을 보내 지원을 받으세요.',
    },
  },
};

export function ZoomTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/zoom" />;
}
