/**
 * Japanese translations for documentation pages
 */

const ja: Record<string, string> = {
  // Common
  'common.backToHome': 'ホームに戻る',
  'common.backToDocs': 'ドキュメントに戻る',
  'common.learnMore': '詳細を見る',
  'common.getStarted': '始める',
  'common.viewDocs': 'ドキュメントを見る',
  'common.signIn': 'ログイン',
  'common.signUp': '新規登録',
  'common.dashboard': 'ダッシュボード',
  'common.footer': '2025 Kizuna AI Lab. All rights reserved.',
  'common.language': '言語',

  // Navigation
  'nav.home': 'ホーム',
  'nav.docs': 'ドキュメント',
  'nav.install': 'インストール',
  'nav.platforms': 'プラットフォーム',
  'nav.platformsOverview': '概要',
  'nav.aiProviders': 'AIプロバイダー',
  'nav.providersOverview': '概要',
  'nav.privacy': 'プライバシー',
  'nav.feedback': 'フィードバック',
  'nav.github': 'GitHub',

  // Tutorials
  'tutorials.zoom': 'Zoom',
  'tutorials.googleMeet': 'Google Meet',
  'tutorials.teams': 'Microsoft Teams',
  'tutorials.discord': 'Discord',
  'tutorials.slack': 'Slack',
  'tutorials.whereby': 'Whereby',
  'tutorials.gather': 'Gather',
  'tutorials.openai': 'OpenAI セットアップ',
  'tutorials.gemini': 'Gemini セットアップ',
  'tutorials.palabraai': 'PalabraAI セットアップ',
  'tutorials.cometapi': 'CometAPI セットアップ',
  'tutorials.realtimeTester': 'API テスター',

  // Landing Page
  'landing.title': 'Sokuji',
  'landing.tagline': 'AI駆動のリアルタイム音声翻訳',
  'landing.subtitle': 'AIによるリアルタイム言語通訳。Windows、macOS、Linux向けのブラウザ拡張機能とデスクトップアプリケーションをご利用いただけます。',
  'landing.cta.extension': 'ブラウザ拡張機能を入手',
  'landing.cta.desktop': 'デスクトップアプリをダウンロード',
  'landing.cta.docs': 'ドキュメントを見る',

  // Platform Selection
  'platform.title': 'プラットフォームを選択',
  'platform.extension.title': 'ブラウザ拡張機能',
  'platform.extension.desc': 'オンライン会議向け（Google Meet、Zoom、Teamsなど）',
  'platform.extension.chrome': 'Chrome ウェブストア',
  'platform.extension.edge': 'Edge アドオン',
  'platform.desktop.title': 'デスクトップアプリケーション',
  'platform.desktop.desc': 'すべてのシナリオに対応 - あらゆるウェブサイト、アプリ、システム音声',
  'platform.desktop.windows': 'Windows インストーラー (.exe)',
  'platform.desktop.macos': 'macOS インストーラー (.pkg)',
  'platform.desktop.linux': 'Linux パッケージ (.deb)',

  // Features
  'features.title': '機能',
  'features.realtime.title': 'リアルタイム翻訳',
  'features.realtime.desc': '最小限の遅延で即座に音声翻訳',
  'features.multilang.title': '多言語サポート',
  'features.multilang.desc': '60以上の言語と地域バリアントをサポート',
  'features.providers.title': '複数のAIプロバイダー',
  'features.providers.desc': 'OpenAI、Google Gemini、PalabraAIなどから選択',
  'features.integration.title': 'シームレスな統合',
  'features.integration.desc': 'Google Meet、Zoom、Teams、Discordなどで動作',

  // Installation Guides
  'install.title': 'インストールガイド',
  'install.windows': 'Windows インストールガイド',
  'install.macos': 'macOS インストールガイド',
  'install.linux': 'Linux インストールガイド',

  // Docs Home
  'docs.title': 'ドキュメント',
  'docs.subtitle': 'Sokujiのインストールと使用方法を学ぶ',
  'docs.gettingStarted': 'はじめに',
  'docs.installation': 'インストール',
  'docs.configuration': '設定',
  'docs.resources': 'リソース',

  // Supported Sites
  'sites.title': 'サポートされているウェブサイト',
  'sites.subtitle': 'Sokuji拡張機能は以下のビデオ会議およびコミュニケーションプラットフォームと互換性があります。',
  'sites.howToUse.title': '使用方法',
  'sites.howToUse.desc': 'サポートされているプラットフォームで、プラットフォームのオーディオ設定でマイク入力として「Sokuji Virtual Microphone」を選択するだけです。Sokujiがあなたの音声をリアルタイムで翻訳します。',
  'sites.needHelp.title': 'お困りですか？',
  'sites.needHelp.desc': '特定のプラットフォームで問題が発生した場合は、GitHubリポジトリでトラブルシューティングガイドとサポートをご確認ください。',
  'sites.visitPlatform': 'プラットフォームを開く',
  'sites.tutorial': 'チュートリアル',

  // Site Cards
  'sites.meet.name': 'Google Meet',
  'sites.meet.url': 'meet.google.com',
  'sites.meet.features': 'リアルタイム音声翻訳|仮想マイク統合|シームレスな音声ルーティング',

  'sites.teams.name': 'Microsoft Teams',
  'sites.teams.url': 'teams.live.com / teams.microsoft.com',
  'sites.teams.features': 'リアルタイム音声翻訳|仮想マイク統合|クロスプラットフォーム互換性|個人版とエンタープライズ版',

  'sites.gather.name': 'Gather',
  'sites.gather.url': 'app.gather.town',
  'sites.gather.features': 'リアルタイム音声翻訳|仮想マイク統合|空間オーディオサポート',

  'sites.whereby.name': 'Whereby',
  'sites.whereby.url': 'whereby.com',
  'sites.whereby.features': 'リアルタイム音声翻訳|仮想マイク統合|ブラウザベースの会議',

  'sites.discord.name': 'Discord',
  'sites.discord.url': 'discord.com',
  'sites.discord.features': 'リアルタイム音声翻訳|仮想マイク統合|ボイスチャンネルサポート',

  'sites.slack.name': 'Slack',
  'sites.slack.url': 'app.slack.com',
  'sites.slack.features': 'リアルタイム音声翻訳|仮想マイク統合|Huddlesと通話サポート',

  'sites.zoom.name': 'Zoom',
  'sites.zoom.url': 'app.zoom.us',
  'sites.zoom.features': 'リアルタイム音声翻訳|仮想マイク統合|Webクライアントサポート',

  // AI Providers
  'providers.title': 'サポートされているAIプロバイダー',
  'providers.subtitle': 'Sokujiはリアルタイム音声翻訳のために複数のAIプロバイダーをサポートしています。各プロバイダーは異なる機能、モデル、価格体系を提供しています。',
  'providers.setup.title': 'セットアップ手順',
  'providers.setup.desc': '任意のAIプロバイダーを使用するには、プロバイダーのウェブサイトからAPIキーを取得し、Sokujiの設定パネルで設定してください。',
  'providers.choosing.title': 'プロバイダーの選び方',
  'providers.needHelp.title': 'お困りですか？',
  'providers.needHelp.desc': 'セットアップガイド、トラブルシューティング、プロバイダー比較については、GitHubリポジトリをご覧ください。',
  'providers.docs': 'ドキュメント',
  'providers.setupTutorial': 'セットアップチュートリアル',

  // Provider Cards
  'providers.openai.name': 'OpenAI',
  'providers.openai.type': 'リアルタイムオーディオAPI',
  'providers.openai.features': 'GPT-4o Realtime Previewモデル|8種類のプレミアム音声オプション|高度なターン検出モード|内蔵ノイズリダクション|60以上の言語をサポート|カスタムプロンプト用テンプレートモード',
  'providers.openai.desc': '高品質な音声合成と高度な機能に最適',

  'providers.gemini.name': 'Google Gemini',
  'providers.gemini.type': 'Gemini Live API',
  'providers.gemini.features': 'Gemini 2.0 Flash Liveモデル|30種類のユニークな音声パーソナリティ|自動ターン検出|35以上の言語と地域バリアント|内蔵文字起こし|高トークン制限 (8192)',
  'providers.gemini.desc': '多言語サポートと自動処理に最適',

  'providers.palabra.name': 'PalabraAI',
  'providers.palabra.type': 'WebRTC翻訳サービス',
  'providers.palabra.features': 'リアルタイムWebRTC翻訳|60以上のソース言語|40以上のターゲット言語|低遅延ストリーミング|自動音声処理|ライブ翻訳に特化',
  'providers.palabra.desc': '最小限の遅延でリアルタイム翻訳に最適化',

  'providers.comet.name': 'CometAPI',
  'providers.comet.type': 'OpenAI互換API',
  'providers.comet.features': 'OpenAI Realtime API互換|OpenAIと同じ音声とモデルオプション|代替価格体系|完全な機能対等|OpenAIのドロップイン代替',
  'providers.comet.desc': 'OpenAIと同等の機能を持つコスト効率の良い代替',
  'providers.comet.compatible': '同じ機能を持つOpenAI互換プロバイダー',

  // Privacy Policy
  'privacy.title': 'プライバシーポリシー',
  'privacy.lastUpdated': '最終更新日：2025年11月27日',
  'privacy.intro.title': 'はじめに',
  'privacy.intro.content': 'Sokuji（「私たち」）は、お客様のプライバシー保護に取り組んでいます。このプライバシーポリシーでは、ブラウザ拡張機能、デスクトップアプリケーション、およびウェブサービスをご利用の際に、情報をどのように収集、使用、開示、保護するかについて説明します。',

  'privacy.guarantee.title': 'プライバシー保証',
  'privacy.guarantee.content': '私たちは以下を決して収集、保存、送信しません：',
  'privacy.guarantee.items': '音声録音や音声コンテンツ|翻訳テキストや会話内容|物理的な位置情報や正確なIPアドレス|アカウントのメールアドレス以外の機密個人情報',

  // Account Information
  'privacy.account.title': 'アカウント情報',
  'privacy.account.content': 'ウェブアプリケーションでアカウントを作成する際、以下の情報を収集します：',
  'privacy.account.items': 'メールアドレス：アカウント登録、ログイン、パスワード回復に使用されます。これが私たちが収集する唯一の個人識別情報です。|ハッシュ化されたパスワード：お客様のパスワードは業界標準のbcryptハッシュを使用して安全に暗号化されています。私たちはプレーンテキストのパスワードを保存したりアクセスしたりすることは決してありません。|アカウント作成日：アカウント管理の目的で記録されます。|セッショントークン：安全にログイン状態を維持するための一時的なトークンです。',

  'privacy.collect.title': '収集する情報',
  'privacy.collect.userProvided.title': 'ユーザーが提供する情報',
  'privacy.collect.userProvided.items': 'OpenAI APIキー：お客様が提供するAPIキーで、デバイスにローカル保存されます。|音声コンテンツ：通訳使用時にリアルタイム処理され、保存されません。|設定：言語モデルと音声設定の環境設定。',

  'privacy.collect.analytics.title': '分析データ（オプション）',
  'privacy.collect.analytics.content': 'お客様の明示的な同意のもと、匿名の使用分析を収集します：',
  'privacy.collect.analytics.items': 'アプリ使用パターン：使用する機能とその頻度|パフォーマンス指標：アプリ起動時間、翻訳遅延、エラー率|デバイス情報：オペレーティングシステム、デバイスタイプ（匿名化）|言語設定：ソース言語とターゲット言語の選択',
  'privacy.collect.analytics.optout': 'アプリ設定からいつでも分析をオプトアウトできます。',

  'privacy.use.title': '情報の使用方法',
  'privacy.use.items': 'リアルタイム言語通訳サービスの提供|仮想オーディオデバイスの作成と管理|セッション間での設定の保存|パフォーマンスの改善と最適化（同意のもと）',

  'privacy.analytics.title': '分析とトラッキング',
  'privacy.analytics.posthog.title': 'PostHog分析',
  'privacy.analytics.posthog.content': 'ユーザーがSokujiとどのように対話するかを理解するために、プライバシー重視の分析プラットフォームであるPostHogを使用しています。',
  'privacy.analytics.control.title': '分析の制御',
  'privacy.analytics.control.items': '明示的な同意が必要：分析はお客様が明示的に同意した後にのみ有効になります|簡単なオプトアウト：いつでも分析を無効にできます|詳細な制御：共有するデータの種類を選択|GDPR準拠：欧州のプライバシー規制に完全準拠',

  'privacy.storage.title': 'データの保存とセキュリティ',
  'privacy.storage.local.title': 'ローカルストレージ',
  'privacy.storage.local.content': '拡張機能とアプリの設定は、安全なブラウザメカニズムを使用してデバイスにローカル保存されます。',
  'privacy.storage.server.title': 'サーバーストレージ',
  'privacy.storage.server.content': 'アカウントデータは、Cloudflareのグローバルエッジネットワーク上で実行される分散SQLiteデータベースであるCloudflare D1に安全に保存されます。お客様のデータには以下のメリットがあります：',
  'privacy.storage.server.items': 'エッジベースストレージ：より高速なアクセスのためにお客様の近くにデータを保存|保存時の暗号化：保存されたすべてのデータは暗号化されています|安全なインフラストラクチャ：Cloudflareのエンタープライズグレードのセキュリティ対策|データ分離：お客様のアカウントデータは他のユーザーと論理的に分離されています',
  'privacy.storage.transmission.title': 'データ送信',
  'privacy.storage.transmission.content': '音声データはAIプロバイダーのサーバーに直接送信されます。すべての送信は安全なHTTPS接続を介して行われます。',

  'privacy.thirdParty.title': 'サードパーティサービス',
  'privacy.thirdParty.cloudflare.title': 'Cloudflare',
  'privacy.thirdParty.cloudflare.content': '私たちはウェブホスティング、コンテンツ配信、およびデータベースサービス（Cloudflare D1）にCloudflareを使用しています。お客様のアカウントデータはCloudflareのプライバシーポリシーに従って処理および保存されます。',
  'privacy.thirdParty.openai.title': 'OpenAI',
  'privacy.thirdParty.openai.content': '音声データは処理のためにOpenAIサーバーに送信され、OpenAIのプライバシーポリシーに準拠します。',
  'privacy.thirdParty.posthog.title': 'PostHog分析（オプション）',
  'privacy.thirdParty.posthog.content': '分析に同意した場合、匿名の使用データがPostHogに送信されます。',

  // Account Deletion
  'privacy.deletion.title': 'アカウント削除',
  'privacy.deletion.content': 'お客様にはいつでもアカウントを削除する権利があります。アカウント削除をリクエストするには：',
  'privacy.deletion.items': 'アカウントのメールアドレスを添えてprivacy@kizuna.aiまでご連絡ください|または、ダッシュボード設定のアカウント削除機能をご利用ください（利用可能な場合）|お客様のアカウントと関連するすべてのデータは完全に削除されます|この操作は取り消すことができず、処理には最大30日かかる場合があります',

  'privacy.retention.title': 'データ保持',
  'privacy.retention.content': '設定データはアンインストールまでローカルに保持されます。アカウントデータは削除をリクエストするまで保持されます。音声はリアルタイムで処理され、保存されません。',

  'privacy.rights.title': 'ユーザーの権利と制御',
  'privacy.rights.items': 'アカウントデータへのアクセス、更新、削除|個人データのコピーをリクエスト|分析トラッキングのオプトアウト|分析データの削除リクエスト|データの使用方法の通知|コア機能に影響せず同意を撤回',

  'privacy.gdpr.title': 'GDPR準拠',
  'privacy.gdpr.content': 'EUユーザーに対して、法的根拠、データ最小化、削除権、透明性のある処理を含む完全なGDPR準拠を保証します。',

  'privacy.children.title': '子供のプライバシー',
  'privacy.children.content': '私たちの拡張機能は13歳未満の子供を対象としていません。子供から意図的に個人情報を収集することはありません。',

  'privacy.changes.title': 'プライバシーポリシーの変更',
  'privacy.changes.content': 'このポリシーを更新する場合があります。更新を掲載し、重要な変更についてはアプリ内通知を表示してお知らせします。',

  'privacy.contact.title': 'お問い合わせ',
  'privacy.contact.content': 'プライバシーポリシーについてご質問がある場合：',
  'privacy.contact.email': 'メール：contact@kizuna.ai',
  'privacy.contact.privacy': 'プライバシーリクエスト：privacy@kizuna.ai',
  'privacy.contact.github': 'GitHub：github.com/kizuna-ai-lab/sokuji',

  'privacy.consent.title': '同意',
  'privacy.consent.content': '私たちの拡張機能を使用することで、このプライバシーポリシーに同意したことになります。分析については、別途明示的な同意を求めます。',
};

export default ja;
