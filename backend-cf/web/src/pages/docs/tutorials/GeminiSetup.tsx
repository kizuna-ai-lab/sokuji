/**
 * Google Gemini Setup Tutorial Page
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useI18n, Locale } from '@/lib/i18n';
import './tutorials.scss';

interface Translation {
  pageTitle: string;
  backLink: string;
  overview: { title: string; content: string };
  steps: { title: string; content: string }[];
  tips: { title: string; items: string[] };
  troubleshooting: { title: string; content: string };
}

const translations: Record<Locale, Translation> = {
  en: {
    pageTitle: 'Google Gemini Setup Tutorial',
    backLink: 'Back to AI Providers',
    overview: {
      title: 'Overview',
      content: 'This guide will help you set up Google Gemini for use with Sokuji. Google Gemini provides powerful AI models with competitive pricing for real-time translation.',
    },
    steps: [
      { title: 'Create a Google Cloud Account', content: 'Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create an account or sign in with your existing Google account.' },
      { title: 'Enable the Gemini API', content: 'Navigate to the API Library and search for "Gemini API" or "Generative Language API". Click Enable to activate it for your project.' },
      { title: 'Create API Credentials', content: 'Go to APIs & Services > Credentials. Click "Create Credentials" and select "API Key". Copy the generated key and store it securely.' },
      { title: 'Configure in Sokuji', content: 'Open Sokuji settings, select "Google Gemini" as your AI provider, and paste your API key. Test the connection to ensure it works.' },
    ],
    tips: {
      title: 'Tips for Best Results',
      items: [
        'Set up billing alerts to monitor your usage',
        'Use the Gemini 1.5 Flash model for faster responses',
        'Consider using Gemini 1.5 Pro for higher quality translations',
        'Keep your API key secure and rotate it periodically',
      ],
    },
    troubleshooting: {
      title: 'Troubleshooting',
      content: 'If you encounter issues, verify your API key is correct, ensure billing is enabled on your Google Cloud account, and check that the Gemini API is enabled. Visit <a href="https://ai.google.dev/docs" target="_blank" rel="noopener noreferrer">Google AI Documentation</a> for more help.',
    },
  },
  zh: {
    pageTitle: 'Google Gemini 设置教程',
    backLink: '返回 AI 提供商',
    overview: {
      title: '概述',
      content: '本指南将帮助您设置 Google Gemini 以与 Sokuji 配合使用。Google Gemini 提供具有竞争力价格的强大 AI 模型，用于实时翻译。',
    },
    steps: [
      { title: '创建 Google Cloud 账户', content: '访问 <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> 并创建账户或使用现有的 Google 账户登录。' },
      { title: '启用 Gemini API', content: '导航到 API 库并搜索 "Gemini API" 或 "Generative Language API"。点击启用以为您的项目激活它。' },
      { title: '创建 API 凭据', content: '转到 APIs & Services > 凭据。点击"创建凭据"并选择"API 密钥"。复制生成的密钥并安全存储。' },
      { title: '在 Sokuji 中配置', content: '打开 Sokuji 设置，选择"Google Gemini"作为您的 AI 提供商，并粘贴您的 API 密钥。测试连接以确保正常工作。' },
    ],
    tips: {
      title: '最佳使用建议',
      items: [
        '设置账单提醒以监控您的使用情况',
        '使用 Gemini 1.5 Flash 模型获得更快的响应',
        '考虑使用 Gemini 1.5 Pro 获得更高质量的翻译',
        '保护您的 API 密钥安全并定期轮换',
      ],
    },
    troubleshooting: {
      title: '故障排除',
      content: '如果遇到问题，请验证您的 API 密钥是否正确，确保 Google Cloud 账户已启用计费，并检查 Gemini API 是否已启用。访问 <a href="https://ai.google.dev/docs" target="_blank" rel="noopener noreferrer">Google AI 文档</a> 获取更多帮助。',
    },
  },
  ja: {
    pageTitle: 'Google Gemini セットアップチュートリアル',
    backLink: 'AI プロバイダーに戻る',
    overview: {
      title: '概要',
      content: 'このガイドでは、Sokuji で使用するための Google Gemini のセットアップを説明します。Google Gemini は、リアルタイム翻訳のための競争力のある価格で強力な AI モデルを提供しています。',
    },
    steps: [
      { title: 'Google Cloud アカウントを作成', content: '<a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> にアクセスしてアカウントを作成するか、既存の Google アカウントでサインインします。' },
      { title: 'Gemini API を有効化', content: 'API ライブラリに移動し、「Gemini API」または「Generative Language API」を検索します。有効化をクリックしてプロジェクトでアクティブにします。' },
      { title: 'API 認証情報を作成', content: 'APIs & Services > 認証情報に移動します。「認証情報を作成」をクリックし、「API キー」を選択します。生成されたキーをコピーして安全に保存します。' },
      { title: 'Sokuji で設定', content: 'Sokuji の設定を開き、AI プロバイダーとして「Google Gemini」を選択し、API キーを貼り付けます。接続をテストして正常に動作することを確認します。' },
    ],
    tips: {
      title: '最良の結果を得るためのヒント',
      items: [
        '使用状況を監視するために請求アラートを設定する',
        'より高速な応答のために Gemini 1.5 Flash モデルを使用する',
        'より高品質な翻訳のために Gemini 1.5 Pro の使用を検討する',
        'API キーを安全に保ち、定期的にローテーションする',
      ],
    },
    troubleshooting: {
      title: 'トラブルシューティング',
      content: '問題が発生した場合は、API キーが正しいか確認し、Google Cloud アカウントで請求が有効になっていることを確認し、Gemini API が有効になっていることを確認してください。詳細は <a href="https://ai.google.dev/docs" target="_blank" rel="noopener noreferrer">Google AI ドキュメント</a> を参照してください。',
    },
  },
  ko: {
    pageTitle: 'Google Gemini 설정 튜토리얼',
    backLink: 'AI 제공업체로 돌아가기',
    overview: {
      title: '개요',
      content: '이 가이드는 Sokuji와 함께 사용하기 위한 Google Gemini 설정을 도와드립니다. Google Gemini는 실시간 번역을 위한 경쟁력 있는 가격의 강력한 AI 모델을 제공합니다.',
    },
    steps: [
      { title: 'Google Cloud 계정 만들기', content: '<a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>에 접속하여 계정을 만들거나 기존 Google 계정으로 로그인하세요.' },
      { title: 'Gemini API 활성화', content: 'API 라이브러리로 이동하여 "Gemini API" 또는 "Generative Language API"를 검색합니다. 활성화를 클릭하여 프로젝트에서 활성화합니다.' },
      { title: 'API 자격 증명 만들기', content: 'APIs & Services > 자격 증명으로 이동합니다. "자격 증명 만들기"를 클릭하고 "API 키"를 선택합니다. 생성된 키를 복사하여 안전하게 저장합니다.' },
      { title: 'Sokuji에서 구성', content: 'Sokuji 설정을 열고 AI 제공업체로 "Google Gemini"를 선택하고 API 키를 붙여넣습니다. 연결을 테스트하여 정상 작동하는지 확인합니다.' },
    ],
    tips: {
      title: '최상의 결과를 위한 팁',
      items: [
        '사용량을 모니터링하기 위해 결제 알림 설정',
        '더 빠른 응답을 위해 Gemini 1.5 Flash 모델 사용',
        '더 높은 품질의 번역을 위해 Gemini 1.5 Pro 사용 고려',
        'API 키를 안전하게 보관하고 주기적으로 교체',
      ],
    },
    troubleshooting: {
      title: '문제 해결',
      content: '문제가 발생하면 API 키가 올바른지 확인하고, Google Cloud 계정에서 결제가 활성화되어 있는지 확인하고, Gemini API가 활성화되어 있는지 확인하세요. 자세한 내용은 <a href="https://ai.google.dev/docs" target="_blank" rel="noopener noreferrer">Google AI 문서</a>를 참조하세요.',
    },
  },
};

export function GeminiSetup() {
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
        {t.steps.map((step, index) => (
          <div key={index} className="tutorial-page__step">
            <h3>
              <span className="tutorial-page__step-number">{index + 1}</span>
              {step.title}
            </h3>
            <p dangerouslySetInnerHTML={{ __html: step.content }} />
          </div>
        ))}
      </section>

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

      <section className="tutorial-page__section">
        <h2>{t.troubleshooting.title}</h2>
        <p dangerouslySetInnerHTML={{ __html: t.troubleshooting.content }} />
      </section>

      <section className="tutorial-page__section">
        <a
          href="https://ai.google.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="install-page__download-btn"
        >
          Google AI for Developers
          <ExternalLink size={16} />
        </a>
      </section>
    </div>
  );
}
