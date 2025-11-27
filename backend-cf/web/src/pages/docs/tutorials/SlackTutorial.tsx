/**
 * Slack Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Slack',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content: 'This guide will walk you through setting up and using Sokuji with Slack Huddles for real-time language translation during your conversations.',
    },
    steps: [
      {
        title: 'Install Sokuji Extension',
        content: 'Make sure you have the Sokuji extension installed in your Chrome or Edge browser. You can get it from the Chrome Web Store.',
        tip: 'The extension icon should appear in your browser toolbar after installation.',
      },
      {
        title: 'Open Slack in Browser',
        content: 'Navigate to <code>app.slack.com</code> and sign in to your workspace.',
        tip: 'Sokuji works with the web version of Slack. The desktop app is not supported.',
      },
      {
        title: 'Start a Huddle',
        content: 'Click on the headphones icon in a channel or direct message to start a Slack Huddle.',
        tip: 'You can also join an existing Huddle that others have started.',
      },
      {
        title: 'Configure Audio Settings',
        content: 'In the Huddle controls, click on the settings gear icon. Under Microphone, select <strong>Sokuji Virtual Microphone</strong> from the dropdown.',
        tip: 'If the virtual microphone doesn\'t appear, refresh the page and ensure the Sokuji extension is active.',
      },
      {
        title: 'Start Speaking',
        content: 'Your speech will now be translated in real-time. Speak naturally and others in the Huddle will hear the translated audio.',
        tip: 'Speak at a natural pace for optimal translation quality.',
      },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Use a good quality headset for clear audio',
        'Ensure stable internet connection for seamless translation',
        'Test your setup before important Huddles',
        'Keep sentences concise for more accurate translations',
      ],
    },
    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          question: 'Does Sokuji work with the Slack desktop app?',
          answer: 'Currently, Sokuji only works with the web version of Slack accessed through supported browsers (Chrome, Edge).',
        },
        {
          question: 'Can I use Sokuji in Slack video calls?',
          answer: 'Yes, Sokuji works in Slack Huddles which can include video. It translates the audio portion of your communication.',
        },
        {
          question: 'Will Sokuji translate Slack messages?',
          answer: 'No, Sokuji only translates voice audio in Huddles. It does not translate text messages.',
        },
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: 'If you encounter any issues, please visit our <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub repository</a> or contact us at <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> for support.',
    },
  },
  zh: {
    pageTitle: '在 Slack 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content: '本指南将指导您如何在 Slack Huddles 中设置和使用 Sokuji，实现对话中的实时语言翻译。',
    },
    steps: [
      {
        title: '安装 Sokuji 扩展',
        content: '确保您已在 Chrome 或 Edge 浏览器中安装了 Sokuji 扩展。您可以从 Chrome 网上应用店获取。',
        tip: '安装后，扩展图标应出现在浏览器工具栏中。',
      },
      {
        title: '在浏览器中打开 Slack',
        content: '访问 <code>app.slack.com</code> 并登录您的工作区。',
        tip: 'Sokuji 适用于 Slack 的网页版本。不支持桌面应用。',
      },
      {
        title: '开始 Huddle',
        content: '点击频道或私信中的耳机图标以启动 Slack Huddle。',
        tip: '您也可以加入其他人已经开始的 Huddle。',
      },
      {
        title: '配置音频设置',
        content: '在 Huddle 控件中，点击设置齿轮图标。在麦克风下，从下拉菜单中选择 <strong>Sokuji Virtual Microphone</strong>。',
        tip: '如果虚拟麦克风没有出现，请刷新页面并确保 Sokuji 扩展处于活动状态。',
      },
      {
        title: '开始说话',
        content: '您的语音现在将被实时翻译。自然地说话，Huddle 中的其他人将听到翻译后的音频。',
        tip: '以自然的速度说话以获得最佳翻译质量。',
      },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '使用高质量耳机以获得清晰的音频',
        '确保稳定的网络连接以实现无缝翻译',
        '在重要的 Huddle 之前测试您的设置',
        '保持句子简洁以获得更准确的翻译',
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        {
          question: 'Sokuji 是否适用于 Slack 桌面应用？',
          answer: '目前，Sokuji 仅适用于通过支持的浏览器（Chrome、Edge）访问的 Slack 网页版。',
        },
        {
          question: '我可以在 Slack 视频通话中使用 Sokuji 吗？',
          answer: '是的，Sokuji 可以在包含视频的 Slack Huddles 中使用。它翻译您通信的音频部分。',
        },
        {
          question: 'Sokuji 会翻译 Slack 消息吗？',
          answer: '不会，Sokuji 只翻译 Huddles 中的语音音频。它不会翻译文字消息。',
        },
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content: '如果遇到任何问题，请访问我们的 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 仓库</a> 或发送邮件至 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> 获取支持。',
    },
  },
  ja: {
    pageTitle: 'Slack で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content: 'このガイドでは、Slack Huddles で Sokuji を設定して使用し、会話中にリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Sokuji 拡張機能をインストール',
        content: 'Chrome または Edge ブラウザに Sokuji 拡張機能がインストールされていることを確認してください。Chrome ウェブストアから入手できます。',
        tip: 'インストール後、拡張機能のアイコンがブラウザのツールバーに表示されます。',
      },
      {
        title: 'ブラウザで Slack を開く',
        content: '<code>app.slack.com</code> にアクセスし、ワークスペースにサインインします。',
        tip: 'Sokuji は Slack の Web バージョンで動作します。デスクトップアプリはサポートされていません。',
      },
      {
        title: 'Huddle を開始',
        content: 'チャンネルまたはダイレクトメッセージのヘッドフォンアイコンをクリックして Slack Huddle を開始します。',
        tip: '他の人が開始した既存の Huddle に参加することもできます。',
      },
      {
        title: 'オーディオ設定を構成',
        content: 'Huddle コントロールで、設定の歯車アイコンをクリックします。マイクの下で、ドロップダウンから <strong>Sokuji Virtual Microphone</strong> を選択します。',
        tip: '仮想マイクが表示されない場合は、ページを更新し、Sokuji 拡張機能がアクティブであることを確認してください。',
      },
      {
        title: '話し始める',
        content: '音声がリアルタイムで翻訳されるようになります。自然に話すと、Huddle の他の人は翻訳された音声を聞くことができます。',
        tip: '最適な翻訳品質のために自然なペースで話してください。',
      },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        'クリアなオーディオのために高品質のヘッドセットを使用する',
        'シームレスな翻訳のために安定したインターネット接続を確保する',
        '重要な Huddle の前に設定をテストする',
        'より正確な翻訳のために文を簡潔に保つ',
      ],
    },
    faq: {
      title: 'よくある質問',
      items: [
        {
          question: 'Sokuji は Slack デスクトップアプリで動作しますか？',
          answer: '現在、Sokuji はサポートされているブラウザ（Chrome、Edge）でアクセスする Slack の Web バージョンでのみ動作します。',
        },
        {
          question: 'Slack ビデオ通話で Sokuji を使用できますか？',
          answer: 'はい、Sokuji はビデオを含む Slack Huddles で動作します。コミュニケーションのオーディオ部分を翻訳します。',
        },
        {
          question: 'Sokuji は Slack メッセージを翻訳しますか？',
          answer: 'いいえ、Sokuji は Huddles の音声オーディオのみを翻訳します。テキストメッセージは翻訳しません。',
        },
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content: '問題が発生した場合は、<a href="https://github.com/kizuna-ai-lab/sokuji">GitHub リポジトリ</a>を訪問するか、<a href="mailto:support@kizuna.ai">support@kizuna.ai</a> までメールでお問い合わせください。',
    },
  },
  ko: {
    pageTitle: 'Slack에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content: '이 가이드는 Slack Huddles에서 Sokuji를 설정하고 사용하여 대화 중 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Sokuji 확장 프로그램 설치',
        content: 'Chrome 또는 Edge 브라우저에 Sokuji 확장 프로그램이 설치되어 있는지 확인하세요. Chrome 웹 스토어에서 받을 수 있습니다.',
        tip: '설치 후 확장 프로그램 아이콘이 브라우저 도구 모음에 나타납니다.',
      },
      {
        title: '브라우저에서 Slack 열기',
        content: '<code>app.slack.com</code>으로 이동하여 워크스페이스에 로그인하세요.',
        tip: 'Sokuji는 Slack의 웹 버전에서 작동합니다. 데스크톱 앱은 지원되지 않습니다.',
      },
      {
        title: 'Huddle 시작',
        content: '채널이나 다이렉트 메시지에서 헤드폰 아이콘을 클릭하여 Slack Huddle을 시작하세요.',
        tip: '다른 사람이 시작한 기존 Huddle에 참여할 수도 있습니다.',
      },
      {
        title: '오디오 설정 구성',
        content: 'Huddle 컨트롤에서 설정 톱니바퀴 아이콘을 클릭하세요. 마이크에서 드롭다운에서 <strong>Sokuji Virtual Microphone</strong>을 선택하세요.',
        tip: '가상 마이크가 나타나지 않으면 페이지를 새로 고치고 Sokuji 확장 프로그램이 활성화되어 있는지 확인하세요.',
      },
      {
        title: '말하기 시작',
        content: '이제 음성이 실시간으로 번역됩니다. 자연스럽게 말하면 Huddle의 다른 사람들이 번역된 오디오를 듣게 됩니다.',
        tip: '최적의 번역 품질을 위해 자연스러운 속도로 말하세요.',
      },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '깨끗한 오디오를 위해 고품질 헤드셋 사용',
        '원활한 번역을 위해 안정적인 인터넷 연결 확보',
        '중요한 Huddle 전에 설정 테스트',
        '더 정확한 번역을 위해 문장을 간결하게 유지',
      ],
    },
    faq: {
      title: '자주 묻는 질문',
      items: [
        {
          question: 'Sokuji가 Slack 데스크톱 앱에서 작동하나요?',
          answer: '현재 Sokuji는 지원되는 브라우저(Chrome, Edge)를 통해 액세스하는 Slack 웹 버전에서만 작동합니다.',
        },
        {
          question: 'Slack 비디오 통화에서 Sokuji를 사용할 수 있나요?',
          answer: '네, Sokuji는 비디오를 포함한 Slack Huddles에서 작동합니다. 통신의 오디오 부분을 번역합니다.',
        },
        {
          question: 'Sokuji가 Slack 메시지를 번역하나요?',
          answer: '아니요, Sokuji는 Huddles의 음성 오디오만 번역합니다. 텍스트 메시지는 번역하지 않습니다.',
        },
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content: '문제가 발생하면 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 저장소</a>를 방문하거나 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a>로 이메일을 보내 지원을 받으세요.',
    },
  },
};

export function SlackTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/slack" />;
}
