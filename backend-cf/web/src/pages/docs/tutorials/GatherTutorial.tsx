/**
 * Gather Tutorial Page
 */

import { useI18n, Locale } from '@/lib/i18n';
import { TutorialTemplate, TutorialData } from './TutorialTemplate';

const translations: Record<Locale, TutorialData> = {
  en: {
    pageTitle: 'Using Sokuji with Gather',
    backLink: 'Back to Supported Sites',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: 'Overview',
      content: 'This guide will walk you through setting up and using Sokuji with Gather (Gather.town) for real-time language translation in your virtual spaces.',
    },
    steps: [
      {
        title: 'Install Sokuji Extension',
        content: 'Make sure you have the Sokuji extension installed in your Chrome or Edge browser. You can get it from the Chrome Web Store.',
        tip: 'The extension icon should appear in your browser toolbar after installation.',
      },
      {
        title: 'Open Gather',
        content: 'Navigate to <code>gather.town</code> and enter your virtual space.',
        tip: 'Gather works entirely in the browser, making it perfect for use with Sokuji.',
      },
      {
        title: 'Join Your Space',
        content: 'Sign in and enter your Gather space. You\'ll appear as an avatar in the virtual environment.',
        tip: 'Make sure your browser has permission to use your microphone.',
      },
      {
        title: 'Configure Audio Settings',
        content: 'Click on your avatar or the settings menu in Gather. Navigate to Audio/Video settings and select <strong>Sokuji Virtual Microphone</strong> as your input device.',
        tip: 'If the virtual microphone doesn\'t appear, refresh the page and ensure the Sokuji extension is active.',
      },
      {
        title: 'Start Speaking',
        content: 'Walk your avatar close to other participants to start a conversation. Your speech will be translated in real-time as you speak.',
        tip: 'In Gather, you can only hear and speak with people who are nearby your avatar.',
      },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Use headphones to prevent audio feedback in the virtual space',
        'Ensure stable internet connection for seamless translation',
        'Test your setup in a quiet area of your Gather space first',
        'Keep sentences concise for more accurate translations',
      ],
    },
    faq: {
      title: 'Frequently Asked Questions',
      items: [
        {
          question: 'Does Sokuji work in Gather private areas?',
          answer: 'Yes, Sokuji works in all Gather areas including private spaces, meeting rooms, and open areas.',
        },
        {
          question: 'Can I use Sokuji in Gather presentations?',
          answer: 'Yes, Sokuji works during Gather presentations and broadcasts where your audio is shared with participants.',
        },
        {
          question: 'Will others hear both my original voice and translation?',
          answer: 'By default, participants only hear the translated audio. You can enable Original Audio Passthrough in Sokuji settings if you want both.',
        },
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: 'If you encounter any issues, please visit our <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub repository</a> or contact us at <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> for support.',
    },
  },
  zh: {
    pageTitle: '在 Gather 中使用 Sokuji',
    backLink: '返回支持的网站',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概述',
      content: '本指南将指导您如何在 Gather (Gather.town) 中设置和使用 Sokuji，实现虚拟空间中的实时语言翻译。',
    },
    steps: [
      {
        title: '安装 Sokuji 扩展',
        content: '确保您已在 Chrome 或 Edge 浏览器中安装了 Sokuji 扩展。您可以从 Chrome 网上应用店获取。',
        tip: '安装后，扩展图标应出现在浏览器工具栏中。',
      },
      {
        title: '打开 Gather',
        content: '访问 <code>gather.town</code> 并进入您的虚拟空间。',
        tip: 'Gather 完全在浏览器中运行，非常适合与 Sokuji 一起使用。',
      },
      {
        title: '加入空间',
        content: '登录并进入您的 Gather 空间。您将以虚拟形象出现在虚拟环境中。',
        tip: '确保您的浏览器有权限使用您的麦克风。',
      },
      {
        title: '配置音频设置',
        content: '点击您的虚拟形象或 Gather 中的设置菜单。导航到音频/视频设置，并选择 <strong>Sokuji Virtual Microphone</strong> 作为您的输入设备。',
        tip: '如果虚拟麦克风没有出现，请刷新页面并确保 Sokuji 扩展处于活动状态。',
      },
      {
        title: '开始说话',
        content: '将您的虚拟形象走近其他参与者以开始对话。您的语音将在您说话时被实时翻译。',
        tip: '在 Gather 中，您只能与靠近您虚拟形象的人听到和说话。',
      },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '使用耳机以防止虚拟空间中的音频反馈',
        '确保稳定的网络连接以实现无缝翻译',
        '首先在 Gather 空间的安静区域测试您的设置',
        '保持句子简洁以获得更准确的翻译',
      ],
    },
    faq: {
      title: '常见问题',
      items: [
        {
          question: 'Sokuji 在 Gather 私人区域中有效吗？',
          answer: '是的，Sokuji 在所有 Gather 区域中都有效，包括私人空间、会议室和开放区域。',
        },
        {
          question: '我可以在 Gather 演示中使用 Sokuji 吗？',
          answer: '是的，Sokuji 在 Gather 演示和广播期间有效，您的音频与参与者共享。',
        },
        {
          question: '其他人会同时听到我的原声和翻译吗？',
          answer: '默认情况下，参与者只能听到翻译后的音频。如果您想要两者都有，可以在 Sokuji 设置中启用原声音频透传。',
        },
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content: '如果遇到任何问题，请访问我们的 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 仓库</a> 或发送邮件至 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a> 获取支持。',
    },
  },
  ja: {
    pageTitle: 'Gather で Sokuji を使用する',
    backLink: 'サポートされているサイトに戻る',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '概要',
      content: 'このガイドでは、Gather (Gather.town) で Sokuji を設定して使用し、バーチャルスペースでリアルタイム言語翻訳を行う方法を説明します。',
    },
    steps: [
      {
        title: 'Sokuji 拡張機能をインストール',
        content: 'Chrome または Edge ブラウザに Sokuji 拡張機能がインストールされていることを確認してください。Chrome ウェブストアから入手できます。',
        tip: 'インストール後、拡張機能のアイコンがブラウザのツールバーに表示されます。',
      },
      {
        title: 'Gather を開く',
        content: '<code>gather.town</code> にアクセスし、バーチャルスペースに入ります。',
        tip: 'Gather は完全にブラウザで動作するため、Sokuji との使用に最適です。',
      },
      {
        title: 'スペースに参加',
        content: 'サインインして Gather スペースに入ります。バーチャル環境でアバターとして表示されます。',
        tip: 'ブラウザがマイクを使用する権限を持っていることを確認してください。',
      },
      {
        title: 'オーディオ設定を構成',
        content: 'Gather でアバターまたは設定メニューをクリックします。オーディオ/ビデオ設定に移動し、入力デバイスとして <strong>Sokuji Virtual Microphone</strong> を選択します。',
        tip: '仮想マイクが表示されない場合は、ページを更新し、Sokuji 拡張機能がアクティブであることを確認してください。',
      },
      {
        title: '話し始める',
        content: '他の参加者の近くにアバターを歩かせて会話を開始します。話すと音声がリアルタイムで翻訳されます。',
        tip: 'Gather では、アバターの近くにいる人とのみ聞いたり話したりできます。',
      },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        'バーチャルスペースでのオーディオフィードバックを防ぐためにヘッドフォンを使用する',
        'シームレスな翻訳のために安定したインターネット接続を確保する',
        '最初に Gather スペースの静かなエリアで設定をテストする',
        'より正確な翻訳のために文を簡潔に保つ',
      ],
    },
    faq: {
      title: 'よくある質問',
      items: [
        {
          question: 'Sokuji は Gather のプライベートエリアで動作しますか？',
          answer: 'はい、Sokuji はプライベートスペース、会議室、オープンエリアを含むすべての Gather エリアで動作します。',
        },
        {
          question: 'Gather のプレゼンテーションで Sokuji を使用できますか？',
          answer: 'はい、Sokuji は参加者と音声が共有される Gather のプレゼンテーションやブロードキャスト中に動作します。',
        },
        {
          question: '他の人は私の元の声と翻訳の両方を聞きますか？',
          answer: 'デフォルトでは、参加者は翻訳された音声のみを聞きます。両方を聞かせたい場合は、Sokuji 設定でオリジナル音声パススルーを有効にできます。',
        },
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content: '問題が発生した場合は、<a href="https://github.com/kizuna-ai-lab/sokuji">GitHub リポジトリ</a>を訪問するか、<a href="mailto:support@kizuna.ai">support@kizuna.ai</a> までメールでお問い合わせください。',
    },
  },
  ko: {
    pageTitle: 'Gather에서 Sokuji 사용하기',
    backLink: '지원 사이트로 돌아가기',
    backLinkUrl: '/docs/supported-sites',
    overview: {
      title: '개요',
      content: '이 가이드는 Gather (Gather.town)에서 Sokuji를 설정하고 사용하여 가상 공간에서 실시간 언어 번역을 수행하는 방법을 안내합니다.',
    },
    steps: [
      {
        title: 'Sokuji 확장 프로그램 설치',
        content: 'Chrome 또는 Edge 브라우저에 Sokuji 확장 프로그램이 설치되어 있는지 확인하세요. Chrome 웹 스토어에서 받을 수 있습니다.',
        tip: '설치 후 확장 프로그램 아이콘이 브라우저 도구 모음에 나타납니다.',
      },
      {
        title: 'Gather 열기',
        content: '<code>gather.town</code>으로 이동하여 가상 공간에 입장하세요.',
        tip: 'Gather는 전적으로 브라우저에서 작동하므로 Sokuji와 함께 사용하기에 완벽합니다.',
      },
      {
        title: '공간 참여',
        content: '로그인하여 Gather 공간에 입장하세요. 가상 환경에서 아바타로 나타납니다.',
        tip: '브라우저가 마이크를 사용할 권한이 있는지 확인하세요.',
      },
      {
        title: '오디오 설정 구성',
        content: 'Gather에서 아바타나 설정 메뉴를 클릭하세요. 오디오/비디오 설정으로 이동하여 입력 장치로 <strong>Sokuji Virtual Microphone</strong>을 선택하세요.',
        tip: '가상 마이크가 나타나지 않으면 페이지를 새로 고치고 Sokuji 확장 프로그램이 활성화되어 있는지 확인하세요.',
      },
      {
        title: '말하기 시작',
        content: '대화를 시작하려면 아바타를 다른 참가자 가까이로 이동하세요. 말할 때 음성이 실시간으로 번역됩니다.',
        tip: 'Gather에서는 아바타 근처에 있는 사람들과만 듣고 말할 수 있습니다.',
      },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '가상 공간에서 오디오 피드백을 방지하기 위해 헤드폰 사용',
        '원활한 번역을 위해 안정적인 인터넷 연결 확보',
        '먼저 Gather 공간의 조용한 구역에서 설정 테스트',
        '더 정확한 번역을 위해 문장을 간결하게 유지',
      ],
    },
    faq: {
      title: '자주 묻는 질문',
      items: [
        {
          question: 'Sokuji가 Gather 비공개 영역에서 작동하나요?',
          answer: '네, Sokuji는 비공개 공간, 회의실, 개방 영역을 포함한 모든 Gather 영역에서 작동합니다.',
        },
        {
          question: 'Gather 프레젠테이션에서 Sokuji를 사용할 수 있나요?',
          answer: '네, Sokuji는 오디오가 참가자와 공유되는 Gather 프레젠테이션과 브로드캐스트 중에 작동합니다.',
        },
        {
          question: '다른 사람들이 내 원래 목소리와 번역을 모두 듣나요?',
          answer: '기본적으로 참가자들은 번역된 오디오만 듣습니다. 둘 다 듣게 하려면 Sokuji 설정에서 원본 오디오 패스스루를 활성화할 수 있습니다.',
        },
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content: '문제가 발생하면 <a href="https://github.com/kizuna-ai-lab/sokuji">GitHub 저장소</a>를 방문하거나 <a href="mailto:support@kizuna.ai">support@kizuna.ai</a>로 이메일을 보내 지원을 받으세요.',
    },
  },
};

export function GatherTutorial() {
  const { locale } = useI18n();
  const data = translations[locale] || translations.en;

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/gather" />;
}
