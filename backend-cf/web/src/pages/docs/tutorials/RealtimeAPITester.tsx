/**
 * Realtime API Tester Page
 * Interactive tool for testing OpenAI-compatible Realtime API services
 */

import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Play, Square, Trash2 } from 'lucide-react';
import { useI18n, Locale } from '@/lib/i18n';
import './tutorials.scss';

interface Translation {
  pageTitle: string;
  backLink: string;
  overview: string;
  securityWarning: string;
  testInterface: {
    title: string;
    description: string;
    presetServices: string;
    presetDescription: string;
    apiEndpoint: string;
    apiEndpointPlaceholder: string;
    apiEndpointHelper: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    apiKeyHelper: string;
    model: string;
    modelHelper: string;
    runTests: string;
    stopTests: string;
    clearResults: string;
  };
  testSteps: {
    title: string;
    apiKeyValidation: { title: string; testing: string; success: string; failed: string };
    modelAvailability: { title: string; testing: string; success: string; failed: string };
    websocketConnection: { title: string; testing: string; success: string; failed: string };
    sessionCreation: { title: string; testing: string; success: string; failed: string };
    messageTest: { title: string; testing: string; success: string; failed: string };
  };
  connectionLog: string;
  testSummary: {
    allPassed: string;
    someFailed: string;
    checkList: string;
  };
  troubleshooting: string[];
  howItWorks: {
    title: string;
    description: string;
    steps: string[];
  };
  supportedServices: {
    title: string;
    description: string;
    list: string[];
  };
  securityNote: {
    title: string;
    content: string;
  };
}

const translations: Record<Locale, Translation> = {
  en: {
    pageTitle: 'Realtime API Tester',
    backLink: 'Back to AI Providers',
    overview: 'This tool allows you to test the availability and functionality of OpenAI\'s Realtime API and OpenAI-compatible services. You can verify API key permissions, test WebSocket connectivity, and send test messages to ensure everything is working correctly.',
    securityWarning: 'Security Warning: This tester runs in your browser and exposes your API key in the WebSocket connection. This method is ONLY for testing purposes and should NEVER be used in production. For production use, implement a secure relay server to handle authentication.',
    testInterface: {
      title: 'Test Interface',
      description: 'Configure your API endpoint and key to test the realtime service availability.',
      presetServices: 'Preset Services',
      presetDescription: 'Click to quickly fill in common service endpoints:',
      apiEndpoint: 'API Endpoint',
      apiEndpointPlaceholder: 'e.g., https://api.openai.com',
      apiEndpointHelper: 'The base URL of the API service (without /v1 or paths)',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHelper: 'Your API key for authentication',
      model: 'Model',
      modelHelper: 'Select the realtime model to test',
      runTests: 'Run Tests',
      stopTests: 'Stop Tests',
      clearResults: 'Clear Results',
    },
    testSteps: {
      title: 'Test Steps',
      apiKeyValidation: {
        title: 'API Key Validation',
        testing: 'Validating API key format and permissions...',
        success: 'API key is valid and has required permissions',
        failed: 'API key validation failed',
      },
      modelAvailability: {
        title: 'Model Availability',
        testing: 'Checking if realtime models are available...',
        success: 'Realtime models found: ',
        failed: 'No realtime models available',
      },
      websocketConnection: {
        title: 'WebSocket Connection',
        testing: 'Establishing WebSocket connection to realtime API...',
        success: 'WebSocket connection established successfully',
        failed: 'WebSocket connection failed',
      },
      sessionCreation: {
        title: 'Session Creation',
        testing: 'Creating realtime session...',
        success: 'Session created successfully',
        failed: 'Session creation failed',
      },
      messageTest: {
        title: 'Message Test',
        testing: 'Sending test message and waiting for response...',
        success: 'Received response: ',
        failed: 'No response received or message test failed',
      },
    },
    connectionLog: 'Connection Log',
    testSummary: {
      allPassed: 'All tests passed! The realtime API is fully functional.',
      someFailed: 'Some tests failed. Please review the errors above and check your configuration.',
      checkList: 'Checklist for troubleshooting:',
    },
    troubleshooting: [
      'Verify your API key is correct and has not expired',
      'Ensure your account has access to realtime models',
      'Check your internet connection and firewall settings',
      'Verify the API endpoint URL is correct',
      'If testing from browser, check for CORS restrictions',
      'Ensure your account has sufficient credits and active billing',
      'Contact your service provider to confirm realtime API is working properly',
    ],
    howItWorks: {
      title: 'How This Tester Works',
      description: 'This tester performs a comprehensive validation of realtime API services through the following steps:',
      steps: [
        'Validates the API key format and checks basic API access',
        'Queries available models to confirm realtime model access',
        'Establishes a WebSocket connection to the realtime endpoint',
        'Creates a session with the realtime API',
        'Sends a test message and validates the response',
      ],
    },
    supportedServices: {
      title: 'Supported Services',
      description: 'This tester works with the following services:',
      list: [
        'OpenAI Realtime API (official)',
        'CometAPI (OpenAI-compatible)',
        'Kizuna AI API (OpenAI-compatible)',
        'Any OpenAI-compatible realtime service',
      ],
    },
    securityNote: {
      title: 'Security Note',
      content: 'This tester uses the \'openai-insecure-api-key\' WebSocket protocol for browser-based testing, which exposes your API key. This is ONLY suitable for testing and development. For production applications, always use a secure relay server to protect your API credentials.',
    },
  },
  zh: {
    pageTitle: '实时 API 测试器',
    backLink: '返回 AI 提供商',
    overview: '此工具允许您测试 OpenAI 实时 API 和 OpenAI 兼容服务的可用性和功能。您可以验证 API 密钥权限、测试 WebSocket 连接并发送测试消息以确保一切正常工作。',
    securityWarning: '安全警告：此测试器在浏览器中运行，会在 WebSocket 连接中暴露您的 API 密钥。此方法仅用于测试目的，绝不应在生产环境中使用。生产环境请实现安全的中继服务器来处理身份验证。',
    testInterface: {
      title: '测试界面',
      description: '配置您的 API 端点和密钥以测试实时服务可用性。',
      presetServices: '预设服务',
      presetDescription: '点击快速填入常见服务端点：',
      apiEndpoint: 'API 端点',
      apiEndpointPlaceholder: '例如：https://api.openai.com',
      apiEndpointHelper: 'API 服务的基础 URL（不含 /v1 或路径）',
      apiKey: 'API 密钥',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHelper: '用于身份验证的 API 密钥',
      model: '模型',
      modelHelper: '选择要测试的实时模型',
      runTests: '运行测试',
      stopTests: '停止测试',
      clearResults: '清除结果',
    },
    testSteps: {
      title: '测试步骤',
      apiKeyValidation: {
        title: 'API 密钥验证',
        testing: '验证 API 密钥格式和权限...',
        success: 'API 密钥有效且具有所需权限',
        failed: 'API 密钥验证失败',
      },
      modelAvailability: {
        title: '模型可用性',
        testing: '检查实时模型是否可用...',
        success: '找到实时模型：',
        failed: '没有可用的实时模型',
      },
      websocketConnection: {
        title: 'WebSocket 连接',
        testing: '建立到实时 API 的 WebSocket 连接...',
        success: 'WebSocket 连接成功建立',
        failed: 'WebSocket 连接失败',
      },
      sessionCreation: {
        title: '会话创建',
        testing: '创建实时会话...',
        success: '会话创建成功',
        failed: '会话创建失败',
      },
      messageTest: {
        title: '消息测试',
        testing: '发送测试消息并等待响应...',
        success: '收到响应：',
        failed: '未收到响应或消息测试失败',
      },
    },
    connectionLog: '连接日志',
    testSummary: {
      allPassed: '所有测试通过！实时 API 功能完全正常。',
      someFailed: '部分测试失败。请查看上述错误并检查您的配置。',
      checkList: '故障排除清单：',
    },
    troubleshooting: [
      '验证您的 API 密钥是否正确且未过期',
      '确保您的账户可以访问实时模型',
      '检查您的网络连接和防火墙设置',
      '验证 API 端点 URL 是否正确',
      '如果从浏览器测试，检查 CORS 限制',
      '确保您的账户有足够的额度和有效的计费',
      '联系您的服务提供商确认实时 API 是否正常工作',
    ],
    howItWorks: {
      title: '测试器工作原理',
      description: '此测试器通过以下步骤对实时 API 服务进行全面验证：',
      steps: [
        '验证 API 密钥格式并检查基本 API 访问',
        '查询可用模型以确认实时模型访问权限',
        '建立到实时端点的 WebSocket 连接',
        '使用实时 API 创建会话',
        '发送测试消息并验证响应',
      ],
    },
    supportedServices: {
      title: '支持的服务',
      description: '此测试器适用于以下服务：',
      list: [
        'OpenAI 实时 API（官方）',
        'CometAPI（OpenAI 兼容）',
        'Kizuna AI API（OpenAI 兼容）',
        '任何 OpenAI 兼容的实时服务',
      ],
    },
    securityNote: {
      title: '安全提示',
      content: '此测试器使用 \'openai-insecure-api-key\' WebSocket 协议进行基于浏览器的测试，这会暴露您的 API 密钥。这仅适用于测试和开发。在生产应用中，请始终使用安全的中继服务器来保护您的 API 凭据。',
    },
  },
  ja: {
    pageTitle: 'リアルタイム API テスター',
    backLink: 'AI プロバイダーに戻る',
    overview: 'このツールを使用して、OpenAI のリアルタイム API と OpenAI 互換サービスの可用性と機能をテストできます。API キーの権限を確認し、WebSocket 接続をテストし、テストメッセージを送信して、すべてが正常に動作していることを確認できます。',
    securityWarning: 'セキュリティ警告：このテスターはブラウザで実行され、WebSocket 接続で API キーが公開されます。この方法はテスト目的のみで、本番環境では絶対に使用しないでください。本番環境では、認証を処理する安全なリレーサーバーを実装してください。',
    testInterface: {
      title: 'テストインターフェース',
      description: 'API エンドポイントとキーを設定して、リアルタイムサービスの可用性をテストします。',
      presetServices: 'プリセットサービス',
      presetDescription: 'クリックして一般的なサービスエンドポイントをすばやく入力：',
      apiEndpoint: 'API エンドポイント',
      apiEndpointPlaceholder: '例：https://api.openai.com',
      apiEndpointHelper: 'API サービスのベース URL（/v1 やパスを含まない）',
      apiKey: 'API キー',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHelper: '認証用の API キー',
      model: 'モデル',
      modelHelper: 'テストするリアルタイムモデルを選択',
      runTests: 'テストを実行',
      stopTests: 'テストを停止',
      clearResults: '結果をクリア',
    },
    testSteps: {
      title: 'テスト手順',
      apiKeyValidation: {
        title: 'API キー検証',
        testing: 'API キーの形式と権限を検証中...',
        success: 'API キーは有効で、必要な権限があります',
        failed: 'API キーの検証に失敗しました',
      },
      modelAvailability: {
        title: 'モデルの可用性',
        testing: 'リアルタイムモデルが利用可能か確認中...',
        success: 'リアルタイムモデルが見つかりました：',
        failed: '利用可能なリアルタイムモデルがありません',
      },
      websocketConnection: {
        title: 'WebSocket 接続',
        testing: 'リアルタイム API への WebSocket 接続を確立中...',
        success: 'WebSocket 接続が正常に確立されました',
        failed: 'WebSocket 接続に失敗しました',
      },
      sessionCreation: {
        title: 'セッション作成',
        testing: 'リアルタイムセッションを作成中...',
        success: 'セッションが正常に作成されました',
        failed: 'セッション作成に失敗しました',
      },
      messageTest: {
        title: 'メッセージテスト',
        testing: 'テストメッセージを送信し、応答を待機中...',
        success: '応答を受信しました：',
        failed: '応答が受信されなかったか、メッセージテストに失敗しました',
      },
    },
    connectionLog: '接続ログ',
    testSummary: {
      allPassed: 'すべてのテストに合格しました！リアルタイム API は完全に機能しています。',
      someFailed: '一部のテストが失敗しました。上記のエラーを確認し、設定を確認してください。',
      checkList: 'トラブルシューティングのチェックリスト：',
    },
    troubleshooting: [
      'API キーが正しく、期限切れでないことを確認',
      'アカウントがリアルタイムモデルにアクセスできることを確認',
      'インターネット接続とファイアウォール設定を確認',
      'API エンドポイント URL が正しいことを確認',
      'ブラウザからテストする場合、CORS 制限を確認',
      'アカウントに十分なクレジットとアクティブな請求があることを確認',
      'サービスプロバイダーに連絡してリアルタイム API が正常に動作しているか確認',
    ],
    howItWorks: {
      title: 'テスターの仕組み',
      description: 'このテスターは、次の手順でリアルタイム API サービスの包括的な検証を行います：',
      steps: [
        'API キーの形式を検証し、基本的な API アクセスを確認',
        '利用可能なモデルをクエリしてリアルタイムモデルアクセスを確認',
        'リアルタイムエンドポイントへの WebSocket 接続を確立',
        'リアルタイム API でセッションを作成',
        'テストメッセージを送信し、応答を検証',
      ],
    },
    supportedServices: {
      title: '対応サービス',
      description: 'このテスターは次のサービスで動作します：',
      list: [
        'OpenAI リアルタイム API（公式）',
        'CometAPI（OpenAI 互換）',
        'Kizuna AI API（OpenAI 互換）',
        'OpenAI 互換のリアルタイムサービス',
      ],
    },
    securityNote: {
      title: 'セキュリティ通知',
      content: 'このテスターはブラウザベースのテスト用に \'openai-insecure-api-key\' WebSocket プロトコルを使用し、API キーを公開します。これはテストと開発のみに適しています。本番アプリケーションでは、必ず安全なリレーサーバーを使用して API 認証情報を保護してください。',
    },
  },
  ko: {
    pageTitle: '실시간 API 테스터',
    backLink: 'AI 제공업체로 돌아가기',
    overview: '이 도구를 사용하면 OpenAI의 실시간 API 및 OpenAI 호환 서비스의 가용성과 기능을 테스트할 수 있습니다. API 키 권한을 확인하고, WebSocket 연결을 테스트하고, 테스트 메시지를 보내 모든 것이 올바르게 작동하는지 확인할 수 있습니다.',
    securityWarning: '보안 경고: 이 테스터는 브라우저에서 실행되며 WebSocket 연결에서 API 키가 노출됩니다. 이 방법은 테스트 목적으로만 사용해야 하며 프로덕션에서는 절대 사용하지 마세요. 프로덕션 환경에서는 인증을 처리하는 보안 릴레이 서버를 구현하세요.',
    testInterface: {
      title: '테스트 인터페이스',
      description: '실시간 서비스 가용성을 테스트하려면 API 엔드포인트와 키를 구성하세요.',
      presetServices: '사전 설정 서비스',
      presetDescription: '일반적인 서비스 엔드포인트를 빠르게 입력하려면 클릭:',
      apiEndpoint: 'API 엔드포인트',
      apiEndpointPlaceholder: '예: https://api.openai.com',
      apiEndpointHelper: 'API 서비스의 기본 URL (/v1 또는 경로 제외)',
      apiKey: 'API 키',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHelper: '인증용 API 키',
      model: '모델',
      modelHelper: '테스트할 실시간 모델 선택',
      runTests: '테스트 실행',
      stopTests: '테스트 중지',
      clearResults: '결과 지우기',
    },
    testSteps: {
      title: '테스트 단계',
      apiKeyValidation: {
        title: 'API 키 검증',
        testing: 'API 키 형식 및 권한 검증 중...',
        success: 'API 키가 유효하고 필요한 권한이 있습니다',
        failed: 'API 키 검증 실패',
      },
      modelAvailability: {
        title: '모델 가용성',
        testing: '실시간 모델 사용 가능 여부 확인 중...',
        success: '실시간 모델 발견: ',
        failed: '사용 가능한 실시간 모델 없음',
      },
      websocketConnection: {
        title: 'WebSocket 연결',
        testing: '실시간 API에 WebSocket 연결 설정 중...',
        success: 'WebSocket 연결이 성공적으로 설정되었습니다',
        failed: 'WebSocket 연결 실패',
      },
      sessionCreation: {
        title: '세션 생성',
        testing: '실시간 세션 생성 중...',
        success: '세션이 성공적으로 생성되었습니다',
        failed: '세션 생성 실패',
      },
      messageTest: {
        title: '메시지 테스트',
        testing: '테스트 메시지 전송 및 응답 대기 중...',
        success: '응답 수신: ',
        failed: '응답을 받지 못했거나 메시지 테스트 실패',
      },
    },
    connectionLog: '연결 로그',
    testSummary: {
      allPassed: '모든 테스트 통과! 실시간 API가 완전히 작동합니다.',
      someFailed: '일부 테스트 실패. 위의 오류를 검토하고 구성을 확인하세요.',
      checkList: '문제 해결 체크리스트:',
    },
    troubleshooting: [
      'API 키가 올바르고 만료되지 않았는지 확인',
      '계정이 실시간 모델에 액세스할 수 있는지 확인',
      '인터넷 연결 및 방화벽 설정 확인',
      'API 엔드포인트 URL이 올바른지 확인',
      '브라우저에서 테스트하는 경우 CORS 제한 확인',
      '계정에 충분한 크레딧과 활성 결제가 있는지 확인',
      '서비스 제공자에게 연락하여 실시간 API가 정상 작동하는지 확인',
    ],
    howItWorks: {
      title: '테스터 작동 방식',
      description: '이 테스터는 다음 단계를 통해 실시간 API 서비스를 포괄적으로 검증합니다:',
      steps: [
        'API 키 형식 검증 및 기본 API 액세스 확인',
        '실시간 모델 액세스 확인을 위한 사용 가능한 모델 쿼리',
        '실시간 엔드포인트에 WebSocket 연결 설정',
        '실시간 API로 세션 생성',
        '테스트 메시지 전송 및 응답 검증',
      ],
    },
    supportedServices: {
      title: '지원되는 서비스',
      description: '이 테스터는 다음 서비스에서 작동합니다:',
      list: [
        'OpenAI 실시간 API (공식)',
        'CometAPI (OpenAI 호환)',
        'Kizuna AI API (OpenAI 호환)',
        'OpenAI 호환 실시간 서비스',
      ],
    },
    securityNote: {
      title: '보안 공지',
      content: '이 테스터는 브라우저 기반 테스트를 위해 \'openai-insecure-api-key\' WebSocket 프로토콜을 사용하여 API 키를 노출합니다. 이는 테스트 및 개발에만 적합합니다. 프로덕션 애플리케이션에서는 항상 보안 릴레이 서버를 사용하여 API 자격 증명을 보호하세요.',
    },
  },
};

type StepStatus = 'pending' | 'testing' | 'success' | 'failed';

interface TestStep {
  id: string;
  status: StepStatus;
  details: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

const MODELS = [
  'gpt-4o-realtime-preview',
  'gpt-4o-realtime-preview-2024-12-17',
  'gpt-4o-mini-realtime-preview',
  'gpt-4o-mini-realtime-preview-2024-12-17',
];

const PRESETS = {
  openai: 'https://api.openai.com',
  cometapi: 'https://api.cometapi.com',
  kizunaai: 'https://api.kizuna.ai',
};

export function RealtimeAPITester() {
  const { locale } = useI18n();
  const t = translations[locale] || translations.en;

  const [apiEndpoint, setApiEndpoint] = useState('https://api.openai.com');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-realtime-preview');
  const [isRunning, setIsRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [steps, setSteps] = useState<TestStep[]>([
    { id: 'api-key', status: 'pending', details: '' },
    { id: 'model', status: 'pending', details: '' },
    { id: 'websocket', status: 'pending', details: '' },
    { id: 'session', status: 'pending', details: '' },
    { id: 'message', status: 'pending', details: '' },
  ]);
  const [testSummary, setTestSummary] = useState<{ passed: number; total: number } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const abortedRef = useRef(false);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  }, []);

  const updateStep = useCallback((id: string, status: StepStatus, details = '') => {
    if (abortedRef.current) return;
    setSteps(prev => prev.map(step =>
      step.id === id ? { ...step, status, details } : step
    ));
  }, []);

  const setPreset = (preset: keyof typeof PRESETS) => {
    setApiEndpoint(PRESETS[preset]);
  };

  const runTests = async () => {
    if (!apiEndpoint || !apiKey) {
      alert('Please enter both API endpoint and API key');
      return;
    }

    // Reset state
    abortedRef.current = false;
    setIsRunning(true);
    setShowResults(true);
    setLogs([]);
    setTestSummary(null);
    setSteps([
      { id: 'api-key', status: 'pending', details: '' },
      { id: 'model', status: 'pending', details: '' },
      { id: 'websocket', status: 'pending', details: '' },
      { id: 'session', status: 'pending', details: '' },
      { id: 'message', status: 'pending', details: '' },
    ]);

    const cleanEndpoint = apiEndpoint.replace(/\/+$/, '');
    let passedTests = 0;
    const totalTests = 5;

    try {
      // Step 1: API Key Validation
      updateStep('api-key', 'testing');
      addLog('Starting API key validation...', 'info');

      const modelsResponse = await fetch(`${cleanEndpoint}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!modelsResponse.ok) {
        throw new Error(`API key validation failed: ${modelsResponse.status} ${modelsResponse.statusText}`);
      }

      interface ModelsResponse {
        data: Array<{ id: string }>;
      }

      const modelsData: ModelsResponse = await modelsResponse.json();
      updateStep('api-key', 'success', t.testSteps.apiKeyValidation.success);
      addLog('API key validated successfully', 'success');
      passedTests++;

      if (abortedRef.current) return;

      // Step 2: Model Availability
      updateStep('model', 'testing');
      addLog('Checking for realtime models...', 'info');

      const realtimeModels = modelsData.data.filter(m =>
        m.id.includes('realtime') || m.id === model
      );

      if (realtimeModels.length > 0) {
        const modelNames = realtimeModels.map(m => m.id).join(', ');
        updateStep('model', 'success', t.testSteps.modelAvailability.success + modelNames);
        addLog(`Found ${realtimeModels.length} realtime model(s): ${modelNames}`, 'success');
        passedTests++;
      } else {
        updateStep('model', 'failed', t.testSteps.modelAvailability.failed);
        addLog('No realtime models available', 'error');
      }

      if (abortedRef.current) return;

      // Step 3: WebSocket Connection
      updateStep('websocket', 'testing');
      addLog('Establishing WebSocket connection...', 'info');

      const wsUrl = cleanEndpoint.replace(/^https?:/, 'wss:') + '/v1/realtime?model=' + model;

      wsRef.current = new WebSocket(wsUrl, [
        'realtime',
        `openai-insecure-api-key.${apiKey}`,
        'openai-beta.realtime-v1'
      ]);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        wsRef.current!.onopen = () => {
          clearTimeout(timeout);
          updateStep('websocket', 'success', t.testSteps.websocketConnection.success);
          addLog('WebSocket connection established', 'success');
          passedTests++;
          resolve();
        };

        wsRef.current!.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };
      });

      if (abortedRef.current) return;

      // Step 4: Session Creation
      updateStep('session', 'testing');
      addLog('Creating realtime session...', 'info');

      let sessionCreated = false;
      let messageResponseReceived = false;

      wsRef.current!.onmessage = (event) => {
        const data = JSON.parse(event.data);
        addLog(`Received: ${data.type}`, 'info');

        if (data.type === 'error') {
          const errorMsg = data.error?.message || 'Unknown error';
          addLog(`Error: ${errorMsg}`, 'error');
          if (!sessionCreated) {
            updateStep('session', 'failed', `Error: ${errorMsg}`);
          }
        } else if (data.type === 'session.created') {
          sessionCreated = true;
          updateStep('session', 'success', t.testSteps.sessionCreation.success);
          addLog('Session created with ID: ' + data.session.id, 'success');
        } else if (data.type === 'response.done' || data.type === 'response.text.done') {
          messageResponseReceived = true;
          let responseText = 'Response received';

          if (data.response?.output && Array.isArray(data.response.output)) {
            for (const output of data.response.output) {
              if (output.content && Array.isArray(output.content)) {
                const textContent = output.content.find((c: { text?: string; transcript?: string }) => c.text || c.transcript);
                if (textContent) {
                  responseText = textContent.text || textContent.transcript || responseText;
                  break;
                }
              } else if (output.text) {
                responseText = output.text;
                break;
              } else if (output.transcript) {
                responseText = output.transcript;
                break;
              }
            }
          }

          updateStep('message', 'success', t.testSteps.messageTest.success + responseText);
          addLog('Received response: ' + responseText, 'success');
        }
      };

      // Wait for session creation
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (sessionCreated || abortedRef.current) {
            clearInterval(checkInterval);
            if (sessionCreated) passedTests++;
            resolve();
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          if (!sessionCreated && !abortedRef.current) {
            updateStep('session', 'failed', t.testSteps.sessionCreation.failed);
            addLog('Session creation timeout', 'error');
          }
          resolve();
        }, 5000);
      });

      if (abortedRef.current || !sessionCreated) {
        setTestSummary({ passed: passedTests, total: totalTests });
        return;
      }

      // Step 5: Message Test
      updateStep('message', 'testing');
      addLog('Sending test message...', 'info');

      const testMessage = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello! Please respond with a simple greeting.' }]
        }
      };

      wsRef.current!.send(JSON.stringify(testMessage));
      addLog('Sent test message', 'info');

      wsRef.current!.send(JSON.stringify({ type: 'response.create' }));

      // Wait for response
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (messageResponseReceived || abortedRef.current) {
            clearInterval(checkInterval);
            if (messageResponseReceived) passedTests++;
            resolve();
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          if (!messageResponseReceived && !abortedRef.current) {
            updateStep('message', 'failed', t.testSteps.messageTest.failed);
            addLog('No response received within timeout', 'error');
          }
          resolve();
        }, 10000);
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Error: ${errorMessage}`, 'error');

      // Update the step that failed
      const testingStep = steps.find(s => s.status === 'testing');
      if (testingStep) {
        updateStep(testingStep.id, 'failed', errorMessage);
      }
    } finally {
      // Clean up
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
        addLog('WebSocket connection closed', 'info');
      }

      if (!abortedRef.current) {
        setTestSummary({ passed: passedTests, total: totalTests });
      }

      setIsRunning(false);
    }
  };

  const stopTests = () => {
    abortedRef.current = true;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    setIsRunning(false);
    addLog('Tests aborted by user', 'error');
  };

  const clearResults = () => {
    setShowResults(false);
    setLogs([]);
    setTestSummary(null);
    setSteps([
      { id: 'api-key', status: 'pending', details: '' },
      { id: 'model', status: 'pending', details: '' },
      { id: 'websocket', status: 'pending', details: '' },
      { id: 'session', status: 'pending', details: '' },
      { id: 'message', status: 'pending', details: '' },
    ]);
  };

  const getStepTitle = (id: string): string => {
    switch (id) {
      case 'api-key': return t.testSteps.apiKeyValidation.title;
      case 'model': return t.testSteps.modelAvailability.title;
      case 'websocket': return t.testSteps.websocketConnection.title;
      case 'session': return t.testSteps.sessionCreation.title;
      case 'message': return t.testSteps.messageTest.title;
      default: return '';
    }
  };

  return (
    <div className="docs-content tutorial-page">
      <Link to="/docs/ai-providers" className="tutorial-page__back-link">
        <ArrowLeft size={16} />
        {t.backLink}
      </Link>

      <h1>{t.pageTitle}</h1>

      <section className="tutorial-page__section">
        <p>{t.overview}</p>
        <div className="tutorial-page__tip" style={{ borderLeftColor: '#e74c3c', backgroundColor: '#fff3cd' }}>
          <p><strong>{t.securityWarning}</strong></p>
        </div>
      </section>

      <section className="tutorial-page__section">
        <h2>{t.testInterface.title}</h2>
        <div className="api-tester">
          <p>{t.testInterface.description}</p>

          <div className="api-tester__field">
            <label>{t.testInterface.presetServices}</label>
            <p className="api-tester__helper">{t.testInterface.presetDescription}</p>
            <div className="api-tester__presets">
              <button type="button" onClick={() => setPreset('openai')}>OpenAI</button>
              <button type="button" onClick={() => setPreset('cometapi')}>CometAPI</button>
              <button type="button" onClick={() => setPreset('kizunaai')}>Kizuna AI</button>
            </div>
          </div>

          <div className="api-tester__field">
            <label htmlFor="apiEndpoint">{t.testInterface.apiEndpoint}</label>
            <input
              type="text"
              id="apiEndpoint"
              value={apiEndpoint}
              onChange={(e) => setApiEndpoint(e.target.value)}
              placeholder={t.testInterface.apiEndpointPlaceholder}
            />
            <p className="api-tester__helper">{t.testInterface.apiEndpointHelper}</p>
          </div>

          <div className="api-tester__field">
            <label htmlFor="apiKey">{t.testInterface.apiKey}</label>
            <input
              type="password"
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t.testInterface.apiKeyPlaceholder}
              onKeyPress={(e) => e.key === 'Enter' && !isRunning && runTests()}
            />
            <p className="api-tester__helper">{t.testInterface.apiKeyHelper}</p>
          </div>

          <div className="api-tester__field">
            <label htmlFor="model">{t.testInterface.model}</label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <p className="api-tester__helper">{t.testInterface.modelHelper}</p>
          </div>

          <div className="api-tester__actions">
            {!isRunning ? (
              <button type="button" className="api-tester__btn api-tester__btn--primary" onClick={runTests}>
                <Play size={16} />
                {t.testInterface.runTests}
              </button>
            ) : (
              <button type="button" className="api-tester__btn api-tester__btn--danger" onClick={stopTests}>
                <Square size={16} />
                {t.testInterface.stopTests}
              </button>
            )}
            {showResults && (
              <button type="button" className="api-tester__btn" onClick={clearResults}>
                <Trash2 size={16} />
                {t.testInterface.clearResults}
              </button>
            )}
          </div>
        </div>
      </section>

      {showResults && (
        <section className="tutorial-page__section">
          <h2>{t.testSteps.title}</h2>
          <div className="api-tester__results">
            {steps.map((step, index) => (
              <div key={step.id} className={`api-tester__step api-tester__step--${step.status}`}>
                <div className="api-tester__step-title">
                  {index + 1}. {getStepTitle(step.id)}
                </div>
                {step.details && (
                  <div className="api-tester__step-details">{step.details}</div>
                )}
              </div>
            ))}

            <h3>{t.connectionLog}</h3>
            <div className="api-tester__log">
              {logs.map((log, index) => (
                <div key={index} className={`api-tester__log-entry api-tester__log-entry--${log.type}`}>
                  [{log.timestamp}] {log.message}
                </div>
              ))}
            </div>

            {testSummary && (
              <div className={`api-tester__summary api-tester__summary--${testSummary.passed === testSummary.total ? 'success' : 'failed'}`}>
                {testSummary.passed === testSummary.total ? (
                  <p>{t.testSummary.allPassed}</p>
                ) : (
                  <>
                    <p>{t.testSummary.someFailed}</p>
                    <p><strong>{t.testSummary.checkList}</strong></p>
                    <ul>
                      {t.troubleshooting.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="tutorial-page__section">
        <h2>{t.howItWorks.title}</h2>
        <div className="tutorial-page__step">
          <p>{t.howItWorks.description}</p>
          <ol>
            {t.howItWorks.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="tutorial-page__section">
        <h2>{t.supportedServices.title}</h2>
        <div className="tutorial-page__step">
          <p>{t.supportedServices.description}</p>
          <ul>
            {t.supportedServices.list.map((service, index) => (
              <li key={index}>{service}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="tutorial-page__section">
        <div className="tutorial-page__tip">
          <h4>{t.securityNote.title}</h4>
          <p>{t.securityNote.content}</p>
        </div>
      </section>
    </div>
  );
}
