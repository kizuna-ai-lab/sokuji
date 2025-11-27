/**
 * OpenAI Setup Tutorial Page
 * Includes API key verification tool
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useI18n, Locale } from '@/lib/i18n';
import { Lightbox } from '@/components/docs/Lightbox';
import './tutorials.scss';

interface Translation {
  pageTitle: string;
  backLink: string;
  overview: { title: string; content: string };
  requirements: { title: string; items: string[] };
  apiKeyVerifier: {
    title: string;
    description: string;
    inputLabel: string;
    inputPlaceholder: string;
    verifyButton: string;
    clearButton: string;
    verifying: string;
    results: {
      title: string;
      valid: string;
      invalid: string;
      realtimeAccess: string;
      whisperAccess: string;
      checking: string;
    };
    summary: {
      ready: string;
      notReady: string;
    };
  };
  steps: {
    createAccount: { title: string; content: string };
    getApiKey: { title: string; content: string };
    addCredits: { title: string; content: string };
    configureInApp: { title: string; content: string };
  };
  tips: { title: string; items: string[] };
  troubleshooting: { title: string; content: string };
}

const translations: Record<Locale, Translation> = {
  en: {
    pageTitle: 'OpenAI Setup Tutorial',
    backLink: 'Back to AI Providers',
    overview: {
      title: 'Overview',
      content: 'This guide will help you set up OpenAI for use with Sokuji. OpenAI provides powerful AI models including the Realtime API for real-time speech translation.',
    },
    requirements: {
      title: 'Requirements',
      items: [
        'OpenAI account (create one at platform.openai.com)',
        'Payment method added to your OpenAI account',
        'API credits (minimum $5 recommended)',
        'Realtime API access (included with paid accounts)',
      ],
    },
    apiKeyVerifier: {
      title: 'API Key Verification Tool',
      description: 'Paste your OpenAI API key below to verify it has the required permissions for Sokuji.',
      inputLabel: 'OpenAI API Key',
      inputPlaceholder: 'sk-...',
      verifyButton: 'Verify API Key',
      clearButton: 'Clear',
      verifying: 'Verifying...',
      results: {
        title: 'Verification Results',
        valid: 'API Key is valid',
        invalid: 'API Key is invalid',
        realtimeAccess: 'Realtime API access',
        whisperAccess: 'Whisper API access',
        checking: 'Checking...',
      },
      summary: {
        ready: 'Your API key is ready to use with Sokuji!',
        notReady: 'Your API key needs additional permissions or credits.',
      },
    },
    steps: {
      createAccount: {
        title: 'Step 1: Create an OpenAI Account',
        content: 'Go to <a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer">platform.openai.com</a> and sign up for an account. You can use your email or sign in with Google/Microsoft.',
      },
      getApiKey: {
        title: 'Step 2: Generate an API Key',
        content: 'Navigate to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">API Keys</a> in your OpenAI dashboard. Click "Create new secret key", give it a name (e.g., "Sokuji"), and copy the key. Make sure to save it securely as you won\'t be able to see it again.',
      },
      addCredits: {
        title: 'Step 3: Add Credits to Your Account',
        content: 'Go to <a href="https://platform.openai.com/account/billing" target="_blank" rel="noopener noreferrer">Billing</a> and add a payment method. We recommend adding at least $5-10 in credits to start. The Realtime API costs approximately $0.06 per minute of audio.',
      },
      configureInApp: {
        title: 'Step 4: Configure in Sokuji',
        content: 'Open Sokuji and go to Settings. Select "OpenAI" as your AI provider and paste your API key in the API Key field. Click "Verify" to ensure the key is working correctly.',
      },
    },
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Monitor your usage in the OpenAI dashboard to avoid unexpected charges',
        'Set up usage limits in your OpenAI account settings',
        'The Realtime API provides the best quality for real-time translation',
        'Keep your API key secure and never share it publicly',
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: 'If you encounter issues, check your API key permissions, ensure you have sufficient credits, and verify Realtime API access is enabled. Visit <a href="https://platform.openai.com/docs" target="_blank" rel="noopener noreferrer">OpenAI Documentation</a> for more help.',
    },
  },
  zh: {
    pageTitle: 'OpenAI 设置教程',
    backLink: '返回 AI 提供商',
    overview: {
      title: '概述',
      content: '本指南将帮助您设置 OpenAI 以与 Sokuji 配合使用。OpenAI 提供强大的 AI 模型，包括用于实时语音翻译的 Realtime API。',
    },
    requirements: {
      title: '要求',
      items: [
        'OpenAI 账户（在 platform.openai.com 创建）',
        '在您的 OpenAI 账户中添加付款方式',
        'API 额度（建议至少 $5）',
        'Realtime API 访问权限（付费账户包含）',
      ],
    },
    apiKeyVerifier: {
      title: 'API Key 验证工具',
      description: '将您的 OpenAI API Key 粘贴到下方，以验证它是否具有 Sokuji 所需的权限。',
      inputLabel: 'OpenAI API Key',
      inputPlaceholder: 'sk-...',
      verifyButton: '验证 API Key',
      clearButton: '清除',
      verifying: '验证中...',
      results: {
        title: '验证结果',
        valid: 'API Key 有效',
        invalid: 'API Key 无效',
        realtimeAccess: 'Realtime API 访问权限',
        whisperAccess: 'Whisper API 访问权限',
        checking: '检查中...',
      },
      summary: {
        ready: '您的 API Key 已准备好在 Sokuji 中使用！',
        notReady: '您的 API Key 需要额外的权限或额度。',
      },
    },
    steps: {
      createAccount: {
        title: '步骤 1：创建 OpenAI 账户',
        content: '访问 <a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer">platform.openai.com</a> 并注册账户。您可以使用电子邮件或通过 Google/Microsoft 登录。',
      },
      getApiKey: {
        title: '步骤 2：生成 API Key',
        content: '在 OpenAI 仪表板中导航到 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">API Keys</a>。点击"创建新密钥"，为其命名（例如"Sokuji"），然后复制密钥。请确保安全保存，因为您将无法再次查看它。',
      },
      addCredits: {
        title: '步骤 3：向账户添加额度',
        content: '访问 <a href="https://platform.openai.com/account/billing" target="_blank" rel="noopener noreferrer">账单</a> 并添加付款方式。我们建议开始时至少添加 $5-10 的额度。Realtime API 每分钟音频大约花费 $0.06。',
      },
      configureInApp: {
        title: '步骤 4：在 Sokuji 中配置',
        content: '打开 Sokuji 并进入设置。选择"OpenAI"作为您的 AI 提供商，并在 API Key 字段中粘贴您的密钥。点击"验证"以确保密钥正常工作。',
      },
    },
    tips: {
      title: '最佳使用建议',
      items: [
        '在 OpenAI 仪表板中监控您的使用情况，以避免意外费用',
        '在 OpenAI 账户设置中设置使用限制',
        'Realtime API 为实时翻译提供最佳质量',
        '保护您的 API Key 安全，切勿公开分享',
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content: '如果遇到问题，请检查您的 API Key 权限，确保有足够的额度，并验证 Realtime API 访问已启用。访问 <a href="https://platform.openai.com/docs" target="_blank" rel="noopener noreferrer">OpenAI 文档</a> 获取更多帮助。',
    },
  },
  ja: {
    pageTitle: 'OpenAI セットアップチュートリアル',
    backLink: 'AI プロバイダーに戻る',
    overview: {
      title: '概要',
      content: 'このガイドでは、Sokuji で使用するための OpenAI のセットアップを説明します。OpenAI は、リアルタイム音声翻訳用の Realtime API を含む強力な AI モデルを提供しています。',
    },
    requirements: {
      title: '要件',
      items: [
        'OpenAI アカウント（platform.openai.com で作成）',
        'OpenAI アカウントに支払い方法を追加',
        'API クレジット（最低 $5 推奨）',
        'Realtime API アクセス（有料アカウントに含まれる）',
      ],
    },
    apiKeyVerifier: {
      title: 'API キー検証ツール',
      description: 'OpenAI API キーを以下に貼り付けて、Sokuji に必要な権限があるか確認します。',
      inputLabel: 'OpenAI API キー',
      inputPlaceholder: 'sk-...',
      verifyButton: 'API キーを検証',
      clearButton: 'クリア',
      verifying: '検証中...',
      results: {
        title: '検証結果',
        valid: 'API キーは有効です',
        invalid: 'API キーは無効です',
        realtimeAccess: 'Realtime API アクセス',
        whisperAccess: 'Whisper API アクセス',
        checking: '確認中...',
      },
      summary: {
        ready: 'API キーは Sokuji で使用する準備ができています！',
        notReady: 'API キーには追加の権限またはクレジットが必要です。',
      },
    },
    steps: {
      createAccount: {
        title: 'ステップ 1: OpenAI アカウントを作成',
        content: '<a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer">platform.openai.com</a> にアクセスしてアカウントを登録します。メールまたは Google/Microsoft でサインインできます。',
      },
      getApiKey: {
        title: 'ステップ 2: API キーを生成',
        content: 'OpenAI ダッシュボードで <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">API キー</a> に移動します。「新しいシークレットキーを作成」をクリックし、名前を付けて（例：「Sokuji」）、キーをコピーします。再度表示できないため、安全に保存してください。',
      },
      addCredits: {
        title: 'ステップ 3: アカウントにクレジットを追加',
        content: '<a href="https://platform.openai.com/account/billing" target="_blank" rel="noopener noreferrer">請求</a> にアクセスして支払い方法を追加します。開始時には少なくとも $5-10 のクレジットを追加することをお勧めします。Realtime API は音声 1 分あたり約 $0.06 かかります。',
      },
      configureInApp: {
        title: 'ステップ 4: Sokuji で設定',
        content: 'Sokuji を開いて設定に移動します。AI プロバイダーとして「OpenAI」を選択し、API キーフィールドにキーを貼り付けます。「検証」をクリックしてキーが正常に動作することを確認します。',
      },
    },
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        '予期しない請求を避けるために OpenAI ダッシュボードで使用状況を監視する',
        'OpenAI アカウント設定で使用制限を設定する',
        'Realtime API はリアルタイム翻訳に最高の品質を提供します',
        'API キーを安全に保ち、公開しないでください',
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content: '問題が発生した場合は、API キーの権限を確認し、十分なクレジットがあることを確認し、Realtime API アクセスが有効になっていることを確認してください。詳細は <a href="https://platform.openai.com/docs" target="_blank" rel="noopener noreferrer">OpenAI ドキュメント</a> を参照してください。',
    },
  },
  ko: {
    pageTitle: 'OpenAI 설정 튜토리얼',
    backLink: 'AI 제공업체로 돌아가기',
    overview: {
      title: '개요',
      content: '이 가이드는 Sokuji와 함께 사용하기 위한 OpenAI 설정을 도와드립니다. OpenAI는 실시간 음성 번역을 위한 Realtime API를 포함한 강력한 AI 모델을 제공합니다.',
    },
    requirements: {
      title: '요구사항',
      items: [
        'OpenAI 계정 (platform.openai.com에서 생성)',
        'OpenAI 계정에 결제 방법 추가',
        'API 크레딧 (최소 $5 권장)',
        'Realtime API 액세스 (유료 계정에 포함)',
      ],
    },
    apiKeyVerifier: {
      title: 'API 키 확인 도구',
      description: 'OpenAI API 키를 아래에 붙여넣어 Sokuji에 필요한 권한이 있는지 확인하세요.',
      inputLabel: 'OpenAI API 키',
      inputPlaceholder: 'sk-...',
      verifyButton: 'API 키 확인',
      clearButton: '지우기',
      verifying: '확인 중...',
      results: {
        title: '확인 결과',
        valid: 'API 키가 유효합니다',
        invalid: 'API 키가 유효하지 않습니다',
        realtimeAccess: 'Realtime API 액세스',
        whisperAccess: 'Whisper API 액세스',
        checking: '확인 중...',
      },
      summary: {
        ready: 'API 키가 Sokuji에서 사용할 준비가 되었습니다!',
        notReady: 'API 키에 추가 권한 또는 크레딧이 필요합니다.',
      },
    },
    steps: {
      createAccount: {
        title: '1단계: OpenAI 계정 만들기',
        content: '<a href="https://platform.openai.com" target="_blank" rel="noopener noreferrer">platform.openai.com</a>에 접속하여 계정을 등록하세요. 이메일 또는 Google/Microsoft로 로그인할 수 있습니다.',
      },
      getApiKey: {
        title: '2단계: API 키 생성',
        content: 'OpenAI 대시보드에서 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">API 키</a>로 이동합니다. "새 비밀 키 만들기"를 클릭하고 이름을 지정한 다음(예: "Sokuji") 키를 복사합니다. 다시 볼 수 없으므로 안전하게 저장하세요.',
      },
      addCredits: {
        title: '3단계: 계정에 크레딧 추가',
        content: '<a href="https://platform.openai.com/account/billing" target="_blank" rel="noopener noreferrer">결제</a>로 이동하여 결제 방법을 추가합니다. 시작 시 최소 $5-10의 크레딧을 추가하는 것이 좋습니다. Realtime API는 오디오 1분당 약 $0.06입니다.',
      },
      configureInApp: {
        title: '4단계: Sokuji에서 구성',
        content: 'Sokuji를 열고 설정으로 이동합니다. AI 제공업체로 "OpenAI"를 선택하고 API 키 필드에 키를 붙여넣습니다. "확인"을 클릭하여 키가 올바르게 작동하는지 확인합니다.',
      },
    },
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '예상치 못한 요금을 피하기 위해 OpenAI 대시보드에서 사용량 모니터링',
        'OpenAI 계정 설정에서 사용 한도 설정',
        'Realtime API는 실시간 번역에 최고의 품질을 제공합니다',
        'API 키를 안전하게 보관하고 공개적으로 공유하지 마세요',
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content: '문제가 발생하면 API 키 권한을 확인하고, 충분한 크레딧이 있는지 확인하고, Realtime API 액세스가 활성화되어 있는지 확인하세요. 자세한 내용은 <a href="https://platform.openai.com/docs" target="_blank" rel="noopener noreferrer">OpenAI 문서</a>를 참조하세요.',
    },
  },
};

export function OpenAISetup() {
  const { locale } = useI18n();
  const t = translations[locale] || translations.en;

  const [apiKey, setApiKey] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    valid: boolean | null;
    realtime: boolean | null;
    whisper: boolean | null;
  } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const handleVerify = async () => {
    if (!apiKey.trim()) return;

    setVerifying(true);
    setVerificationResult({ valid: null, realtime: null, whisper: null });

    try {
      // Check API key validity with a simple models list call
      const modelsResponse = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const isValid = modelsResponse.ok;
      setVerificationResult((prev) => ({ ...prev!, valid: isValid }));

      if (isValid) {
        // Check for realtime access - look for gpt-4o-realtime models
        const modelsData = await modelsResponse.json();
        const hasRealtime = modelsData.data?.some((model: { id: string }) =>
          model.id.includes('realtime')
        );
        setVerificationResult((prev) => ({ ...prev!, realtime: hasRealtime }));

        // Check for whisper access
        const hasWhisper = modelsData.data?.some((model: { id: string }) =>
          model.id.includes('whisper')
        );
        setVerificationResult((prev) => ({ ...prev!, whisper: hasWhisper }));
      } else {
        setVerificationResult({ valid: false, realtime: false, whisper: false });
      }
    } catch {
      setVerificationResult({ valid: false, realtime: false, whisper: false });
    } finally {
      setVerifying(false);
    }
  };

  const handleClear = () => {
    setApiKey('');
    setVerificationResult(null);
  };

  const renderResultIcon = (value: boolean | null) => {
    if (value === null) return <Loader2 size={16} className="animate-spin" />;
    return value ? (
      <CheckCircle size={16} className="text-green-500" />
    ) : (
      <XCircle size={16} className="text-red-500" />
    );
  };

  return (
    <div className="docs-content tutorial-page">
      <Link to="/docs/ai-providers" className="tutorial-page__back-link">
        <ArrowLeft size={16} />
        {t.backLink}
      </Link>

      <h1>{t.pageTitle}</h1>

      {/* Overview */}
      <section className="tutorial-page__section">
        <h2>{t.overview.title}</h2>
        <p>{t.overview.content}</p>
      </section>

      {/* Requirements */}
      <section className="tutorial-page__section">
        <h2>{t.requirements.title}</h2>
        <ul>
          {t.requirements.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {/* API Key Verifier */}
      <section className="tutorial-page__section">
        <h2>{t.apiKeyVerifier.title}</h2>
        <p>{t.apiKeyVerifier.description}</p>

        <div className="api-key-verifier">
          <div className="api-key-verifier__input-group">
            <label htmlFor="api-key">{t.apiKeyVerifier.inputLabel}</label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t.apiKeyVerifier.inputPlaceholder}
            />
          </div>

          <div className="api-key-verifier__buttons">
            <button
              className="api-key-verifier__btn api-key-verifier__btn--primary"
              onClick={handleVerify}
              disabled={verifying || !apiKey.trim()}
            >
              {verifying ? t.apiKeyVerifier.verifying : t.apiKeyVerifier.verifyButton}
            </button>
            <button className="api-key-verifier__btn api-key-verifier__btn--secondary" onClick={handleClear}>
              {t.apiKeyVerifier.clearButton}
            </button>
          </div>

          {verificationResult && (
            <div className="api-key-verifier__results">
              <h4>{t.apiKeyVerifier.results.title}</h4>
              <div
                className={`api-key-verifier__result ${
                  verificationResult.valid === null
                    ? 'api-key-verifier__result--loading'
                    : verificationResult.valid
                    ? 'api-key-verifier__result--success'
                    : 'api-key-verifier__result--error'
                }`}
              >
                {renderResultIcon(verificationResult.valid)}{' '}
                {verificationResult.valid === null
                  ? t.apiKeyVerifier.results.checking
                  : verificationResult.valid
                  ? t.apiKeyVerifier.results.valid
                  : t.apiKeyVerifier.results.invalid}
              </div>

              {verificationResult.valid && (
                <>
                  <div
                    className={`api-key-verifier__result ${
                      verificationResult.realtime === null
                        ? 'api-key-verifier__result--loading'
                        : verificationResult.realtime
                        ? 'api-key-verifier__result--success'
                        : 'api-key-verifier__result--error'
                    }`}
                  >
                    {renderResultIcon(verificationResult.realtime)} {t.apiKeyVerifier.results.realtimeAccess}
                  </div>
                  <div
                    className={`api-key-verifier__result ${
                      verificationResult.whisper === null
                        ? 'api-key-verifier__result--loading'
                        : verificationResult.whisper
                        ? 'api-key-verifier__result--success'
                        : 'api-key-verifier__result--error'
                    }`}
                  >
                    {renderResultIcon(verificationResult.whisper)} {t.apiKeyVerifier.results.whisperAccess}
                  </div>
                </>
              )}

              {verificationResult.valid !== null && (
                <div
                  className={`api-key-verifier__summary ${
                    verificationResult.valid && verificationResult.realtime
                      ? 'api-key-verifier__summary--success'
                      : 'api-key-verifier__summary--error'
                  }`}
                >
                  {verificationResult.valid && verificationResult.realtime
                    ? t.apiKeyVerifier.summary.ready
                    : t.apiKeyVerifier.summary.notReady}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Steps */}
      <section className="tutorial-page__section">
        <div className="tutorial-page__step">
          <h3>
            <span className="tutorial-page__step-number">1</span>
            {t.steps.createAccount.title.replace('Step 1: ', '').replace('步骤 1：', '').replace('ステップ 1: ', '').replace('1단계: ', '')}
          </h3>
          <p dangerouslySetInnerHTML={{ __html: t.steps.createAccount.content }} />
          <img
            src="/tutorials/openai-setup/1.png"
            alt="OpenAI Sign Up"
            className="tutorial-page__screenshot"
            onClick={() => setLightboxImage({ src: '/tutorials/openai-setup/1.png', alt: 'OpenAI Sign Up' })}
          />
        </div>

        <div className="tutorial-page__step">
          <h3>
            <span className="tutorial-page__step-number">2</span>
            {t.steps.getApiKey.title.replace('Step 2: ', '').replace('步骤 2：', '').replace('ステップ 2: ', '').replace('2단계: ', '')}
          </h3>
          <p dangerouslySetInnerHTML={{ __html: t.steps.getApiKey.content }} />
          <img
            src="/tutorials/openai-setup/2.png"
            alt="Generate API Key"
            className="tutorial-page__screenshot"
            onClick={() => setLightboxImage({ src: '/tutorials/openai-setup/2.png', alt: 'Generate API Key' })}
          />
        </div>

        <div className="tutorial-page__step">
          <h3>
            <span className="tutorial-page__step-number">3</span>
            {t.steps.addCredits.title.replace('Step 3: ', '').replace('步骤 3：', '').replace('ステップ 3: ', '').replace('3단계: ', '')}
          </h3>
          <p dangerouslySetInnerHTML={{ __html: t.steps.addCredits.content }} />
          <img
            src="/tutorials/openai-setup/credit-balance.png"
            alt="Add Credits"
            className="tutorial-page__screenshot"
            onClick={() =>
              setLightboxImage({ src: '/tutorials/openai-setup/credit-balance.png', alt: 'Add Credits' })
            }
          />
        </div>

        <div className="tutorial-page__step">
          <h3>
            <span className="tutorial-page__step-number">4</span>
            {t.steps.configureInApp.title.replace('Step 4: ', '').replace('步骤 4：', '').replace('ステップ 4: ', '').replace('4단계: ', '')}
          </h3>
          <p dangerouslySetInnerHTML={{ __html: t.steps.configureInApp.content }} />
        </div>
      </section>

      {/* Tips */}
      <section className="tutorial-page__section">
        <div className="tutorial-page__tip">
          <h4>{t.tips.title}</h4>
          <ul>
            {t.tips.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="tutorial-page__section">
        <h2>{t.troubleshooting.title}</h2>
        <p dangerouslySetInnerHTML={{ __html: t.troubleshooting.content }} />
      </section>

      {/* External Link */}
      <section className="tutorial-page__section">
        <a
          href="https://platform.openai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="install-page__download-btn"
        >
          OpenAI Platform
          <ExternalLink size={16} />
        </a>
      </section>

      {/* Lightbox */}
      {lightboxImage && (
        <Lightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          isOpen={!!lightboxImage}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}
