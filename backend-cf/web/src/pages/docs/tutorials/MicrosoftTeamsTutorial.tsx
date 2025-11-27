/**
 * Microsoft Teams Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Microsoft Teams',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content:
        'This guide will walk you through setting up and using Sokuji with Microsoft Teams (Web version) for real-time language translation during your meetings.',
    },
    steps: [
      {
        title: 'Install Sokuji Extension',
        content:
          'Make sure you have the Sokuji extension installed in your Chrome or Edge browser. You can get it from the Chrome Web Store.',
        tip: 'The extension icon should appear in your browser toolbar after installation.',
      },
      {
        title: 'Open Microsoft Teams Web',
        content:
          'Navigate to <code>teams.live.com</code> or <code>teams.microsoft.com</code> and sign in with your Microsoft account.',
        tip: 'Sokuji works with the web version of Teams. The desktop app is not supported.',
      },
      {
        title: 'Join or Start a Meeting',
        content:
          "Join an existing meeting or start a new one. Before joining, you'll see the pre-join screen where you can configure your devices.",
        tip: 'You can also change audio settings during the meeting.',
      },
      {
        title: 'Configure Device Settings',
        content:
          'On the pre-join screen or during the meeting, click on the Device settings (gear icon). In the Microphone dropdown, select <strong>Sokuji Virtual Microphone</strong>.',
        tip: "If the virtual microphone doesn't appear, refresh the page and ensure the Sokuji extension is active.",
      },
      {
        title: 'Enable Translation',
        content:
          "Once you've selected the Sokuji Virtual Microphone, join the meeting. Your speech will now be translated in real-time as you speak.",
        tip: 'Speak at a natural pace and enunciate clearly for optimal translation quality.',
      },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Use a good quality headset to minimize echo and background noise',
        'Ensure stable internet connection for seamless translation',
        'Test your setup before important meetings',
        'Keep sentences concise for more accurate translations',
      ],
    },
    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          question: 'Does Sokuji work with the Teams desktop app?',
          answer:
            'Currently, Sokuji only works with the web version of Microsoft Teams accessed through supported browsers (Chrome, Edge).',
        },
        {
          question: 'Can I use Sokuji in Teams channels or only in meetings?',
          answer:
            "Sokuji works in Teams meetings and calls. It doesn't translate text messages in channels or chats.",
        },
        {
          question: "What if I can't see the Device settings option?",
          answer:
            "Make sure you're using the web version of Teams and have granted microphone permissions to your browser. Try joining from the meeting link directly rather than through the Teams app.",
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
    pageTitle: '在 Microsoft Teams 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content:
        '本指南将指导您如何在 Microsoft Teams（网页版）中设置和使用 Sokuji，实现会议中的实时语言翻译。',
    },
    steps: [
      {
        title: '安装 Sokuji 扩展',
        content:
          '确保您已在 Chrome 或 Edge 浏览器中安装了 Sokuji 扩展。您可以从 Chrome 网上应用店获取。',
        tip: '安装后，扩展图标应出现在浏览器工具栏中。',
      },
      {
        title: '打开 Microsoft Teams 网页版',
        content:
          '访问 <code>teams.live.com</code> 或 <code>teams.microsoft.com</code> 并使用您的 Microsoft 账号登录。',
        tip: 'Sokuji 适用于 Teams 的网页版本。不支持桌面应用。',
      },
      {
        title: '加入或开始会议',
        content: '加入现有会议或开始新会议。在加入之前，您会看到预加入屏幕，可以在此配置您的设备。',
        tip: '您也可以在会议期间更改音频设置。',
      },
      {
        title: '配置设备设置',
        content:
          '在预加入屏幕或会议期间，点击设备设置（齿轮图标）。在麦克风下拉菜单中，选择 <strong>Sokuji Virtual Microphone</strong>。',
        tip: '如果虚拟麦克风没有出现，请刷新页面并确保 Sokuji 扩展处于活动状态。',
      },
      {
        title: '启用翻译',
        content: '选择 Sokuji 虚拟麦克风后，加入会议。现在您说话时，您的语音将被实时翻译。',
        tip: '以自然的速度说话并清晰发音，以获得最佳翻译质量。',
      },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '使用高质量耳机以减少回声和背景噪音',
        '确保稳定的网络连接以实现无缝翻译',
        '在重要会议前测试您的设置',
        '保持句子简洁以获得更准确的翻译',
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        {
          question: 'Sokuji 是否适用于 Teams 桌面应用？',
          answer:
            '目前，Sokuji 仅适用于通过支持的浏览器（Chrome、Edge）访问的 Microsoft Teams 网页版。',
        },
        {
          question: '我可以在 Teams 频道中使用 Sokuji 还是仅在会议中？',
          answer: 'Sokuji 在 Teams 会议和通话中工作。它不会翻译频道或聊天中的文本消息。',
        },
        {
          question: '如果看不到设备设置选项怎么办？',
          answer:
            '确保您使用的是 Teams 的网页版本，并已授予浏览器麦克风权限。尝试直接从会议链接加入，而不是通过 Teams 应用。',
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
    pageTitle: 'Microsoft Teams で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content:
        'このガイドでは、Microsoft Teams（Web版）で Sokuji を設定して使用し、会議中にリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Sokuji 拡張機能をインストール',
        content:
          'Chrome または Edge ブラウザに Sokuji 拡張機能がインストールされていることを確認してください。Chrome ウェブストアから入手できます。',
        tip: 'インストール後、拡張機能のアイコンがブラウザのツールバーに表示されます。',
      },
      {
        title: 'Microsoft Teams Web を開く',
        content:
          '<code>teams.live.com</code> または <code>teams.microsoft.com</code> にアクセスし、Microsoft アカウントでサインインします。',
        tip: 'Sokuji は Teams の Web バージョンで動作します。デスクトップアプリはサポートされていません。',
      },
      {
        title: '会議に参加または開始',
        content:
          '既存の会議に参加するか、新しい会議を開始します。参加前に、デバイスを設定できる参加前画面が表示されます。',
        tip: '会議中にオーディオ設定を変更することもできます。',
      },
      {
        title: 'デバイス設定を構成',
        content:
          '参加前画面または会議中に、デバイス設定（歯車アイコン）をクリックします。マイクのドロップダウンで <strong>Sokuji Virtual Microphone</strong> を選択します。',
        tip: '仮想マイクが表示されない場合は、ページを更新し、Sokuji 拡張機能がアクティブであることを確認してください。',
      },
      {
        title: '翻訳を有効にする',
        content:
          'Sokuji 仮想マイクを選択したら、会議に参加します。話すと音声がリアルタイムで翻訳されるようになります。',
        tip: '最適な翻訳品質を得るために、自然なペースで話し、はっきりと発音してください。',
      },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        'エコーと背景ノイズを最小限に抑えるために高品質のヘッドセットを使用する',
        'シームレスな翻訳のために安定したインターネット接続を確保する',
        '重要な会議の前に設定をテストする',
        'より正確な翻訳のために文を簡潔に保つ',
      ],
    },
    faq: {
      title: 'よくある質問',
      items: [
        {
          question: 'Sokuji は Teams デスクトップアプリで動作しますか？',
          answer:
            '現在、Sokuji はサポートされているブラウザ（Chrome、Edge）でアクセスする Microsoft Teams の Web バージョンでのみ動作します。',
        },
        {
          question: 'Teams チャンネルで Sokuji を使用できますか、それとも会議でのみ使用できますか？',
          answer:
            'Sokuji は Teams の会議と通話で動作します。チャンネルやチャットのテキストメッセージは翻訳しません。',
        },
        {
          question: 'デバイス設定オプションが表示されない場合はどうすればよいですか？',
          answer:
            'Teams の Web バージョンを使用していることを確認し、ブラウザにマイクの権限を付与したことを確認してください。Teams アプリ経由ではなく、会議リンクから直接参加してみてください。',
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
    pageTitle: 'Microsoft Teams에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content:
        '이 가이드는 Microsoft Teams(웹 버전)에서 Sokuji를 설정하고 사용하여 회의 중 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Sokuji 확장 프로그램 설치',
        content:
          'Chrome 또는 Edge 브라우저에 Sokuji 확장 프로그램이 설치되어 있는지 확인하세요. Chrome 웹 스토어에서 받을 수 있습니다.',
        tip: '설치 후 확장 프로그램 아이콘이 브라우저 도구 모음에 나타납니다.',
      },
      {
        title: 'Microsoft Teams 웹 열기',
        content:
          '<code>teams.live.com</code> 또는 <code>teams.microsoft.com</code>으로 이동하여 Microsoft 계정으로 로그인하세요.',
        tip: 'Sokuji는 Teams의 웹 버전에서 작동합니다. 데스크톱 앱은 지원되지 않습니다.',
      },
      {
        title: '회의 참여 또는 시작',
        content:
          '기존 회의에 참여하거나 새 회의를 시작하세요. 참여하기 전에 장치를 구성할 수 있는 사전 참여 화면이 표시됩니다.',
        tip: '회의 중에도 오디오 설정을 변경할 수 있습니다.',
      },
      {
        title: '장치 설정 구성',
        content:
          '사전 참여 화면이나 회의 중에 장치 설정(톱니바퀴 아이콘)을 클릭하세요. 마이크 드롭다운에서 <strong>Sokuji Virtual Microphone</strong>을 선택하세요.',
        tip: '가상 마이크가 나타나지 않으면 페이지를 새로 고치고 Sokuji 확장 프로그램이 활성화되어 있는지 확인하세요.',
      },
      {
        title: '번역 활성화',
        content:
          'Sokuji 가상 마이크를 선택한 후 회의에 참여하세요. 이제 말할 때 음성이 실시간으로 번역됩니다.',
        tip: '최적의 번역 품질을 위해 자연스러운 속도로 말하고 명확하게 발음하세요.',
      },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '에코와 배경 소음을 최소화하기 위해 고품질 헤드셋 사용',
        '원활한 번역을 위해 안정적인 인터넷 연결 확보',
        '중요한 회의 전에 설정 테스트',
        '더 정확한 번역을 위해 문장을 간결하게 유지',
      ],
    },
    faq: {
      title: '자주 묻는 질문',
      items: [
        {
          question: 'Sokuji가 Teams 데스크톱 앱에서 작동하나요?',
          answer:
            '현재 Sokuji는 지원되는 브라우저(Chrome, Edge)를 통해 액세스하는 Microsoft Teams 웹 버전에서만 작동합니다.',
        },
        {
          question: 'Teams 채널에서 Sokuji를 사용할 수 있나요, 아니면 회의에서만 사용할 수 있나요?',
          answer:
            'Sokuji는 Teams 회의와 통화에서 작동합니다. 채널이나 채팅의 텍스트 메시지는 번역하지 않습니다.',
        },
        {
          question: '장치 설정 옵션이 보이지 않으면 어떻게 하나요?',
          answer:
            'Teams 웹 버전을 사용하고 있는지 확인하고 브라우저에 마이크 권한을 부여했는지 확인하세요. Teams 앱을 통해서가 아니라 회의 링크에서 직접 참여해 보세요.',
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

export function MicrosoftTeamsTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/microsoft-teams" />;
}
