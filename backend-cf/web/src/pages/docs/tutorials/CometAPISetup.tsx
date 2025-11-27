/**
 * CometAPI Setup Tutorial Page
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useI18n, Locale } from '@/lib/i18n';
import './tutorials.scss';

interface Translation {
  pageTitle: string;
  backLink: string;
  overview: { title: string; content: string };
  compatibility: { title: string; content: string };
  steps: { title: string; content: string }[];
  features: {
    title: string;
    sections: {
      title: string;
      content?: string;
      items: string[];
    }[];
  };
  troubleshooting: {
    title: string;
    sections: {
      title: string;
      items?: { label: string; content: string }[];
      steps?: string[];
    }[];
  };
  helpText: string;
}

const translations: Record<Locale, Translation> = {
  en: {
    pageTitle: 'CometAPI Setup Tutorial',
    backLink: 'Back to AI Providers',
    overview: {
      title: 'Overview',
      content: 'This tutorial will guide you through setting up CometAPI for use with Sokuji. CometAPI is fully compatible with OpenAI\'s Realtime API, offering the same features with alternative pricing and service options.',
    },
    compatibility: {
      title: 'OpenAI Compatibility',
      content: 'CometAPI is 100% compatible with OpenAI\'s Realtime API. All models, voices, and features work identically.',
    },
    steps: [
      { title: 'Visit CometAPI Website', content: 'Go to <a href="https://api.cometapi.com/" target="_blank" rel="noopener noreferrer">api.cometapi.com</a> to access the CometAPI platform.' },
      { title: 'Create Account and Set Up Billing', content: 'Sign up for a CometAPI account and configure your billing settings. Like OpenAI, CometAPI requires a paid account for Realtime API access. CometAPI often offers competitive pricing compared to OpenAI.' },
      { title: 'Generate API Key', content: 'In your CometAPI dashboard, navigate to the <strong>"API Keys"</strong> section. Click <strong>"Create new API key"</strong>, give your key a descriptive name like "Sokuji Translation", select appropriate permissions (Realtime API access), click Generate and copy the key. <em>Security Note: Copy and save your API key immediately. CometAPI will only show it once.</em>' },
      { title: 'Configure in Sokuji', content: 'Open Sokuji and navigate to the Settings panel. Select <strong>"CometAPI"</strong> as your AI provider, paste your API key, choose your preferred model (<code>gpt-4o-realtime-preview</code>), select a voice (<code>alloy</code>, <code>echo</code>, <code>shimmer</code>, etc.), configure your source and target languages, and click Save Settings.' },
      { title: 'Test Your Setup', content: 'Start a translation session to verify everything is working. Click the Start Session button, speak into your microphone, and you should hear the translated audio output.' },
    ],
    features: {
      title: 'CometAPI-Specific Information',
      sections: [
        {
          title: 'Full OpenAI Compatibility',
          content: 'CometAPI provides identical functionality to OpenAI\'s Realtime API:',
          items: [
            'Same Models: gpt-4o-realtime-preview, gpt-4o-mini-realtime-preview',
            'Same Voices: All 8 OpenAI voices (Alloy, Ash, Ballad, Coral, Echo, Sage, Shimmer, Verse)',
            'Same Features: Turn detection, noise reduction, temperature control, etc.',
            'Same Quality: Identical audio processing and translation quality',
          ],
        },
        {
          title: 'Why Choose CometAPI?',
          items: [
            'Alternative Pricing: Potentially lower costs or different pricing structure',
            'Service Reliability: Additional service provider for redundancy',
            'Regional Availability: May be available in regions where OpenAI isn\'t',
            'Support Options: Different customer support channels',
          ],
        },
        {
          title: 'Configuration Tips',
          content: 'Since CometAPI is OpenAI-compatible, you can:',
          items: [
            'Use the exact same settings as you would with OpenAI',
            'Switch between OpenAI and CometAPI easily',
            'Use the same prompts and templates',
            'Expect identical behavior and results',
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
            { label: 'Authentication Error', content: 'Verify your CometAPI key is correctly pasted and that billing is set up on your account.' },
            { label: 'Model Not Available', content: 'Ensure your CometAPI account has access to Realtime API models.' },
            { label: 'Different Behavior from OpenAI', content: 'This shouldn\'t happen due to full compatibility. Contact CometAPI support if you notice differences.' },
          ],
        },
        {
          title: 'Switching from OpenAI',
          steps: [
            'Export your current Sokuji settings',
            'Change provider to CometAPI',
            'Replace the API key',
            'Keep all other settings identical',
            'Test to ensure everything works as expected',
          ],
        },
      ],
    },
    helpText: 'Need More Help? Check the CometAPI documentation or visit our GitHub repository for support.',
  },
  zh: {
    pageTitle: 'CometAPI 设置教程',
    backLink: '返回 AI 提供商',
    overview: {
      title: '概述',
      content: '本教程将指导您设置 CometAPI 以与 Sokuji 配合使用。CometAPI 与 OpenAI 的 Realtime API 完全兼容，提供相同的功能，但有不同的定价和服务选项。',
    },
    compatibility: {
      title: 'OpenAI 兼容性',
      content: 'CometAPI 与 OpenAI 的 Realtime API 100% 兼容。所有模型、语音和功能都完全相同。',
    },
    steps: [
      { title: '访问 CometAPI 网站', content: '访问 <a href="https://api.cometapi.com/" target="_blank" rel="noopener noreferrer">api.cometapi.com</a> 以进入 CometAPI 平台。' },
      { title: '创建账户并设置计费', content: '注册 CometAPI 账户并配置计费设置。与 OpenAI 一样，CometAPI 需要付费账户才能访问 Realtime API。CometAPI 通常提供比 OpenAI 更具竞争力的价格。' },
      { title: '生成 API 密钥', content: '在 CometAPI 控制面板中，导航到 <strong>"API Keys"</strong> 部分。点击 <strong>"Create new API key"</strong>，给密钥一个描述性名称，如"Sokuji Translation"，选择适当的权限（Realtime API 访问），点击生成并复制密钥。<em>安全提示：立即复制并保存您的 API 密钥。CometAPI 只会显示一次。</em>' },
      { title: '在 Sokuji 中配置', content: '打开 Sokuji 并导航到设置面板。选择 <strong>"CometAPI"</strong> 作为您的 AI 提供商，粘贴您的 API 密钥，选择首选模型（<code>gpt-4o-realtime-preview</code>），选择语音（<code>alloy</code>、<code>echo</code>、<code>shimmer</code> 等），配置源语言和目标语言，然后点击保存设置。' },
      { title: '测试您的设置', content: '启动翻译会话以验证一切正常工作。点击开始会话按钮，对着麦克风说话，您应该能听到翻译的音频输出。' },
    ],
    features: {
      title: 'CometAPI 特定信息',
      sections: [
        {
          title: '完全 OpenAI 兼容',
          content: 'CometAPI 提供与 OpenAI Realtime API 相同的功能：',
          items: [
            '相同模型：gpt-4o-realtime-preview、gpt-4o-mini-realtime-preview',
            '相同语音：所有 8 种 OpenAI 语音（Alloy、Ash、Ballad、Coral、Echo、Sage、Shimmer、Verse）',
            '相同功能：轮次检测、降噪、温度控制等',
            '相同质量：相同的音频处理和翻译质量',
          ],
        },
        {
          title: '为什么选择 CometAPI？',
          items: [
            '替代定价：可能更低的成本或不同的定价结构',
            '服务可靠性：额外的服务提供商作为冗余',
            '地区可用性：可能在 OpenAI 不可用的地区可用',
            '支持选项：不同的客户支持渠道',
          ],
        },
        {
          title: '配置提示',
          content: '由于 CometAPI 与 OpenAI 兼容，您可以：',
          items: [
            '使用与 OpenAI 完全相同的设置',
            '轻松在 OpenAI 和 CometAPI 之间切换',
            '使用相同的提示和模板',
            '期望相同的行为和结果',
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
            { label: '认证错误', content: '验证您的 CometAPI 密钥是否正确粘贴，以及账户是否已设置计费。' },
            { label: '模型不可用', content: '确保您的 CometAPI 账户有权访问 Realtime API 模型。' },
            { label: '与 OpenAI 行为不同', content: '由于完全兼容，这不应该发生。如果您发现差异，请联系 CometAPI 支持。' },
          ],
        },
        {
          title: '从 OpenAI 切换',
          steps: [
            '导出当前的 Sokuji 设置',
            '将提供商更改为 CometAPI',
            '替换 API 密钥',
            '保持所有其他设置相同',
            '测试以确保一切按预期工作',
          ],
        },
      ],
    },
    helpText: '需要更多帮助？查看 CometAPI 文档或访问我们的 GitHub 仓库获取支持。',
  },
  ja: {
    pageTitle: 'CometAPI セットアップチュートリアル',
    backLink: 'AI プロバイダーに戻る',
    overview: {
      title: '概要',
      content: 'このチュートリアルでは、Sokuji で使用するための CometAPI のセットアップを説明します。CometAPI は OpenAI の Realtime API と完全に互換性があり、代替の価格設定とサービスオプションで同じ機能を提供します。',
    },
    compatibility: {
      title: 'OpenAI 互換性',
      content: 'CometAPI は OpenAI の Realtime API と 100% 互換性があります。すべてのモデル、音声、機能が同様に動作します。',
    },
    steps: [
      { title: 'CometAPI ウェブサイトにアクセス', content: '<a href="https://api.cometapi.com/" target="_blank" rel="noopener noreferrer">api.cometapi.com</a> にアクセスして CometAPI プラットフォームにアクセスします。' },
      { title: 'アカウントを作成して課金を設定', content: 'CometAPI アカウントにサインアップし、課金設定を構成します。OpenAI と同様に、CometAPI は Realtime API へのアクセスに有料アカウントが必要です。CometAPI は OpenAI と比較して競争力のある価格を提供することが多いです。' },
      { title: 'API キーを生成', content: 'CometAPI ダッシュボードで、<strong>「API Keys」</strong>セクションに移動します。<strong>「Create new API key」</strong>をクリックし、「Sokuji Translation」のような説明的な名前を付け、適切な権限（Realtime API アクセス）を選択し、生成をクリックしてキーをコピーします。<em>セキュリティ注意：API キーをすぐにコピーして保存してください。CometAPI は一度だけ表示します。</em>' },
      { title: 'Sokuji で設定', content: 'Sokuji を開き、設定パネルに移動します。AI プロバイダーとして <strong>「CometAPI」</strong> を選択し、API キーを貼り付け、好みのモデル（<code>gpt-4o-realtime-preview</code>）を選択し、音声（<code>alloy</code>、<code>echo</code>、<code>shimmer</code> など）を選択し、ソース言語とターゲット言語を設定して、設定を保存をクリックします。' },
      { title: 'セットアップをテスト', content: '翻訳セッションを開始して、すべてが正常に動作していることを確認します。セッション開始ボタンをクリックし、マイクに向かって話すと、翻訳された音声出力が聞こえるはずです。' },
    ],
    features: {
      title: 'CometAPI 固有の情報',
      sections: [
        {
          title: '完全な OpenAI 互換性',
          content: 'CometAPI は OpenAI の Realtime API と同一の機能を提供します：',
          items: [
            '同じモデル：gpt-4o-realtime-preview、gpt-4o-mini-realtime-preview',
            '同じ音声：すべての 8 つの OpenAI 音声（Alloy、Ash、Ballad、Coral、Echo、Sage、Shimmer、Verse）',
            '同じ機能：ターン検出、ノイズ低減、温度制御など',
            '同じ品質：同一の音声処理と翻訳品質',
          ],
        },
        {
          title: 'なぜ CometAPI を選ぶのか？',
          items: [
            '代替価格：潜在的に低いコストまたは異なる価格構造',
            'サービス信頼性：冗長性のための追加サービスプロバイダー',
            '地域の可用性：OpenAI が利用できない地域で利用可能な場合がある',
            'サポートオプション：異なるカスタマーサポートチャネル',
          ],
        },
        {
          title: '設定のヒント',
          content: 'CometAPI は OpenAI 互換なので、以下が可能です：',
          items: [
            'OpenAI とまったく同じ設定を使用する',
            'OpenAI と CometAPI を簡単に切り替える',
            '同じプロンプトとテンプレートを使用する',
            '同一の動作と結果を期待する',
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
            { label: '認証エラー', content: 'CometAPI キーが正しく貼り付けられていること、アカウントで課金が設定されていることを確認してください。' },
            { label: 'モデルが利用できない', content: 'CometAPI アカウントに Realtime API モデルへのアクセス権があることを確認してください。' },
            { label: 'OpenAI と異なる動作', content: '完全な互換性のため、これは発生しないはずです。違いに気づいた場合は CometAPI サポートに連絡してください。' },
          ],
        },
        {
          title: 'OpenAI からの切り替え',
          steps: [
            '現在の Sokuji 設定をエクスポート',
            'プロバイダーを CometAPI に変更',
            'API キーを置き換え',
            '他のすべての設定を同一に保つ',
            'すべてが期待どおりに動作することをテスト',
          ],
        },
      ],
    },
    helpText: 'さらにヘルプが必要ですか？CometAPI ドキュメントを確認するか、GitHub リポジトリでサポートを受けてください。',
  },
  ko: {
    pageTitle: 'CometAPI 설정 튜토리얼',
    backLink: 'AI 제공업체로 돌아가기',
    overview: {
      title: '개요',
      content: '이 튜토리얼은 Sokuji와 함께 사용하기 위한 CometAPI 설정을 안내합니다. CometAPI는 OpenAI의 Realtime API와 완전히 호환되며, 대체 가격 및 서비스 옵션과 함께 동일한 기능을 제공합니다.',
    },
    compatibility: {
      title: 'OpenAI 호환성',
      content: 'CometAPI는 OpenAI의 Realtime API와 100% 호환됩니다. 모든 모델, 음성 및 기능이 동일하게 작동합니다.',
    },
    steps: [
      { title: 'CometAPI 웹사이트 방문', content: '<a href="https://api.cometapi.com/" target="_blank" rel="noopener noreferrer">api.cometapi.com</a>에 접속하여 CometAPI 플랫폼에 액세스하세요.' },
      { title: '계정 생성 및 결제 설정', content: 'CometAPI 계정에 가입하고 결제 설정을 구성하세요. OpenAI와 마찬가지로 CometAPI는 Realtime API 액세스를 위해 유료 계정이 필요합니다. CometAPI는 종종 OpenAI보다 경쟁력 있는 가격을 제공합니다.' },
      { title: 'API 키 생성', content: 'CometAPI 대시보드에서 <strong>"API Keys"</strong> 섹션으로 이동하세요. <strong>"Create new API key"</strong>를 클릭하고, "Sokuji Translation"과 같은 설명적인 이름을 지정하고, 적절한 권한(Realtime API 액세스)을 선택하고, 생성을 클릭하고 키를 복사하세요. <em>보안 참고: API 키를 즉시 복사하여 저장하세요. CometAPI는 한 번만 표시합니다.</em>' },
      { title: 'Sokuji에서 구성', content: 'Sokuji를 열고 설정 패널로 이동하세요. AI 제공업체로 <strong>"CometAPI"</strong>를 선택하고, API 키를 붙여넣고, 선호하는 모델(<code>gpt-4o-realtime-preview</code>)을 선택하고, 음성(<code>alloy</code>, <code>echo</code>, <code>shimmer</code> 등)을 선택하고, 소스 및 대상 언어를 구성한 다음 설정 저장을 클릭하세요.' },
      { title: '설정 테스트', content: '모든 것이 제대로 작동하는지 확인하기 위해 번역 세션을 시작하세요. 세션 시작 버튼을 클릭하고 마이크에 대고 말하면 번역된 오디오 출력이 들려야 합니다.' },
    ],
    features: {
      title: 'CometAPI 특정 정보',
      sections: [
        {
          title: '완전한 OpenAI 호환성',
          content: 'CometAPI는 OpenAI의 Realtime API와 동일한 기능을 제공합니다:',
          items: [
            '동일한 모델: gpt-4o-realtime-preview, gpt-4o-mini-realtime-preview',
            '동일한 음성: 모든 8개의 OpenAI 음성 (Alloy, Ash, Ballad, Coral, Echo, Sage, Shimmer, Verse)',
            '동일한 기능: 턴 감지, 노이즈 감소, 온도 제어 등',
            '동일한 품질: 동일한 오디오 처리 및 번역 품질',
          ],
        },
        {
          title: '왜 CometAPI를 선택하나요?',
          items: [
            '대체 가격: 잠재적으로 더 낮은 비용 또는 다른 가격 구조',
            '서비스 신뢰성: 중복성을 위한 추가 서비스 제공자',
            '지역 가용성: OpenAI를 사용할 수 없는 지역에서 사용 가능할 수 있음',
            '지원 옵션: 다른 고객 지원 채널',
          ],
        },
        {
          title: '구성 팁',
          content: 'CometAPI는 OpenAI 호환이므로 다음이 가능합니다:',
          items: [
            'OpenAI와 정확히 동일한 설정 사용',
            'OpenAI와 CometAPI 간에 쉽게 전환',
            '동일한 프롬프트 및 템플릿 사용',
            '동일한 동작 및 결과 기대',
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
            { label: '인증 오류', content: 'CometAPI 키가 올바르게 붙여넣어졌는지, 계정에 결제가 설정되어 있는지 확인하세요.' },
            { label: '모델 사용 불가', content: 'CometAPI 계정에 Realtime API 모델 액세스 권한이 있는지 확인하세요.' },
            { label: 'OpenAI와 다른 동작', content: '완전한 호환성으로 인해 이런 일은 발생하지 않아야 합니다. 차이점을 발견하면 CometAPI 지원팀에 문의하세요.' },
          ],
        },
        {
          title: 'OpenAI에서 전환',
          steps: [
            '현재 Sokuji 설정 내보내기',
            '제공업체를 CometAPI로 변경',
            'API 키 교체',
            '다른 모든 설정을 동일하게 유지',
            '모든 것이 예상대로 작동하는지 테스트',
          ],
        },
      ],
    },
    helpText: '더 많은 도움이 필요하신가요? CometAPI 문서를 확인하거나 GitHub 저장소에서 지원을 받으세요.',
  },
};

export function CometAPISetup() {
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
        <div className="tutorial-page__tip" style={{ borderLeftColor: '#e74c3c' }}>
          <h4>{t.compatibility.title}</h4>
          <p>{t.compatibility.content}</p>
        </div>
      </section>

      <section className="tutorial-page__section">
        {t.steps.map((step, index) => (
          <div key={index} className="tutorial-page__step" style={{ borderLeftColor: '#e74c3c' }}>
            <h3>
              <span className="tutorial-page__step-number" style={{ backgroundColor: '#e74c3c' }}>{index + 1}</span>
              {step.title}
            </h3>
            <p dangerouslySetInnerHTML={{ __html: step.content }} />
          </div>
        ))}
      </section>

      <section className="tutorial-page__section">
        <h2>{t.features.title}</h2>
        {t.features.sections.map((section, index) => (
          <div key={index} className="tutorial-page__step" style={{ borderLeftColor: '#e74c3c' }}>
            <h3>{section.title}</h3>
            {section.content && <p>{section.content}</p>}
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
          <div key={index} className="tutorial-page__step" style={{ borderLeftColor: '#e74c3c' }}>
            <h3>{section.title}</h3>
            {section.items && section.items.map((item, i) => (
              <p key={i}><strong>{item.label}:</strong> {item.content}</p>
            ))}
            {section.steps && (
              <ol>
                {section.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </section>

      <section className="tutorial-page__section">
        <div className="tutorial-page__tip">
          <p>{t.helpText}</p>
        </div>
      </section>

      <section className="tutorial-page__section">
        <a
          href="https://api.cometapi.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="install-page__download-btn"
          style={{ backgroundColor: '#e74c3c' }}
        >
          CometAPI Website
          <ExternalLink size={16} />
        </a>
      </section>
    </div>
  );
}
