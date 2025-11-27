/**
 * Discord Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Discord',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content: 'This guide will walk you through setting up and using Sokuji with Discord (Web version) for real-time language translation during your voice calls.',
    },
    steps: [
      {
        title: 'Install Sokuji Extension',
        content: 'Make sure you have the Sokuji extension installed in your Chrome or Edge browser. You can get it from the Chrome Web Store.',
        tip: 'The extension icon should appear in your browser toolbar after installation.',
      },
      {
        title: 'Open Discord Web',
        content: 'Navigate to <code>discord.com/app</code> or <code>discord.com/channels</code> and sign in with your Discord account.',
        tip: 'Sokuji works with the web version of Discord. The desktop app is not supported.',
      },
      {
        title: 'Join a Voice Channel',
        content: 'Join a voice channel or start a voice call with friends as you normally would.',
        tip: 'You can also use Sokuji in private calls and group DMs.',
      },
      {
        title: 'Configure Voice Settings',
        content: 'Click on the gear icon next to your username at the bottom to open User Settings. Go to Voice & Video settings, and under Input Device, select <strong>Sokuji Virtual Microphone</strong>.',
        tip: 'If the virtual microphone doesn\'t appear, refresh the page and ensure the Sokuji extension is active.',
      },
      {
        title: 'Start Speaking',
        content: 'Return to your voice channel. Your speech will now be translated in real-time as you speak.',
        tip: 'Speak at a natural pace for optimal translation quality.',
      },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Use Push to Talk if there\'s background noise in your environment',
        'Ensure stable internet connection for seamless translation',
        'Test your setup in a private channel before important calls',
        'Keep sentences concise for more accurate translations',
      ],
    },
    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          question: 'Does Sokuji work with the Discord desktop app?',
          answer: 'Currently, Sokuji only works with the web version of Discord accessed through supported browsers (Chrome, Edge).',
        },
        {
          question: 'Can I use Sokuji in Discord Stage channels?',
          answer: 'Yes, Sokuji works in Stage channels, voice channels, and private calls.',
        },
        {
          question: 'Will Sokuji translate text messages?',
          answer: 'No, Sokuji only translates voice audio. It does not translate text messages in chat.',
        },
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: 'If you encounter any issues, please visit our <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub repository</a> or contact us at <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> for support.',
    },
  },
  zh: {
    pageTitle: '在 Discord 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content: '本指南将指导您如何在 Discord（网页版）中设置和使用 Sokuji，实现语音通话中的实时语言翻译。',
    },
    steps: [
      {
        title: '安装 Sokuji 扩展',
        content: '确保您已在 Chrome 或 Edge 浏览器中安装了 Sokuji 扩展。您可以从 Chrome 网上应用店获取。',
        tip: '安装后，扩展图标应出现在浏览器工具栏中。',
      },
      {
        title: '打开 Discord 网页版',
        content: '访问 <code>discord.com/app</code> 或 <code>discord.com/channels</code> 并使用您的 Discord 账号登录。',
        tip: 'Sokuji 适用于 Discord 的网页版本。不支持桌面应用。',
      },
      {
        title: '加入语音频道',
        content: '像往常一样加入语音频道或与朋友开始语音通话。',
        tip: '您也可以在私人通话和群组私信中使用 Sokuji。',
      },
      {
        title: '配置语音设置',
        content: '点击底部用户名旁边的齿轮图标打开用户设置。进入语音和视频设置，在输入设备下选择 <strong>Sokuji Virtual Microphone</strong>。',
        tip: '如果虚拟麦克风没有出现，请刷新页面并确保 Sokuji 扩展处于活动状态。',
      },
      {
        title: '开始说话',
        content: '返回您的语音频道。现在您说话时，您的语音将被实时翻译。',
        tip: '以自然的速度说话以获得最佳翻译质量。',
      },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '如果环境中有背景噪音，请使用按键说话功能',
        '确保稳定的网络连接以实现无缝翻译',
        '在重要通话前在私人频道中测试您的设置',
        '保持句子简洁以获得更准确的翻译',
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        {
          question: 'Sokuji 是否适用于 Discord 桌面应用？',
          answer: '目前，Sokuji 仅适用于通过支持的浏览器（Chrome、Edge）访问的 Discord 网页版。',
        },
        {
          question: '我可以在 Discord 舞台频道中使用 Sokuji 吗？',
          answer: '是的，Sokuji 可以在舞台频道、语音频道和私人通话中使用。',
        },
        {
          question: 'Sokuji 会翻译文字消息吗？',
          answer: '不会，Sokuji 只翻译语音音频。它不会翻译聊天中的文字消息。',
        },
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content: '如果遇到任何问题，请访问我们的 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 仓库</a> 或发送邮件至 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> 获取支持。',
    },
  },
  ja: {
    pageTitle: 'Discord で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content: 'このガイドでは、Discord（Web版）で Sokuji を設定して使用し、ボイスチャット中にリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Sokuji 拡張機能をインストール',
        content: 'Chrome または Edge ブラウザに Sokuji 拡張機能がインストールされていることを確認してください。Chrome ウェブストアから入手できます。',
        tip: 'インストール後、拡張機能のアイコンがブラウザのツールバーに表示されます。',
      },
      {
        title: 'Discord Web を開く',
        content: '<code>discord.com/app</code> または <code>discord.com/channels</code> にアクセスし、Discord アカウントでサインインします。',
        tip: 'Sokuji は Discord の Web バージョンで動作します。デスクトップアプリはサポートされていません。',
      },
      {
        title: 'ボイスチャンネルに参加',
        content: '通常どおりボイスチャンネルに参加するか、友達とボイス通話を開始します。',
        tip: 'プライベート通話やグループDMでも Sokuji を使用できます。',
      },
      {
        title: 'ボイス設定を構成',
        content: '下部のユーザー名の横にある歯車アイコンをクリックしてユーザー設定を開きます。音声・ビデオ設定に移動し、入力デバイスで <strong>Sokuji Virtual Microphone</strong> を選択します。',
        tip: '仮想マイクが表示されない場合は、ページを更新し、Sokuji 拡張機能がアクティブであることを確認してください。',
      },
      {
        title: '話し始める',
        content: 'ボイスチャンネルに戻ります。話すと音声がリアルタイムで翻訳されるようになります。',
        tip: '最適な翻訳品質のために自然なペースで話してください。',
      },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        '環境に背景ノイズがある場合はプッシュトゥトークを使用する',
        'シームレスな翻訳のために安定したインターネット接続を確保する',
        '重要な通話の前にプライベートチャンネルで設定をテストする',
        'より正確な翻訳のために文を簡潔に保つ',
      ],
    },
    faq: {
      title: 'よくある質問',
      items: [
        {
          question: 'Sokuji は Discord デスクトップアプリで動作しますか？',
          answer: '現在、Sokuji はサポートされているブラウザ（Chrome、Edge）でアクセスする Discord の Web バージョンでのみ動作します。',
        },
        {
          question: 'Discord ステージチャンネルで Sokuji を使用できますか？',
          answer: 'はい、Sokuji はステージチャンネル、ボイスチャンネル、プライベート通話で動作します。',
        },
        {
          question: 'Sokuji はテキストメッセージを翻訳しますか？',
          answer: 'いいえ、Sokuji は音声オーディオのみを翻訳します。チャットのテキストメッセージは翻訳しません。',
        },
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content: '問題が発生した場合は、<a href="https://github.com/kizuna-ai-lab/sokuji">GitHub リポジトリ</a>を訪問するか、<a href="mailto:support@kizuna.ai">support@kizuna.ai</a> までメールでお問い合わせください。',
    },
  },
  ko: {
    pageTitle: 'Discord에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content: '이 가이드는 Discord(웹 버전)에서 Sokuji를 설정하고 사용하여 음성 통화 중 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Sokuji 확장 프로그램 설치',
        content: 'Chrome 또는 Edge 브라우저에 Sokuji 확장 프로그램이 설치되어 있는지 확인하세요. Chrome 웹 스토어에서 받을 수 있습니다.',
        tip: '설치 후 확장 프로그램 아이콘이 브라우저 도구 모음에 나타납니다.',
      },
      {
        title: 'Discord 웹 열기',
        content: '<code>discord.com/app</code> 또는 <code>discord.com/channels</code>로 이동하여 Discord 계정으로 로그인하세요.',
        tip: 'Sokuji는 Discord의 웹 버전에서 작동합니다. 데스크톱 앱은 지원되지 않습니다.',
      },
      {
        title: '음성 채널 참여',
        content: '평소처럼 음성 채널에 참여하거나 친구와 음성 통화를 시작하세요.',
        tip: '개인 통화와 그룹 DM에서도 Sokuji를 사용할 수 있습니다.',
      },
      {
        title: '음성 설정 구성',
        content: '하단의 사용자 이름 옆 톱니바퀴 아이콘을 클릭하여 사용자 설정을 엽니다. 음성 및 비디오 설정으로 이동하여 입력 장치에서 <strong>Sokuji Virtual Microphone</strong>을 선택하세요.',
        tip: '가상 마이크가 나타나지 않으면 페이지를 새로 고치고 Sokuji 확장 프로그램이 활성화되어 있는지 확인하세요.',
      },
      {
        title: '말하기 시작',
        content: '음성 채널로 돌아갑니다. 이제 말할 때 음성이 실시간으로 번역됩니다.',
        tip: '최적의 번역 품질을 위해 자연스러운 속도로 말하세요.',
      },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '환경에 배경 소음이 있는 경우 푸시 투 토크 사용',
        '원활한 번역을 위해 안정적인 인터넷 연결 확보',
        '중요한 통화 전에 비공개 채널에서 설정 테스트',
        '더 정확한 번역을 위해 문장을 간결하게 유지',
      ],
    },
    faq: {
      title: '자주 묻는 질문',
      items: [
        {
          question: 'Sokuji가 Discord 데스크톱 앱에서 작동하나요?',
          answer: '현재 Sokuji는 지원되는 브라우저(Chrome, Edge)를 통해 액세스하는 Discord 웹 버전에서만 작동합니다.',
        },
        {
          question: 'Discord 스테이지 채널에서 Sokuji를 사용할 수 있나요?',
          answer: '네, Sokuji는 스테이지 채널, 음성 채널, 개인 통화에서 작동합니다.',
        },
        {
          question: 'Sokuji가 텍스트 메시지를 번역하나요?',
          answer: '아니요, Sokuji는 음성 오디오만 번역합니다. 채팅의 텍스트 메시지는 번역하지 않습니다.',
        },
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content: '문제가 발생하면 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 저장소</a>를 방문하거나 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a>로 이메일을 보내 지원을 받으세요.',
    },
  },
};

export function DiscordTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/discord" />;
}
