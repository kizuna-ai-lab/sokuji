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
          'Navigate to <code>teams.live.com</code> or <code>teams.microsoft.com</code> and sign in with your Microsoft account. Then join or start a meeting.',
        screenshot: '1.png',
        tip: 'Sokuji works with the web version of Teams. The desktop app is not supported.',
      },
      {
        title: 'Grant Permissions to Teams',
        content:
          'If this is your first time using Teams, you need to allow Teams to access your camera and microphone. Click <strong>"Allow while visiting the site"</strong> or <strong>"Allow this time"</strong> when prompted.',
        screenshot: '2.png',
        tip: 'This step is required for Teams to access your real devices. If you skip this, you will only see the Sokuji Virtual Microphone in device settings.',
      },
      {
        title: 'Grant Permissions to Sokuji',
        content:
          'If you have previously granted permissions to Teams, you will also need to grant microphone permission to Sokuji. Select your preferred microphone from the dropdown and click <strong>"Allow while visiting the site"</strong>.',
        screenshot: '3.png',
        tip: 'Sokuji needs access to your real microphone to capture your voice for translation.',
      },
      {
        title: 'Troubleshoot: Only Virtual Microphone Visible',
        content:
          'If your microphone dropdown only shows "Sokuji Virtual Microphone" and no other devices (as shown), it means Teams hasn\'t been granted permission to access your real devices. To fix this: <strong>1)</strong> Click the puzzle piece icon (Extensions) in your browser toolbar, find Sokuji and click the three-dot menu, then select "Disable" or toggle it off, <strong>2)</strong> Refresh the Teams page, <strong>3)</strong> Allow Teams to access your microphone and camera when prompted, <strong>4)</strong> Go back to Extensions, find Sokuji and click "Enable" or toggle it on, <strong>5)</strong> Refresh the Teams page again.',
        screenshot: '4-1.png',
        tip: 'You can also manage extensions by typing <code>chrome://extensions</code> (Chrome) or <code>edge://extensions</code> (Edge) in your address bar.',
      },
      {
        title: 'Select Sokuji Virtual Microphone',
        content:
          'Once both Teams and Sokuji have the correct permissions, you should see all your devices in the dropdown. Select <strong>"Sokuji Virtual Microphone"</strong> as your microphone.',
        screenshot: '4-2.png',
        tip: 'You should see your real microphones alongside the Sokuji Virtual Microphone in the list.',
      },
      {
        title: 'Open Sokuji and Start Translation',
        content:
          'Click the Sokuji icon in the top right corner of your browser, then click <strong>"Open Sokuji"</strong> to open the extension panel. Configure your translation settings and start speaking!',
        screenshot: '5.png',
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
            'The Sokuji browser extension only works with web browsers. If you want to use the Teams desktop app, please use the Sokuji desktop application instead.',
        },
        {
          question: 'Can I use Sokuji in Teams channels or only in meetings?',
          answer:
            "Sokuji works in Teams meetings and calls. It doesn't translate text messages in channels or chats.",
        },
        {
          question: "Why can I only see Sokuji Virtual Microphone in device settings?",
          answer:
            "This happens when Teams hasn't been granted permission to access your real devices. Temporarily disable Sokuji, refresh the page, allow Teams to access your microphone, then re-enable Sokuji and refresh again.",
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
          '访问 <code>teams.live.com</code> 或 <code>teams.microsoft.com</code> 并使用您的 Microsoft 账号登录。然后加入或开始一个会议。',
        screenshot: '1.png',
        tip: 'Sokuji 适用于 Teams 的网页版本。不支持桌面应用。',
      },
      {
        title: '授权 Teams 访问设备',
        content:
          '如果您是第一次使用 Teams，需要允许 Teams 访问您的摄像头和麦克风。出现提示时，点击<strong>"在访问此网站期间允许"</strong>或<strong>"允许一次"</strong>。',
        screenshot: '2.png',
        tip: '此步骤是 Teams 访问您真实设备所必需的。如果跳过此步骤，您在设备设置中将只能看到 Sokuji 虚拟麦克风。',
      },
      {
        title: '授权 Sokuji 访问麦克风',
        content:
          '如果您之前已授权 Teams 使用摄像头和麦克风，您还需要授权 Sokuji 使用您的麦克风。从下拉菜单中选择您的首选麦克风，然后点击<strong>"在访问此网站期间允许"</strong>。',
        screenshot: '3.png',
        tip: 'Sokuji 需要访问您的真实麦克风来捕获您的声音进行翻译。',
      },
      {
        title: '故障排除：只能看到虚拟麦克风',
        content:
          '如果您的麦克风下拉菜单只显示"Sokuji Virtual Microphone"而没有其他设备（如图所示），说明 Teams 没有获得访问您真实设备的权限。解决方法：<strong>1)</strong> 点击浏览器工具栏中的拼图图标（扩展程序），找到 Sokuji 并点击三点菜单，选择"禁用"或关闭开关，<strong>2)</strong> 刷新 Teams 页面，<strong>3)</strong> 出现提示时允许 Teams 访问您的麦克风和摄像头，<strong>4)</strong> 返回扩展程序，找到 Sokuji 并点击"启用"或打开开关，<strong>5)</strong> 再次刷新 Teams 页面。',
        screenshot: '4-1.png',
        tip: '您也可以在地址栏输入 <code>chrome://extensions</code>（Chrome）或 <code>edge://extensions</code>（Edge）来管理扩展程序。',
      },
      {
        title: '选择 Sokuji 虚拟麦克风',
        content:
          '当 Teams 和 Sokuji 都获得正确的权限后，您应该能在下拉菜单中看到所有设备。选择 <strong>"Sokuji Virtual Microphone"</strong> 作为您的麦克风。',
        screenshot: '4-2.png',
        tip: '您应该能在列表中看到您的真实麦克风和 Sokuji 虚拟麦克风。',
      },
      {
        title: '打开 Sokuji 并开始翻译',
        content:
          '点击浏览器右上角的 Sokuji 图标，然后点击<strong>"Open Sokuji"</strong>打开扩展面板。配置您的翻译设置并开始说话！',
        screenshot: '5.png',
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
            'Sokuji 浏览器扩展只支持网页浏览器。如果您想使用 Teams 桌面应用，请使用 Sokuji 桌面应用。',
        },
        {
          question: '我可以在 Teams 频道中使用 Sokuji 还是仅在会议中？',
          answer: 'Sokuji 在 Teams 会议和通话中工作。它不会翻译频道或聊天中的文本消息。',
        },
        {
          question: '为什么设备设置中只能看到 Sokuji 虚拟麦克风？',
          answer:
            '这是因为 Teams 没有获得访问您真实设备的权限。请暂时禁用 Sokuji，刷新页面，允许 Teams 访问您的麦克风，然后重新启用 Sokuji 并再次刷新。',
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
          '<code>teams.live.com</code> または <code>teams.microsoft.com</code> にアクセスし、Microsoft アカウントでサインインします。その後、会議に参加または開始します。',
        screenshot: '1.png',
        tip: 'Sokuji は Teams の Web バージョンで動作します。デスクトップアプリはサポートされていません。',
      },
      {
        title: 'Teams に権限を付与',
        content:
          'Teams を初めて使用する場合は、Teams がカメラとマイクにアクセスすることを許可する必要があります。プロンプトが表示されたら、<strong>「このサイトの訪問中は許可」</strong>または<strong>「今回のみ許可」</strong>をクリックします。',
        screenshot: '2.png',
        tip: 'このステップは、Teams が実際のデバイスにアクセスするために必要です。これをスキップすると、デバイス設定に Sokuji 仮想マイクのみが表示されます。',
      },
      {
        title: 'Sokuji に権限を付与',
        content:
          '以前に Teams にカメラとマイクの許可を与えている場合は、Sokuji にもマイクの許可を与える必要があります。ドロップダウンから希望のマイクを選択し、<strong>「このサイトの訪問中は許可」</strong>をクリックします。',
        screenshot: '3.png',
        tip: 'Sokuji は翻訳のために音声をキャプチャするため、実際のマイクへのアクセスが必要です。',
      },
      {
        title: 'トラブルシューティング：仮想マイクのみ表示される',
        content:
          'マイクのドロップダウンに「Sokuji Virtual Microphone」のみが表示され、他のデバイスが表示されない場合（図のように）、Teams が実際のデバイスにアクセスする権限を付与されていません。修正方法：<strong>1)</strong> ブラウザツールバーのパズルピースアイコン（拡張機能）をクリックし、Sokuji を見つけて三点メニューをクリックし、「無効にする」を選択するかトグルをオフにする、<strong>2)</strong> Teams ページを更新する、<strong>3)</strong> プロンプトが表示されたら Teams がマイクとカメラにアクセスすることを許可する、<strong>4)</strong> 拡張機能に戻り、Sokuji を見つけて「有効にする」をクリックするかトグルをオンにする、<strong>5)</strong> Teams ページを再度更新する。',
        screenshot: '4-1.png',
        tip: 'アドレスバーに <code>chrome://extensions</code>（Chrome）または <code>edge://extensions</code>（Edge）と入力して拡張機能を管理することもできます。',
      },
      {
        title: 'Sokuji 仮想マイクを選択',
        content:
          'Teams と Sokuji の両方に正しい権限が付与されると、ドロップダウンにすべてのデバイスが表示されます。マイクとして <strong>「Sokuji Virtual Microphone」</strong> を選択します。',
        screenshot: '4-2.png',
        tip: 'リストに実際のマイクと Sokuji 仮想マイクの両方が表示されるはずです。',
      },
      {
        title: 'Sokuji を開いて翻訳を開始',
        content:
          'ブラウザの右上にある Sokuji アイコンをクリックし、<strong>「Open Sokuji」</strong>をクリックして拡張機能パネルを開きます。翻訳設定を構成して話し始めましょう！',
        screenshot: '5.png',
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
            'Sokuji ブラウザ拡張機能は Web ブラウザでのみ動作します。Teams デスクトップアプリを使用したい場合は、Sokuji デスクトップアプリケーションをご利用ください。',
        },
        {
          question: 'Teams チャンネルで Sokuji を使用できますか、それとも会議でのみ使用できますか？',
          answer:
            'Sokuji は Teams の会議と通話で動作します。チャンネルやチャットのテキストメッセージは翻訳しません。',
        },
        {
          question: 'デバイス設定に Sokuji 仮想マイクしか表示されないのはなぜですか？',
          answer:
            'これは Teams が実際のデバイスにアクセスする権限を付与されていないためです。Sokuji を一時的に無効にし、ページを更新し、Teams がマイクにアクセスすることを許可してから、Sokuji を再度有効にして再度更新してください。',
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
          '<code>teams.live.com</code> 또는 <code>teams.microsoft.com</code>으로 이동하여 Microsoft 계정으로 로그인하세요. 그런 다음 회의에 참여하거나 시작하세요.',
        screenshot: '1.png',
        tip: 'Sokuji는 Teams의 웹 버전에서 작동합니다. 데스크톱 앱은 지원되지 않습니다.',
      },
      {
        title: 'Teams에 권한 부여',
        content:
          'Teams를 처음 사용하는 경우 Teams가 카메라와 마이크에 액세스하도록 허용해야 합니다. 메시지가 표시되면 <strong>"이 사이트 방문 중 허용"</strong> 또는 <strong>"이번만 허용"</strong>을 클릭하세요.',
        screenshot: '2.png',
        tip: '이 단계는 Teams가 실제 장치에 액세스하는 데 필요합니다. 이 단계를 건너뛰면 장치 설정에 Sokuji 가상 마이크만 표시됩니다.',
      },
      {
        title: 'Sokuji에 권한 부여',
        content:
          '이전에 Teams에 카메라와 마이크 권한을 부여한 경우 Sokuji에도 마이크 권한을 부여해야 합니다. 드롭다운에서 원하는 마이크를 선택하고 <strong>"이 사이트 방문 중 허용"</strong>을 클릭하세요.',
        screenshot: '3.png',
        tip: 'Sokuji는 번역을 위해 음성을 캡처하므로 실제 마이크에 대한 액세스가 필요합니다.',
      },
      {
        title: '문제 해결: 가상 마이크만 표시됨',
        content:
          '마이크 드롭다운에 "Sokuji Virtual Microphone"만 표시되고 다른 장치가 표시되지 않는 경우(그림 참조), Teams가 실제 장치에 액세스할 권한을 부여받지 못한 것입니다. 해결 방법: <strong>1)</strong> 브라우저 도구 모음에서 퍼즐 조각 아이콘(확장 프로그램)을 클릭하고 Sokuji를 찾아 점 세 개 메뉴를 클릭한 다음 "비활성화"를 선택하거나 토글을 끔, <strong>2)</strong> Teams 페이지 새로 고침, <strong>3)</strong> 메시지가 표시되면 Teams가 마이크와 카메라에 액세스하도록 허용, <strong>4)</strong> 확장 프로그램으로 돌아가 Sokuji를 찾아 "활성화"를 클릭하거나 토글을 켬, <strong>5)</strong> Teams 페이지를 다시 새로 고침.',
        screenshot: '4-1.png',
        tip: '주소 표시줄에 <code>chrome://extensions</code>(Chrome) 또는 <code>edge://extensions</code>(Edge)를 입력하여 확장 프로그램을 관리할 수도 있습니다.',
      },
      {
        title: 'Sokuji 가상 마이크 선택',
        content:
          'Teams와 Sokuji 모두 올바른 권한이 부여되면 드롭다운에 모든 장치가 표시됩니다. 마이크로 <strong>"Sokuji Virtual Microphone"</strong>을 선택하세요.',
        screenshot: '4-2.png',
        tip: '목록에 실제 마이크와 Sokuji 가상 마이크가 함께 표시되어야 합니다.',
      },
      {
        title: 'Sokuji 열고 번역 시작',
        content:
          '브라우저 오른쪽 상단의 Sokuji 아이콘을 클릭한 다음 <strong>"Open Sokuji"</strong>를 클릭하여 확장 프로그램 패널을 엽니다. 번역 설정을 구성하고 말하기 시작하세요!',
        screenshot: '5.png',
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
            'Sokuji 브라우저 확장 프로그램은 웹 브라우저에서만 작동합니다. Teams 데스크톱 앱을 사용하려면 Sokuji 데스크톱 애플리케이션 을 사용하세요.',
        },
        {
          question: 'Teams 채널에서 Sokuji를 사용할 수 있나요, 아니면 회의에서만 사용할 수 있나요?',
          answer:
            'Sokuji는 Teams 회의와 통화에서 작동합니다. 채널이나 채팅의 텍스트 메시지는 번역하지 않습니다.',
        },
        {
          question: '장치 설정에 Sokuji 가상 마이크만 표시되는 이유는 무엇인가요?',
          answer:
            '이는 Teams가 실제 장치에 액세스할 권한을 부여받지 못했기 때문입니다. Sokuji를 일시적으로 비활성화하고 페이지를 새로 고친 다음 Teams가 마이크에 액세스하도록 허용하고 Sokuji를 다시 활성화한 후 다시 새로 고침하세요.',
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

  return <TutorialTemplate data={data} screenshotBasePath="/tutorials/teams" />;
}
