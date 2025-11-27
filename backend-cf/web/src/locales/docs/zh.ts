/**
 * Chinese translations for documentation pages
 */

const zh: Record<string, string> = {
  // Common
  'common.backToHome': '返回首页',
  'common.backToDocs': '返回文档',
  'common.learnMore': '了解更多',
  'common.getStarted': '立即开始',
  'common.viewDocs': '查看文档',
  'common.signIn': '登录',
  'common.signUp': '注册',
  'common.dashboard': '控制台',
  'common.footer': '2025 Kizuna AI Lab. 保留所有权利。',
  'common.language': '语言',

  // Navigation
  'nav.home': '首页',
  'nav.docs': '文档',
  'nav.install': '安装',
  'nav.platforms': '平台',
  'nav.platformsOverview': '概述',
  'nav.aiProviders': 'AI 提供商',
  'nav.providersOverview': '概述',
  'nav.privacy': '隐私政策',
  'nav.github': 'GitHub',

  // Tutorials
  'tutorials.zoom': 'Zoom',
  'tutorials.googleMeet': 'Google Meet',
  'tutorials.teams': 'Microsoft Teams',
  'tutorials.discord': 'Discord',
  'tutorials.slack': 'Slack',
  'tutorials.whereby': 'Whereby',
  'tutorials.gather': 'Gather',
  'tutorials.openai': 'OpenAI 设置',
  'tutorials.gemini': 'Gemini 设置',
  'tutorials.palabraai': 'PalabraAI 设置',
  'tutorials.cometapi': 'CometAPI 设置',
  'tutorials.realtimeTester': 'API 测试器',

  // Landing Page
  'landing.title': 'Sokuji',
  'landing.tagline': 'AI 驱动的实时语音翻译',
  'landing.subtitle': '由 AI 驱动的实时语言翻译，提供浏览器扩展和适用于 Windows、macOS、Linux 的桌面应用程序。',
  'landing.cta.extension': '获取浏览器扩展',
  'landing.cta.desktop': '下载桌面应用',
  'landing.cta.docs': '查看文档',

  // Platform Selection
  'platform.title': '选择您的平台',
  'platform.extension.title': '浏览器扩展',
  'platform.extension.desc': '适用于在线会议（Google Meet、Zoom、Teams 等）',
  'platform.extension.chrome': 'Chrome 网上应用店',
  'platform.extension.edge': 'Edge 加载项',
  'platform.desktop.title': '桌面应用程序',
  'platform.desktop.desc': '适用于所有场景 - 任何网站、应用或系统音频',
  'platform.desktop.windows': 'Windows 安装程序 (.exe)',
  'platform.desktop.macos': 'macOS 安装程序 (.pkg)',
  'platform.desktop.linux': 'Linux 软件包 (.deb)',

  // Features
  'features.title': '功能特点',
  'features.realtime.title': '实时翻译',
  'features.realtime.desc': '低延迟的即时语音翻译',
  'features.multilang.title': '多语言支持',
  'features.multilang.desc': '支持 60+ 种语言及其地区变体',
  'features.providers.title': '多个 AI 提供商',
  'features.providers.desc': '可选择 OpenAI、Google Gemini、PalabraAI 等',
  'features.integration.title': '无缝集成',
  'features.integration.desc': '支持 Google Meet、Zoom、Teams、Discord 等',

  // Installation Guides
  'install.title': '安装指南',
  'install.windows': 'Windows 安装指南',
  'install.macos': 'macOS 安装指南',
  'install.linux': 'Linux 安装指南',

  // Docs Home
  'docs.title': '文档',
  'docs.subtitle': '了解如何安装和使用 Sokuji',
  'docs.gettingStarted': '快速开始',
  'docs.installation': '安装',
  'docs.configuration': '配置',
  'docs.resources': '资源',

  // Supported Sites
  'sites.title': '支持的网站',
  'sites.subtitle': 'Sokuji 扩展兼容以下视频会议和通信平台。',
  'sites.howToUse.title': '如何使用',
  'sites.howToUse.desc': '在任何支持的平台上，只需在平台的音频设置中选择"Sokuji Virtual Microphone"作为麦克风输入。Sokuji 将为您的语音提供实时翻译。',
  'sites.needHelp.title': '需要帮助？',
  'sites.needHelp.desc': '如果您在特定平台上遇到问题，请查看我们的 GitHub 仓库获取故障排除指南和支持。',
  'sites.visitPlatform': '访问平台',
  'sites.tutorial': '教程',

  // Site Cards
  'sites.meet.name': 'Google Meet',
  'sites.meet.url': 'meet.google.com',
  'sites.meet.features': '实时语音翻译|虚拟麦克风集成|无缝音频路由',

  'sites.teams.name': 'Microsoft Teams',
  'sites.teams.url': 'teams.live.com / teams.microsoft.com',
  'sites.teams.features': '实时语音翻译|虚拟麦克风集成|跨平台兼容|个人版和企业版',

  'sites.gather.name': 'Gather',
  'sites.gather.url': 'app.gather.town',
  'sites.gather.features': '实时语音翻译|虚拟麦克风集成|空间音频支持',

  'sites.whereby.name': 'Whereby',
  'sites.whereby.url': 'whereby.com',
  'sites.whereby.features': '实时语音翻译|虚拟麦克风集成|基于浏览器的会议',

  'sites.discord.name': 'Discord',
  'sites.discord.url': 'discord.com',
  'sites.discord.features': '实时语音翻译|虚拟麦克风集成|语音频道支持',

  'sites.slack.name': 'Slack',
  'sites.slack.url': 'app.slack.com',
  'sites.slack.features': '实时语音翻译|虚拟麦克风集成|Huddles 和通话支持',

  'sites.zoom.name': 'Zoom',
  'sites.zoom.url': 'app.zoom.us',
  'sites.zoom.features': '实时语音翻译|虚拟麦克风集成|网页客户端支持',

  // AI Providers
  'providers.title': '支持的 AI 提供商',
  'providers.subtitle': 'Sokuji 支持多个 AI 提供商进行实时语音翻译。每个提供商提供不同的功能、模型和定价结构。',
  'providers.setup.title': '设置说明',
  'providers.setup.desc': '要使用任何 AI 提供商，请从提供商网站获取 API 密钥，并在 Sokuji 设置面板中配置。',
  'providers.choosing.title': '选择提供商',
  'providers.needHelp.title': '需要帮助？',
  'providers.needHelp.desc': '有关设置指南、故障排除和提供商比较，请访问我们的 GitHub 仓库。',
  'providers.docs': '文档',
  'providers.setupTutorial': '设置教程',

  // Provider Cards
  'providers.openai.name': 'OpenAI',
  'providers.openai.type': '实时音频 API',
  'providers.openai.features': 'GPT-4o 实时预览模型|8 种优质语音选项|高级轮次检测模式|内置降噪|支持 60+ 种语言|自定义提示模板模式',
  'providers.openai.desc': '最适合高质量语音合成和高级功能',

  'providers.gemini.name': 'Google Gemini',
  'providers.gemini.type': 'Gemini Live API',
  'providers.gemini.features': 'Gemini 2.0 Flash Live 模型|30 种独特语音个性|自动轮次检测|35+ 种语言及地区变体|内置转录|高 token 限制 (8192)',
  'providers.gemini.desc': '非常适合多语言支持和自动处理',

  'providers.palabra.name': 'PalabraAI',
  'providers.palabra.type': 'WebRTC 翻译服务',
  'providers.palabra.features': '实时 WebRTC 翻译|60+ 种源语言|40+ 种目标语言|低延迟流式传输|自动音频处理|专为实时翻译优化',
  'providers.palabra.desc': '针对最小延迟的实时翻译优化',

  'providers.comet.name': 'CometAPI',
  'providers.comet.type': 'OpenAI 兼容 API',
  'providers.comet.features': 'OpenAI 实时 API 兼容|与 OpenAI 相同的语音和模型选项|替代定价结构|完整功能对等|OpenAI 的直接替代品',
  'providers.comet.desc': '具有相同功能的 OpenAI 经济替代方案',
  'providers.comet.compatible': '与 OpenAI 兼容，具有相同功能',

  // Privacy Policy
  'privacy.title': '隐私政策',
  'privacy.lastUpdated': '最后更新：2025年11月27日',
  'privacy.intro.title': '简介',
  'privacy.intro.content': 'Sokuji（"我们"）致力于保护您的隐私。本隐私政策说明了当您使用我们的浏览器扩展、桌面应用程序和网络服务时，我们如何收集、使用、披露和保护您的信息。',

  'privacy.guarantee.title': '我们的隐私承诺',
  'privacy.guarantee.content': '我们绝不收集、存储或传输：',
  'privacy.guarantee.items': '音频录音或语音内容|翻译文本或对话内容|您的物理位置或精确 IP 地址|账户邮箱以外的任何敏感个人信息',

  // Account Information
  'privacy.account.title': '账户信息',
  'privacy.account.content': '当您在我们的网络应用上创建账户时，我们会收集以下信息：',
  'privacy.account.items': '电子邮箱：用于账户注册、登录和密码找回。这是我们收集的唯一个人身份标识。|加密密码：您的密码使用行业标准的 bcrypt 哈希算法安全加密。我们永远不会存储或访问您的明文密码。|账户创建日期：用于账户管理目的。|会话令牌：用于安全地保持您的登录状态的临时令牌。',

  'privacy.collect.title': '我们收集的信息',
  'privacy.collect.userProvided.title': '用户提供的信息',
  'privacy.collect.userProvided.items': 'OpenAI API 密钥：您提供自己的 API 密钥，存储在本地设备上。|音频内容：使用翻译功能时实时处理，不存储。|配置设置：您的语言模型和语音设置偏好。',

  'privacy.collect.analytics.title': '分析数据（可选）',
  'privacy.collect.analytics.content': '经您明确同意，我们收集匿名使用分析数据：',
  'privacy.collect.analytics.items': '应用使用模式：您使用哪些功能及频率|性能指标：应用启动时间、翻译延迟、错误率|设备信息：操作系统、设备类型（匿名化）|语言偏好：源语言和目标语言选择',
  'privacy.collect.analytics.optout': '您可以随时通过应用设置退出分析。',

  'privacy.use.title': '我们如何使用您的信息',
  'privacy.use.items': '提供实时语言翻译服务|创建和管理虚拟音频设备|在会话之间保存您的偏好|改进和优化性能（经同意）',

  'privacy.analytics.title': '分析和跟踪',
  'privacy.analytics.posthog.title': 'PostHog 分析',
  'privacy.analytics.posthog.content': '我们使用 PostHog，一个注重隐私的分析平台，来了解用户如何与 Sokuji 交互。',
  'privacy.analytics.control.title': '您对分析的控制',
  'privacy.analytics.control.items': '需要明确同意：分析仅在您明确同意后启用|轻松退出：您可以随时禁用分析|精细控制：选择您愿意分享的数据类型|GDPR 合规：完全符合欧洲隐私法规',

  'privacy.storage.title': '数据存储和安全',
  'privacy.storage.local.title': '本地存储',
  'privacy.storage.local.content': '扩展和应用设置使用安全的浏览器机制存储在您的本地设备上。',
  'privacy.storage.server.title': '服务器存储',
  'privacy.storage.server.content': '账户数据安全存储在 Cloudflare D1，这是一个运行在 Cloudflare 全球边缘网络上的分布式 SQLite 数据库。您的数据享有以下保护：',
  'privacy.storage.server.items': '边缘存储：数据存储在离您最近的位置，访问更快|静态加密：所有存储的数据都经过加密|安全基础设施：Cloudflare 企业级安全措施|数据隔离：您的账户数据与其他用户逻辑隔离',
  'privacy.storage.transmission.title': '数据传输',
  'privacy.storage.transmission.content': '音频数据直接传输到 AI 提供商服务器。所有传输都通过安全的 HTTPS 连接进行。',

  'privacy.thirdParty.title': '第三方服务',
  'privacy.thirdParty.cloudflare.title': 'Cloudflare',
  'privacy.thirdParty.cloudflare.content': '我们使用 Cloudflare 提供网站托管、内容分发和数据库服务（Cloudflare D1）。您的账户数据按照 Cloudflare 的隐私政策进行处理和存储。',
  'privacy.thirdParty.openai.title': 'OpenAI',
  'privacy.thirdParty.openai.content': '音频数据发送到 OpenAI 服务器进行处理，受 OpenAI 隐私政策约束。',
  'privacy.thirdParty.posthog.title': 'PostHog 分析（可选）',
  'privacy.thirdParty.posthog.content': '如果您同意分析，匿名使用数据将发送到 PostHog。',

  // Account Deletion
  'privacy.deletion.title': '账户删除',
  'privacy.deletion.content': '您有权随时删除您的账户。要请求删除账户：',
  'privacy.deletion.items': '发送邮件至 privacy@kizuna.ai，提供您的账户邮箱|或使用仪表板设置中的账户删除功能（如果可用）|您的账户和所有相关数据将被永久删除|此操作不可撤销，处理可能需要最多 30 天',

  'privacy.retention.title': '数据保留',
  'privacy.retention.content': '配置数据在本地保留直到您卸载。账户数据保留直到您请求删除。音频实时处理，不存储。',

  'privacy.rights.title': '用户权利和控制',
  'privacy.rights.items': '访问、更新或删除您的账户数据|请求获取您个人数据的副本|退出分析跟踪|请求删除分析数据|了解您的数据如何被使用|撤回同意而不影响核心功能',

  'privacy.gdpr.title': 'GDPR 合规',
  'privacy.gdpr.content': '对于欧盟用户，我们确保完全符合 GDPR，包括合法依据、数据最小化、删除权和透明处理。',

  'privacy.children.title': '儿童隐私',
  'privacy.children.content': '我们的扩展不面向 13 岁以下的儿童。我们不会故意收集儿童的个人信息。',

  'privacy.changes.title': '本隐私政策的变更',
  'privacy.changes.content': '我们可能会更新此政策。我们将通过发布更新并对重大变更显示应用内通知来通知您。',

  'privacy.contact.title': '联系我们',
  'privacy.contact.content': '如果您对我们的隐私政策有疑问：',
  'privacy.contact.email': '邮箱：contact@kizuna.ai',
  'privacy.contact.privacy': '隐私请求：privacy@kizuna.ai',
  'privacy.contact.github': 'GitHub：github.com/kizuna-ai-lab/sokuji',

  'privacy.consent.title': '同意',
  'privacy.consent.content': '使用我们的扩展，即表示您同意本隐私政策。对于分析，我们将单独请求明确同意。',
};

export default zh;
