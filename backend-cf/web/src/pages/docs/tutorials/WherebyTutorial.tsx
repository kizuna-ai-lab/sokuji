/**
 * Whereby Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Whereby',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content: 'This guide will walk you through setting up and using Sokuji with Whereby for real-time language translation during your video meetings.',
    },
    steps: [
      {
        title: 'Install Sokuji Extension',
        content: 'Make sure you have the Sokuji extension installed in your Chrome or Edge browser. You can get it from the Chrome Web Store.',
        tip: 'The extension icon should appear in your browser toolbar after installation.',
      },
      {
        title: 'Open Whereby',
        content: 'Navigate to your Whereby room URL (e.g., <code>whereby.com/your-room</code>) in your browser.',
        tip: 'Whereby works entirely in the browser, making it perfect for use with Sokuji.',
      },
      {
        title: 'Join the Room',
        content: 'Enter your name and click Join to enter the Whereby room. You may be asked to allow camera and microphone access.',
        tip: 'Allow the browser to access your microphone when prompted.',
      },
      {
        title: 'Configure Audio Settings',
        content: 'In the meeting controls, click on Settings (gear icon). Under Microphone, select <strong>Sokuji Virtual Microphone</strong> from the dropdown.',
        tip: 'If the virtual microphone doesn\'t appear, refresh the page and ensure the Sokuji extension is active.',
      },
      {
        title: 'Start Speaking',
        content: 'Your speech will now be translated in real-time. Speak naturally and others in the room will hear the translated audio.',
        tip: 'Speak at a natural pace for optimal translation quality.',
      },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Use a good quality microphone for clear audio',
        'Ensure stable internet connection for seamless translation',
        'Test your setup before important meetings',
        'Keep sentences concise for more accurate translations',
      ],
    },
    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          question: 'Does Whereby require any special setup?',
          answer: 'No, Whereby works entirely in the browser. Simply navigate to your room URL and Sokuji will be available.',
        },
        {
          question: 'Can I use Sokuji in Whereby breakout rooms?',
          answer: 'Yes, Sokuji works in all Whereby rooms including breakout rooms.',
        },
        {
          question: 'Will Sokuji work with Whereby recordings?',
          answer: 'Yes, if you record your Whereby meeting, the translated audio will be included in the recording.',
        },
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: 'If you encounter any issues, please visit our <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub repository</a> or contact us at <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> for support.',
    },
  },
  zh: {
    pageTitle: '在 Whereby 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content: '本指南将指导您如何在 Whereby 中设置和使用 Sokuji，实现视频会议中的实时语言翻译。',
    },
    steps: [
      {
        title: '安装 Sokuji 扩展',
        content: '确保您已在 Chrome 或 Edge 浏览器中安装了 Sokuji 扩展。您可以从 Chrome 网上应用店获取。',
        tip: '安装后，扩展图标应出现在浏览器工具栏中。',
      },
      {
        title: '打开 Whereby',
        content: '在浏览器中访问您的 Whereby 房间 URL（例如 <code>whereby.com/your-room</code>）。',
        tip: 'Whereby 完全在浏览器中运行，非常适合与 Sokuji 一起使用。',
      },
      {
        title: '加入房间',
        content: '输入您的名字并点击加入以进入 Whereby 房间。可能会要求您允许摄像头和麦克风访问。',
        tip: '出现提示时允许浏览器访问您的麦克风。',
      },
      {
        title: '配置音频设置',
        content: '在会议控件中，点击设置（齿轮图标）。在麦克风下，从下拉菜单中选择 <strong>Sokuji Virtual Microphone</strong>。',
        tip: '如果虚拟麦克风没有出现，请刷新页面并确保 Sokuji 扩展处于活动状态。',
      },
      {
        title: '开始说话',
        content: '您的语音现在将被实时翻译。自然地说话，房间中的其他人将听到翻译后的音频。',
        tip: '以自然的速度说话以获得最佳翻译质量。',
      },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '使用高质量麦克风以获得清晰的音频',
        '确保稳定的网络连接以实现无缝翻译',
        '在重要会议前测试您的设置',
        '保持句子简洁以获得更准确的翻译',
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        {
          question: 'Whereby 需要特殊设置吗？',
          answer: '不需要，Whereby 完全在浏览器中运行。只需导航到您的房间 URL，Sokuji 即可使用。',
        },
        {
          question: '我可以在 Whereby 分组讨论室中使用 Sokuji 吗？',
          answer: '是的，Sokuji 可以在所有 Whereby 房间中使用，包括分组讨论室。',
        },
        {
          question: 'Sokuji 支持 Whereby 录制吗？',
          answer: '是的，如果您录制 Whereby 会议，翻译后的音频将包含在录制中。',
        },
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content: '如果遇到任何问题，请访问我们的 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 仓库</a> 或发送邮件至 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> 获取支持。',
    },
  },
  ja: {
    pageTitle: 'Whereby で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content: 'このガイドでは、Whereby で Sokuji を設定して使用し、ビデオ会議中にリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Sokuji 拡張機能をインストール',
        content: 'Chrome または Edge ブラウザに Sokuji 拡張機能がインストールされていることを確認してください。Chrome ウェブストアから入手できます。',
        tip: 'インストール後、拡張機能のアイコンがブラウザのツールバーに表示されます。',
      },
      {
        title: 'Whereby を開く',
        content: 'ブラウザで Whereby ルームの URL（例：<code>whereby.com/your-room</code>）にアクセスします。',
        tip: 'Whereby は完全にブラウザで動作するため、Sokuji との使用に最適です。',
      },
      {
        title: 'ルームに参加',
        content: '名前を入力し、参加をクリックして Whereby ルームに入室します。カメラとマイクのアクセスを許可するよう求められる場合があります。',
        tip: 'プロンプトが表示されたら、ブラウザがマイクにアクセスすることを許可してください。',
      },
      {
        title: 'オーディオ設定を構成',
        content: '会議コントロールで、設定（歯車アイコン）をクリックします。マイクの下で、ドロップダウンから <strong>Sokuji Virtual Microphone</strong> を選択します。',
        tip: '仮想マイクが表示されない場合は、ページを更新し、Sokuji 拡張機能がアクティブであることを確認してください。',
      },
      {
        title: '話し始める',
        content: '音声がリアルタイムで翻訳されるようになります。自然に話すと、ルームの他の人は翻訳された音声を聞くことができます。',
        tip: '最適な翻訳品質のために自然なペースで話してください。',
      },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        'クリアなオーディオのために高品質のマイクを使用する',
        'シームレスな翻訳のために安定したインターネット接続を確保する',
        '重要な会議の前に設定をテストする',
        'より正確な翻訳のために文を簡潔に保つ',
      ],
    },
    faq: {
      title: 'よくある質問',
      items: [
        {
          question: 'Whereby には特別なセットアップが必要ですか？',
          answer: 'いいえ、Whereby は完全にブラウザで動作します。ルーム URL にアクセスするだけで Sokuji が利用可能になります。',
        },
        {
          question: 'Whereby のブレイクアウトルームで Sokuji を使用できますか？',
          answer: 'はい、Sokuji はブレイクアウトルームを含むすべての Whereby ルームで動作します。',
        },
        {
          question: 'Sokuji は Whereby の録画で動作しますか？',
          answer: 'はい、Whereby 会議を録画すると、翻訳された音声が録画に含まれます。',
        },
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content: '問題が発生した場合は、<a href="https://github.com/kizuna-ai-lab/sokuji">GitHub リポジトリ</a>を訪問するか、<a href="mailto:support@kizuna.ai">support@kizuna.ai</a> までメールでお問い合わせください。',
    },
  },
  ko: {
    pageTitle: 'Whereby에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content: '이 가이드는 Whereby에서 Sokuji를 설정하고 사용하여 비디오 회의 중 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Sokuji 확장 프로그램 설치',
        content: 'Chrome 또는 Edge 브라우저에 Sokuji 확장 프로그램이 설치되어 있는지 확인하세요. Chrome 웹 스토어에서 받을 수 있습니다.',
        tip: '설치 후 확장 프로그램 아이콘이 브라우저 도구 모음에 나타납니다.',
      },
      {
        title: 'Whereby 열기',
        content: '브라우저에서 Whereby 룸 URL(예: <code>whereby.com/your-room</code>)로 이동하세요.',
        tip: 'Whereby는 전적으로 브라우저에서 작동하므로 Sokuji와 함께 사용하기에 완벽합니다.',
      },
      {
        title: '룸 참여',
        content: '이름을 입력하고 참여를 클릭하여 Whereby 룸에 입장하세요. 카메라와 마이크 액세스를 허용하라는 메시지가 표시될 수 있습니다.',
        tip: '메시지가 표시되면 브라우저가 마이크에 액세스하도록 허용하세요.',
      },
      {
        title: '오디오 설정 구성',
        content: '회의 컨트롤에서 설정(톱니바퀴 아이콘)을 클릭하세요. 마이크에서 드롭다운에서 <strong>Sokuji Virtual Microphone</strong>을 선택하세요.',
        tip: '가상 마이크가 나타나지 않으면 페이지를 새로 고치고 Sokuji 확장 프로그램이 활성화되어 있는지 확인하세요.',
      },
      {
        title: '말하기 시작',
        content: '이제 음성이 실시간으로 번역됩니다. 자연스럽게 말하면 룸의 다른 사람들이 번역된 오디오를 듣게 됩니다.',
        tip: '최적의 번역 품질을 위해 자연스러운 속도로 말하세요.',
      },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '깨끗한 오디오를 위해 고품질 마이크 사용',
        '원활한 번역을 위해 안정적인 인터넷 연결 확보',
        '중요한 회의 전에 설정 테스트',
        '더 정확한 번역을 위해 문장을 간결하게 유지',
      ],
    },
    faq: {
      title: '자주 묻는 질문',
      items: [
        {
          question: 'Whereby에 특별한 설정이 필요한가요?',
          answer: '아니요, Whereby는 전적으로 브라우저에서 작동합니다. 룸 URL로 이동하기만 하면 Sokuji를 사용할 수 있습니다.',
        },
        {
          question: 'Whereby 브레이크아웃 룸에서 Sokuji를 사용할 수 있나요?',
          answer: '네, Sokuji는 브레이크아웃 룸을 포함한 모든 Whereby 룸에서 작동합니다.',
        },
        {
          question: 'Sokuji가 Whereby 녹화에서 작동하나요?',
          answer: '네, Whereby 회의를 녹화하면 번역된 오디오가 녹화에 포함됩니다.',
        },
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content: '문제가 발생하면 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 저장소</a>를 방문하거나 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a>로 이메일을 보내 지원을 받으세요.',
    },
  },
};

export function WherebyTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/whereby" />;
}
