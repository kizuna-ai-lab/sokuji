/**
 * PalabraAI Setup Tutorial Page
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useI18n, Locale } from '@/lib/i18n';
import './tutorials.scss';

interface Translation {
  pageTitle: string;
  backLink: string;
  overview: { title: string; content: string };
  specialization: { title: string; content: string };
  steps: { title: string; content: string }[];
  features: {
    title: string;
    sections: {
      title: string;
      content: string;
      items: string[];
    }[];
  };
  troubleshooting: {
    title: string;
    sections: {
      title: string;
      items: { label: string; content: string }[];
    }[];
  };
  networkRequirements: {
    title: string;
    items: string[];
  };
  helpText: string;
}

const translations: Record<Locale, Translation> = {
  en: {
    pageTitle: 'PalabraAI Setup Tutorial',
    backLink: 'Back to AI Providers',
    overview: {
      title: 'Overview',
      content: 'This tutorial will guide you through setting up PalabraAI for use with Sokuji. PalabraAI specializes in real-time WebRTC translation with minimal latency, making it ideal for live conversations.',
    },
    specialization: {
      title: 'Specialization',
      content: 'PalabraAI is optimized specifically for real-time translation with support for 60+ source languages and 40+ target languages.',
    },
    steps: [
      { title: 'Visit PalabraAI Website', content: 'Go to <a href="https://palabra.ai" target="_blank" rel="noopener noreferrer">palabra.ai</a> to access the PalabraAI platform.' },
      { title: 'Sign Up and Access Dashboard', content: 'Create an account and navigate to your dashboard. PalabraAI typically provides a straightforward registration process.' },
      { title: 'Obtain Client ID', content: 'In your PalabraAI dashboard, look for <strong>"API Keys"</strong> or <strong>"Credentials"</strong> section. Generate a new <strong>Client ID</strong> for your application. Give it a descriptive name like "Sokuji Translation" and copy the generated Client ID. <em>Important: PalabraAI uses Client IDs instead of traditional API keys.</em>' },
      { title: 'Configure in Sokuji', content: 'Open Sokuji and navigate to the Settings panel. Select <strong>"PalabraAI"</strong> as your AI provider, paste your Client ID, choose your voice setting (<code>default_low</code> or <code>default_high</code>), configure your source and target languages, and click Save Settings.' },
      { title: 'Test Your Setup', content: 'Start a translation session to verify everything is working. Click the Start Session button, speak into your microphone, and you should hear the translated audio output with minimal delay.' },
    ],
    features: {
      title: 'PalabraAI-Specific Features',
      sections: [
        {
          title: 'WebRTC Technology',
          content: 'PalabraAI uses WebRTC for ultra-low latency streaming, making it ideal for real-time conversations. The service automatically handles:',
          items: [
            'Audio compression and transmission',
            'Network optimization',
            'Automatic quality adjustment',
            'Echo cancellation and noise reduction',
          ],
        },
        {
          title: 'Language Support',
          content: 'PalabraAI supports extensive language combinations:',
          items: [
            '60+ source languages including major world languages and regional variants',
            '40+ target languages with regional specificity (e.g., Spanish for Mexico vs Spain)',
            'Optimized for commonly requested language pairs',
          ],
        },
        {
          title: 'Automatic Processing',
          content: 'Unlike other providers, PalabraAI handles most audio processing automatically:',
          items: [
            'No manual turn detection configuration needed',
            'Automatic audio quality optimization',
            'Built-in noise reduction',
            'Adaptive streaming based on network conditions',
          ],
        },
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      sections: [
        {
          title: 'Common Issues',
          items: [
            { label: 'Authentication Error', content: 'Double-check that you\'re using the Client ID (not an API key) and that it\'s correctly pasted.' },
            { label: 'Connection Issues', content: 'PalabraAI uses WebRTC, so ensure your firewall/network allows WebRTC connections.' },
            { label: 'Audio Quality Issues', content: 'Try switching between default_low and default_high voice settings based on your network conditions.' },
            { label: 'Language Pair Not Working', content: 'Verify that your selected source and target language combination is supported.' },
          ],
        },
      ],
    },
    networkRequirements: {
      title: 'Network Requirements',
      items: [
        'Stable internet connection (minimum 1 Mbps upload/download)',
        'Low network latency (preferably under 100ms)',
        'WebRTC-compatible network configuration',
        'Avoid VPNs if possible for lowest latency',
      ],
    },
    helpText: 'Need More Help? Check the PalabraAI documentation or visit our GitHub repository for support.',
  },
  zh: {
    pageTitle: 'PalabraAI 设置教程',
    backLink: '返回 AI 提供商',
    overview: {
      title: '概述',
      content: '本教程将指导您设置 PalabraAI 以与 Sokuji 配合使用。PalabraAI 专注于具有最小延迟的实时 WebRTC 翻译，非常适合实时对话。',
    },
    specialization: {
      title: '专业特点',
      content: 'PalabraAI 专门针对实时翻译进行了优化，支持 60 多种源语言和 40 多种目标语言。',
    },
    steps: [
      { title: '访问 PalabraAI 网站', content: '访问 <a href="https://palabra.ai" target="_blank" rel="noopener noreferrer">palabra.ai</a> 以进入 PalabraAI 平台。' },
      { title: '注册并访问控制面板', content: '创建账户并导航到您的控制面板。PalabraAI 通常提供简单的注册流程。' },
      { title: '获取 Client ID', content: '在 PalabraAI 控制面板中，查找 <strong>"API Keys"</strong> 或 <strong>"Credentials"</strong> 部分。为您的应用程序生成新的 <strong>Client ID</strong>。给它一个描述性名称，如"Sokuji Translation"，并复制生成的 Client ID。<em>重要：PalabraAI 使用 Client ID 而不是传统的 API 密钥。</em>' },
      { title: '在 Sokuji 中配置', content: '打开 Sokuji 并导航到设置面板。选择 <strong>"PalabraAI"</strong> 作为您的 AI 提供商，粘贴您的 Client ID，选择语音设置（<code>default_low</code> 或 <code>default_high</code>），配置源语言和目标语言，然后点击保存设置。' },
      { title: '测试您的设置', content: '启动翻译会话以验证一切正常工作。点击开始会话按钮，对着麦克风说话，您应该能听到延迟最小的翻译音频输出。' },
    ],
    features: {
      title: 'PalabraAI 特定功能',
      sections: [
        {
          title: 'WebRTC 技术',
          content: 'PalabraAI 使用 WebRTC 实现超低延迟流传输，非常适合实时对话。该服务自动处理：',
          items: [
            '音频压缩和传输',
            '网络优化',
            '自动质量调整',
            '回声消除和降噪',
          ],
        },
        {
          title: '语言支持',
          content: 'PalabraAI 支持广泛的语言组合：',
          items: [
            '60 多种源语言，包括主要世界语言和地区变体',
            '40 多种目标语言，具有地区特异性（例如，墨西哥西班牙语与西班牙西班牙语）',
            '针对常用语言对进行优化',
          ],
        },
        {
          title: '自动处理',
          content: '与其他提供商不同，PalabraAI 自动处理大多数音频处理：',
          items: [
            '无需手动配置轮次检测',
            '自动音频质量优化',
            '内置降噪',
            '基于网络条件的自适应流传输',
          ],
        },
      ],
    },
    troubleshooting: {
      title: '故障排除',
      sections: [
        {
          title: '常见问题',
          items: [
            { label: '认证错误', content: '仔细检查您使用的是 Client ID（而不是 API 密钥）并且已正确粘贴。' },
            { label: '连接问题', content: 'PalabraAI 使用 WebRTC，因此请确保您的防火墙/网络允许 WebRTC 连接。' },
            { label: '音频质量问题', content: '根据您的网络条件尝试在 default_low 和 default_high 语音设置之间切换。' },
            { label: '语言对不工作', content: '验证您选择的源语言和目标语言组合是否受支持。' },
          ],
        },
      ],
    },
    networkRequirements: {
      title: '网络要求',
      items: [
        '稳定的互联网连接（最低 1 Mbps 上传/下载）',
        '低网络延迟（最好低于 100ms）',
        'WebRTC 兼容的网络配置',
        '如果可能，避免使用 VPN 以获得最低延迟',
      ],
    },
    helpText: '需要更多帮助？查看 PalabraAI 文档或访问我们的 GitHub 仓库获取支持。',
  },
  ja: {
    pageTitle: 'PalabraAI セットアップチュートリアル',
    backLink: 'AI プロバイダーに戻る',
    overview: {
      title: '概要',
      content: 'このチュートリアルでは、Sokuji で使用するための PalabraAI のセットアップを説明します。PalabraAI は最小遅延のリアルタイム WebRTC 翻訳に特化しており、ライブ会話に最適です。',
    },
    specialization: {
      title: '専門分野',
      content: 'PalabraAI は 60 以上のソース言語と 40 以上のターゲット言語をサポートするリアルタイム翻訳に特化して最適化されています。',
    },
    steps: [
      { title: 'PalabraAI ウェブサイトにアクセス', content: '<a href="https://palabra.ai" target="_blank" rel="noopener noreferrer">palabra.ai</a> にアクセスして PalabraAI プラットフォームにアクセスします。' },
      { title: 'サインアップしてダッシュボードにアクセス', content: 'アカウントを作成し、ダッシュボードに移動します。PalabraAI は通常、簡単な登録プロセスを提供しています。' },
      { title: 'Client ID を取得', content: 'PalabraAI ダッシュボードで、<strong>「API Keys」</strong>または<strong>「Credentials」</strong>セクションを探します。アプリケーション用に新しい <strong>Client ID</strong> を生成します。「Sokuji Translation」のような説明的な名前を付け、生成された Client ID をコピーします。<em>重要：PalabraAI は従来の API キーではなく Client ID を使用します。</em>' },
      { title: 'Sokuji で設定', content: 'Sokuji を開き、設定パネルに移動します。AI プロバイダーとして <strong>「PalabraAI」</strong> を選択し、Client ID を貼り付け、音声設定（<code>default_low</code> または <code>default_high</code>）を選択し、ソース言語とターゲット言語を設定して、設定を保存をクリックします。' },
      { title: 'セットアップをテスト', content: '翻訳セッションを開始して、すべてが正常に動作していることを確認します。セッション開始ボタンをクリックし、マイクに向かって話すと、最小限の遅延で翻訳された音声出力が聞こえるはずです。' },
    ],
    features: {
      title: 'PalabraAI 固有の機能',
      sections: [
        {
          title: 'WebRTC テクノロジー',
          content: 'PalabraAI は超低遅延ストリーミングのために WebRTC を使用しており、リアルタイムの会話に最適です。サービスは自動的に処理します：',
          items: [
            '音声圧縮と伝送',
            'ネットワーク最適化',
            '自動品質調整',
            'エコーキャンセルとノイズ低減',
          ],
        },
        {
          title: '言語サポート',
          content: 'PalabraAI は広範な言語の組み合わせをサポートしています：',
          items: [
            '主要な世界言語と地域バリアントを含む 60 以上のソース言語',
            '地域特異性を持つ 40 以上のターゲット言語（例：メキシコスペイン語 vs スペインスペイン語）',
            '一般的にリクエストされる言語ペアに最適化',
          ],
        },
        {
          title: '自動処理',
          content: '他のプロバイダーとは異なり、PalabraAI はほとんどの音声処理を自動的に処理します：',
          items: [
            '手動のターン検出設定は不要',
            '自動音声品質最適化',
            '内蔵ノイズ低減',
            'ネットワーク条件に基づく適応ストリーミング',
          ],
        },
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      sections: [
        {
          title: '一般的な問題',
          items: [
            { label: '認証エラー', content: 'Client ID（API キーではなく）を使用していること、正しく貼り付けられていることを再確認してください。' },
            { label: '接続の問題', content: 'PalabraAI は WebRTC を使用しているため、ファイアウォール/ネットワークが WebRTC 接続を許可していることを確認してください。' },
            { label: '音声品質の問題', content: 'ネットワーク条件に基づいて default_low と default_high の音声設定を切り替えてみてください。' },
            { label: '言語ペアが機能しない', content: '選択したソース言語とターゲット言語の組み合わせがサポートされていることを確認してください。' },
          ],
        },
      ],
    },
    networkRequirements: {
      title: 'ネットワーク要件',
      items: [
        '安定したインターネット接続（最低 1 Mbps のアップロード/ダウンロード）',
        '低ネットワーク遅延（できれば 100ms 未満）',
        'WebRTC 互換のネットワーク構成',
        '最低遅延のために可能であれば VPN を避ける',
      ],
    },
    helpText: 'さらにヘルプが必要ですか？PalabraAI ドキュメントを確認するか、GitHub リポジトリでサポートを受けてください。',
  },
  ko: {
    pageTitle: 'PalabraAI 설정 튜토리얼',
    backLink: 'AI 제공업체로 돌아가기',
    overview: {
      title: '개요',
      content: '이 튜토리얼은 Sokuji와 함께 사용하기 위한 PalabraAI 설정을 안내합니다. PalabraAI는 최소 지연 시간의 실시간 WebRTC 번역에 특화되어 있어 실시간 대화에 이상적입니다.',
    },
    specialization: {
      title: '전문 분야',
      content: 'PalabraAI는 60개 이상의 소스 언어와 40개 이상의 대상 언어를 지원하는 실시간 번역에 특화되어 최적화되어 있습니다.',
    },
    steps: [
      { title: 'PalabraAI 웹사이트 방문', content: '<a href="https://palabra.ai" target="_blank" rel="noopener noreferrer">palabra.ai</a>에 접속하여 PalabraAI 플랫폼에 액세스하세요.' },
      { title: '가입 및 대시보드 액세스', content: '계정을 만들고 대시보드로 이동하세요. PalabraAI는 일반적으로 간단한 등록 프로세스를 제공합니다.' },
      { title: 'Client ID 획득', content: 'PalabraAI 대시보드에서 <strong>"API Keys"</strong> 또는 <strong>"Credentials"</strong> 섹션을 찾으세요. 애플리케이션용 새 <strong>Client ID</strong>를 생성하세요. "Sokuji Translation"과 같은 설명적인 이름을 지정하고 생성된 Client ID를 복사하세요. <em>중요: PalabraAI는 기존 API 키 대신 Client ID를 사용합니다.</em>' },
      { title: 'Sokuji에서 구성', content: 'Sokuji를 열고 설정 패널로 이동하세요. AI 제공업체로 <strong>"PalabraAI"</strong>를 선택하고, Client ID를 붙여넣고, 음성 설정(<code>default_low</code> 또는 <code>default_high</code>)을 선택하고, 소스 및 대상 언어를 구성한 다음 설정 저장을 클릭하세요.' },
      { title: '설정 테스트', content: '모든 것이 제대로 작동하는지 확인하기 위해 번역 세션을 시작하세요. 세션 시작 버튼을 클릭하고 마이크에 대고 말하면 최소 지연으로 번역된 오디오 출력이 들려야 합니다.' },
    ],
    features: {
      title: 'PalabraAI 특정 기능',
      sections: [
        {
          title: 'WebRTC 기술',
          content: 'PalabraAI는 초저지연 스트리밍을 위해 WebRTC를 사용하여 실시간 대화에 이상적입니다. 서비스는 자동으로 처리합니다:',
          items: [
            '오디오 압축 및 전송',
            '네트워크 최적화',
            '자동 품질 조정',
            '에코 제거 및 노이즈 감소',
          ],
        },
        {
          title: '언어 지원',
          content: 'PalabraAI는 광범위한 언어 조합을 지원합니다:',
          items: [
            '주요 세계 언어 및 지역 변형을 포함한 60개 이상의 소스 언어',
            '지역 특이성을 가진 40개 이상의 대상 언어 (예: 멕시코 스페인어 vs 스페인 스페인어)',
            '일반적으로 요청되는 언어 쌍에 최적화',
          ],
        },
        {
          title: '자동 처리',
          content: '다른 제공업체와 달리 PalabraAI는 대부분의 오디오 처리를 자동으로 처리합니다:',
          items: [
            '수동 턴 감지 구성 불필요',
            '자동 오디오 품질 최적화',
            '내장 노이즈 감소',
            '네트워크 조건에 따른 적응형 스트리밍',
          ],
        },
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      sections: [
        {
          title: '일반적인 문제',
          items: [
            { label: '인증 오류', content: 'Client ID(API 키가 아님)를 사용하고 있는지, 올바르게 붙여넣었는지 다시 확인하세요.' },
            { label: '연결 문제', content: 'PalabraAI는 WebRTC를 사용하므로 방화벽/네트워크가 WebRTC 연결을 허용하는지 확인하세요.' },
            { label: '오디오 품질 문제', content: '네트워크 조건에 따라 default_low와 default_high 음성 설정 사이를 전환해 보세요.' },
            { label: '언어 쌍이 작동하지 않음', content: '선택한 소스 및 대상 언어 조합이 지원되는지 확인하세요.' },
          ],
        },
      ],
    },
    networkRequirements: {
      title: '네트워크 요구 사항',
      items: [
        '안정적인 인터넷 연결 (최소 1 Mbps 업로드/다운로드)',
        '낮은 네트워크 지연 시간 (가급적 100ms 미만)',
        'WebRTC 호환 네트워크 구성',
        '최저 지연 시간을 위해 가능하면 VPN 사용 자제',
      ],
    },
    helpText: '더 많은 도움이 필요하신가요? PalabraAI 문서를 확인하거나 GitHub 저장소에서 지원을 받으세요.',
  },
};

export function PalabraAISetup() {
  const { locale } = useI18n();
  const t = translations[locale] || translations.en;

  return (
    <div className="docs-content tutorial-page">
      <Link to="/docs/ai-providers" className="tutorial-page__back-link">
        <ArrowLeft size={16} />
        {t.backLink}
      </Link>

      <h1>{t.pageTitle}</h1>

      <section className="tutorial-page__section">
        <h2>{t.overview.title}</h2>
        <p>{t.overview.content}</p>
      </section>

      <section className="tutorial-page__section">
        <div className="tutorial-page__tip" style={{ borderLeftColor: '#6f42c1' }}>
          <h4>{t.specialization.title}</h4>
          <p>{t.specialization.content}</p>
        </div>
      </section>

      <section className="tutorial-page__section">
        {t.steps.map((step, index) => (
          <div key={index} className="tutorial-page__step" style={{ borderLeftColor: '#6f42c1' }}>
            <h3>
              <span className="tutorial-page__step-number" style={{ backgroundColor: '#6f42c1' }}>{index + 1}</span>
              {step.title}
            </h3>
            <p dangerouslySetInnerHTML={{ __html: step.content }} />
          </div>
        ))}
      </section>

      <section className="tutorial-page__section">
        <h2>{t.features.title}</h2>
        {t.features.sections.map((section, index) => (
          <div key={index} className="tutorial-page__step" style={{ borderLeftColor: '#6f42c1' }}>
            <h3>{section.title}</h3>
            <p>{section.content}</p>
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="tutorial-page__section">
        <h2>{t.troubleshooting.title}</h2>
        {t.troubleshooting.sections.map((section, index) => (
          <div key={index} className="tutorial-page__step" style={{ borderLeftColor: '#6f42c1' }}>
            <h3>{section.title}</h3>
            {section.items.map((item, i) => (
              <p key={i}><strong>{item.label}:</strong> {item.content}</p>
            ))}
          </div>
        ))}
      </section>

      <section className="tutorial-page__section">
        <div className="tutorial-page__step" style={{ borderLeftColor: '#6f42c1' }}>
          <h3>{t.networkRequirements.title}</h3>
          <ul>
            {t.networkRequirements.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="tutorial-page__section">
        <div className="tutorial-page__tip">
          <p>{t.helpText}</p>
        </div>
      </section>

      <section className="tutorial-page__section">
        <a
          href="https://palabra.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="install-page__download-btn"
          style={{ backgroundColor: '#6f42c1' }}
        >
          PalabraAI Website
          <ExternalLink size={16} />
        </a>
      </section>
    </div>
  );
}
