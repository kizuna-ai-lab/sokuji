/**
 * Google Meet Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Google Meet',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content:
        'This guide will walk you through setting up and using Sokuji with Google Meet for real-time language translation during your meetings.',
    },
    steps: [
      {
        title: 'Visit Google Meet',
        content:
          'Open your browser and navigate to <code>meet.google.com</code>. Join or start a meeting as you normally would.',
        screenshot: '1.png',
        tip: 'Make sure you have the Sokuji extension installed and enabled in Chrome or Edge.',
      },
      {
        title: 'Grant Microphone Permission',
        content:
          'If Sokuji requests microphone permission, click <strong>"Allow while visiting the site"</strong> to grant access.',
        screenshot: '2.png',
        tip: 'This permission is required for Sokuji to process your audio for translation.',
      },
      {
        title: 'Open Sokuji Extension',
        content:
          'Click the Sokuji extension icon in the top-right corner of your browser, then click <strong>"Open Sokuji"</strong> to launch the sidebar panel.',
        screenshot: '3.png',
        tip: 'The Sokuji sidebar will open on the right side of your browser window.',
      },
      {
        title: 'Configure Sokuji Settings',
        content:
          'In the Sokuji sidebar, configure your translation settings including source and target languages, AI provider, and other preferences.',
        screenshot: '4.png',
        tip: 'Test your microphone input to ensure Sokuji is receiving audio correctly.',
      },
      {
        title: 'Select Sokuji Virtual Microphone',
        content:
          "In Google Meet's audio settings, click the microphone icon and select <strong>Sokuji Virtual Microphone</strong> from the dropdown menu.",
        screenshot: '5.png',
        tip: "If you don't see the virtual microphone, refresh the page and ensure the extension is active.",
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
            "Make sure the Sokuji extension is installed and active. Try refreshing the Google Meet page. If the issue persists, check that you've granted microphone permissions to the extension.",
        },
        {
          question: 'Can other participants hear both languages?',
          answer:
            "By default, participants only hear the translated audio. However, when you enable 'Original Audio Passthrough' in Sokuji's audio settings, participants will hear both your original voice and the translation simultaneously. This feature is useful when you want listeners to hear both languages for context or verification.",
        },
        {
          question: 'Does Sokuji work with Google Meet recordings?',
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
    pageTitle: '在 Google Meet 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content: '本指南将指导您如何在 Google Meet 中设置和使用 Sokuji，实现会议中的实时语言翻译。',
    },
    steps: [
      {
        title: '访问 Google Meet',
        content: '打开浏览器并访问 <code>meet.google.com</code>。像往常一样加入或开始会议。',
        screenshot: '1.png',
        tip: '确保您已在 Chrome 或 Edge 中安装并启用了 Sokuji 扩展。',
      },
      {
        title: '授予麦克风权限',
        content:
          '如果 Sokuji 请求麦克风权限，请点击<strong>"访问该网站时允许"</strong>以授予访问权限。',
        screenshot: '2.png',
        tip: '此权限是 Sokuji 处理您的音频以进行翻译所必需的。',
      },
      {
        title: '打开 Sokuji 扩展',
        content:
          '点击浏览器右上角的 Sokuji 扩展图标，然后点击<strong>"打开 Sokuji"</strong>以启动侧边栏面板。',
        screenshot: '3.png',
        tip: 'Sokuji 侧边栏将在浏览器窗口的右侧打开。',
      },
      {
        title: '配置 Sokuji 设置',
        content:
          '在 Sokuji 侧边栏中，配置您的翻译设置，包括源语言和目标语言、AI 提供商和其他偏好设置。',
        screenshot: '4.png',
        tip: '测试您的麦克风输入以确保 Sokuji 正确接收音频。',
      },
      {
        title: '选择 Sokuji 虚拟麦克风',
        content:
          '在 Google Meet 的音频设置中，点击麦克风图标并从下拉菜单中选择 <strong>Sokuji Virtual Microphone</strong>。',
        screenshot: '5.png',
        tip: '如果看不到虚拟麦克风，请刷新页面并确保扩展处于活动状态。',
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
            '确保 Sokuji 扩展已安装并处于活动状态。尝试刷新 Google Meet 页面。如果问题仍然存在，请检查是否已授予扩展麦克风权限。',
        },
        {
          question: '其他参与者能听到两种语言吗？',
          answer:
            '默认情况下，参与者只能听到翻译后的音频。但是，当您在 Sokuji 的音频设置中启用"原声音频透传"功能时，参与者将同时听到您的原始声音和翻译。当您希望听众听到两种语言以便理解上下文或进行验证时，此功能非常有用。',
        },
        {
          question: 'Sokuji 支持 Google Meet 录制吗？',
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
    pageTitle: 'Google Meet で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content:
        'このガイドでは、Google Meet で Sokuji を設定して使用し、会議中にリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Google Meet にアクセス',
        content:
          'ブラウザを開いて <code>meet.google.com</code> にアクセスします。通常どおり会議に参加または開始します。',
        screenshot: '1.png',
        tip: 'Chrome または Edge に Sokuji 拡張機能がインストールされ、有効になっていることを確認してください。',
      },
      {
        title: 'マイクの権限を許可',
        content:
          'Sokuji がマイクの権限を要求した場合、<strong>「このサイトへのアクセス時に許可」</strong>をクリックしてアクセスを許可します。',
        screenshot: '2.png',
        tip: 'この権限は、Sokuji が翻訳のために音声を処理するのに必要です。',
      },
      {
        title: 'Sokuji 拡張機能を開く',
        content:
          'ブラウザの右上隅にある Sokuji 拡張機能アイコンをクリックし、<strong>「Sokuji を開く」</strong>をクリックしてサイドバーパネルを起動します。',
        screenshot: '3.png',
        tip: 'Sokuji サイドバーはブラウザウィンドウの右側に開きます。',
      },
      {
        title: 'Sokuji 設定を構成',
        content:
          'Sokuji サイドバーで、ソース言語とターゲット言語、AI プロバイダー、その他の設定を含む翻訳設定を構成します。',
        screenshot: '4.png',
        tip: 'マイク入力をテストして、Sokuji が音声を正しく受信していることを確認します。',
      },
      {
        title: 'Sokuji 仮想マイクを選択',
        content:
          'Google Meet のオーディオ設定で、マイクアイコンをクリックし、ドロップダウンメニューから <strong>Sokuji Virtual Microphone</strong> を選択します。',
        screenshot: '5.png',
        tip: '仮想マイクが表示されない場合は、ページを更新して拡張機能がアクティブであることを確認してください。',
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
            'Sokuji 拡張機能がインストールされ、アクティブであることを確認してください。Google Meet ページを更新してみてください。問題が解決しない場合は、拡張機能にマイクの権限を付与したかどうかを確認してください。',
        },
        {
          question: '他の参加者は両方の言語を聞くことができますか？',
          answer:
            'デフォルトでは、参加者は翻訳された音声のみを聞きます。ただし、Sokuji のオーディオ設定で「オリジナル音声パススルー」を有効にすると、参加者はあなたの元の声と翻訳を同時に聞くことができます。この機能は、リスナーにコンテキストの理解や検証のために両方の言語を聞いてもらいたい場合に便利です。',
        },
        {
          question: 'Sokuji は Google Meet の録画で動作しますか？',
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
    pageTitle: 'Google Meet에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content:
        '이 가이드는 Google Meet에서 Sokuji를 설정하고 사용하여 회의 중 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Google Meet 방문',
        content:
          '브라우저를 열고 <code>meet.google.com</code>에 접속합니다. 평소처럼 회의에 참여하거나 시작하세요.',
        screenshot: '1.png',
        tip: 'Chrome 또는 Edge에 Sokuji 확장 프로그램이 설치되고 활성화되어 있는지 확인하세요.',
      },
      {
        title: '마이크 권한 부여',
        content:
          'Sokuji가 마이크 권한을 요청하면 <strong>"이 사이트 방문 시 허용"</strong>을 클릭하여 액세스를 허용합니다.',
        screenshot: '2.png',
        tip: '이 권한은 Sokuji가 번역을 위해 오디오를 처리하는 데 필요합니다.',
      },
      {
        title: 'Sokuji 확장 프로그램 열기',
        content:
          '브라우저 오른쪽 상단의 Sokuji 확장 프로그램 아이콘을 클릭한 다음 <strong>"Sokuji 열기"</strong>를 클릭하여 사이드바 패널을 시작합니다.',
        screenshot: '3.png',
        tip: 'Sokuji 사이드바는 브라우저 창의 오른쪽에 열립니다.',
      },
      {
        title: 'Sokuji 설정 구성',
        content:
          'Sokuji 사이드바에서 소스 언어와 대상 언어, AI 제공업체 및 기타 환경 설정을 포함한 번역 설정을 구성하세요.',
        screenshot: '4.png',
        tip: '마이크 입력을 테스트하여 Sokuji가 오디오를 올바르게 수신하는지 확인하세요.',
      },
      {
        title: 'Sokuji 가상 마이크 선택',
        content:
          'Google Meet의 오디오 설정에서 마이크 아이콘을 클릭하고 드롭다운 메뉴에서 <strong>Sokuji Virtual Microphone</strong>을 선택합니다.',
        screenshot: '5.png',
        tip: '가상 마이크가 보이지 않으면 페이지를 새로 고치고 확장 프로그램이 활성화되어 있는지 확인하세요.',
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
            'Sokuji 확장 프로그램이 설치되고 활성화되어 있는지 확인하세요. Google Meet 페이지를 새로 고쳐 보세요. 문제가 지속되면 확장 프로그램에 마이크 권한을 부여했는지 확인하세요.',
        },
        {
          question: '다른 참가자들이 두 언어를 모두 들을 수 있나요?',
          answer:
            "기본적으로 참가자들은 번역된 오디오만 듣습니다. 그러나 Sokuji의 오디오 설정에서 '원본 오디오 패스스루'를 활성화하면 참가자들이 당신의 원래 목소리와 번역을 동시에 들을 수 있습니다. 이 기능은 청취자가 맥락 이해나 검증을 위해 두 언어를 모두 들어야 할 때 유용합니다.",
        },
        {
          question: 'Sokuji가 Google Meet 녹화에서 작동하나요?',
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

export function GoogleMeetTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/google-meet" />;
}
