/**
 * English translations for documentation pages
 */

const en: Record<string, string> = {
  // Common
  'common.backToHome': 'Back to Home',
  'common.backToDocs': 'Back to Documentation',
  'common.learnMore': 'Learn More',
  'common.getStarted': 'Get Started',
  'common.viewDocs': 'View Documentation',
  'common.signIn': 'Sign In',
  'common.signUp': 'Sign Up',
  'common.dashboard': 'Dashboard',
  'common.footer': '2025 Kizuna AI Lab. All rights reserved.',
  'common.language': 'Language',

  // Navigation
  'nav.home': 'Home',
  'nav.docs': 'Documentation',
  'nav.install': 'Installation',
  'nav.platforms': 'Platforms',
  'nav.platformsOverview': 'Overview',
  'nav.aiProviders': 'AI Providers',
  'nav.providersOverview': 'Overview',
  'nav.privacy': 'Privacy',
  'nav.feedback': 'Feedback',
  'nav.github': 'GitHub',

  // Tutorials
  'tutorials.zoom': 'Zoom',
  'tutorials.googleMeet': 'Google Meet',
  'tutorials.teams': 'Microsoft Teams',
  'tutorials.discord': 'Discord',
  'tutorials.slack': 'Slack',
  'tutorials.whereby': 'Whereby',
  'tutorials.gather': 'Gather',
  'tutorials.openai': 'OpenAI Setup',
  'tutorials.gemini': 'Gemini Setup',
  'tutorials.palabraai': 'PalabraAI Setup',
  'tutorials.cometapi': 'CometAPI Setup',
  'tutorials.realtimeTester': 'API Tester',

  // Landing Page
  'landing.title': 'Sokuji',
  'landing.tagline': 'AI-powered Live Speech Translation',
  'landing.subtitle': 'Real-time language interpretation powered by AI, available as browser extensions and desktop applications for Windows, macOS, and Linux.',
  'landing.cta.extension': 'Get Browser Extension',
  'landing.cta.desktop': 'Download Desktop App',
  'landing.cta.docs': 'View Documentation',

  // Platform Selection
  'platform.title': 'Choose Your Platform',
  'platform.extension.title': 'Browser Extensions',
  'platform.extension.desc': 'For online meetings (Google Meet, Zoom, Teams, etc.)',
  'platform.extension.chrome': 'Chrome Web Store',
  'platform.extension.edge': 'Edge Add-ons',
  'platform.desktop.title': 'Desktop Applications',
  'platform.desktop.desc': 'For all scenarios - any website, app, or system audio',
  'platform.desktop.windows': 'Windows Installer (.exe)',
  'platform.desktop.macos': 'macOS Installer (.pkg)',
  'platform.desktop.linux': 'Linux Package (.deb)',

  // Features
  'features.title': 'Features',
  'features.realtime.title': 'Real-time Translation',
  'features.realtime.desc': 'Instant voice translation with minimal latency',
  'features.multilang.title': 'Multi-language Support',
  'features.multilang.desc': 'Support for 60+ languages with regional variants',
  'features.providers.title': 'Multiple AI Providers',
  'features.providers.desc': 'Choose from OpenAI, Google Gemini, PalabraAI, and more',
  'features.integration.title': 'Seamless Integration',
  'features.integration.desc': 'Works with Google Meet, Zoom, Teams, Discord, and more',

  // Installation Guides
  'install.title': 'Installation Guides',
  'install.windows': 'Windows Installation Guide',
  'install.macos': 'macOS Installation Guide',
  'install.linux': 'Linux Installation Guide',

  // Docs Home
  'docs.title': 'Documentation',
  'docs.subtitle': 'Learn how to install and use Sokuji',
  'docs.gettingStarted': 'Getting Started',
  'docs.installation': 'Installation',
  'docs.configuration': 'Configuration',
  'docs.resources': 'Resources',

  // Supported Sites
  'sites.title': 'Supported Websites',
  'sites.subtitle': 'The Sokuji extension is compatible with the following video conferencing and communication platforms.',
  'sites.howToUse.title': 'How to Use',
  'sites.howToUse.desc': 'On any supported platform, simply select "Sokuji Virtual Microphone" as your microphone input in the platform\'s audio settings. Sokuji will then provide real-time translation of your speech.',
  'sites.needHelp.title': 'Need Help?',
  'sites.needHelp.desc': 'If you encounter any issues with a specific platform, please check our GitHub repository for troubleshooting guides and support.',
  'sites.visitPlatform': 'Visit Platform',
  'sites.tutorial': 'Tutorial',

  // Site Cards
  'sites.meet.name': 'Google Meet',
  'sites.meet.url': 'meet.google.com',
  'sites.meet.features': 'Real-time voice translation|Virtual microphone integration|Seamless audio routing',

  'sites.teams.name': 'Microsoft Teams',
  'sites.teams.url': 'teams.live.com / teams.microsoft.com',
  'sites.teams.features': 'Real-time voice translation|Virtual microphone integration|Cross-platform compatibility|Personal and Enterprise editions',

  'sites.gather.name': 'Gather',
  'sites.gather.url': 'app.gather.town',
  'sites.gather.features': 'Real-time voice translation|Virtual microphone integration|Spatial audio support',

  'sites.whereby.name': 'Whereby',
  'sites.whereby.url': 'whereby.com',
  'sites.whereby.features': 'Real-time voice translation|Virtual microphone integration|Browser-based meetings',

  'sites.discord.name': 'Discord',
  'sites.discord.url': 'discord.com',
  'sites.discord.features': 'Real-time voice translation|Virtual microphone integration|Voice channel support',

  'sites.slack.name': 'Slack',
  'sites.slack.url': 'app.slack.com',
  'sites.slack.features': 'Real-time voice translation|Virtual microphone integration|Huddles and calls support',

  'sites.zoom.name': 'Zoom',
  'sites.zoom.url': 'app.zoom.us',
  'sites.zoom.features': 'Real-time voice translation|Virtual microphone integration|Web client support',

  // AI Providers
  'providers.title': 'Supported AI Providers',
  'providers.subtitle': 'Sokuji supports multiple AI providers for real-time speech translation. Each provider offers different capabilities, models, and pricing structures.',
  'providers.setup.title': 'Setup Instructions',
  'providers.setup.desc': 'To use any AI provider, obtain an API key from the provider\'s website and configure it in Sokuji\'s settings panel.',
  'providers.choosing.title': 'Choosing a Provider',
  'providers.needHelp.title': 'Need Help?',
  'providers.needHelp.desc': 'For setup guides, troubleshooting, and provider comparisons, visit our GitHub repository.',
  'providers.docs': 'Documentation',
  'providers.setupTutorial': 'Setup Tutorial',

  // Provider Cards
  'providers.openai.name': 'OpenAI',
  'providers.openai.type': 'Real-time Audio API',
  'providers.openai.features': 'GPT-4o Realtime Preview models|8 premium voice options|Advanced turn detection modes|Built-in noise reduction|60+ languages supported|Template mode for custom prompts',
  'providers.openai.desc': 'Best for high-quality voice synthesis and advanced features',

  'providers.gemini.name': 'Google Gemini',
  'providers.gemini.type': 'Gemini Live API',
  'providers.gemini.features': 'Gemini 2.0 Flash Live models|30 unique voice personalities|Automatic turn detection|35+ languages with regional variants|Built-in transcription|High token limits (8192)',
  'providers.gemini.desc': 'Great for multilingual support and automatic processing',

  'providers.palabra.name': 'PalabraAI',
  'providers.palabra.type': 'WebRTC Translation Service',
  'providers.palabra.features': 'Real-time WebRTC translation|60+ source languages|40+ target languages|Low latency streaming|Automatic audio processing|Specialized for live translation',
  'providers.palabra.desc': 'Optimized for real-time translation with minimal latency',

  'providers.comet.name': 'CometAPI',
  'providers.comet.type': 'OpenAI-Compatible API',
  'providers.comet.features': 'OpenAI Realtime API compatibility|Same voice and model options as OpenAI|Alternative pricing structure|Full feature parity|Drop-in replacement for OpenAI',
  'providers.comet.desc': 'Cost-effective alternative to OpenAI with identical functionality',
  'providers.comet.compatible': 'OpenAI-compatible provider with same features',

  // Privacy Policy
  'privacy.title': 'Privacy Policy',
  'privacy.lastUpdated': 'Last Updated: November 27, 2025',
  'privacy.intro.title': 'Introduction',
  'privacy.intro.content': 'Sokuji ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our browser extension, desktop application, and web services.',

  'privacy.guarantee.title': 'Our Privacy Guarantee',
  'privacy.guarantee.content': 'We NEVER collect, store, or transmit:',
  'privacy.guarantee.items': 'Audio recordings or voice content|Translation text or conversation content|Your physical location or precise IP addresses|Any sensitive personal information beyond your account email',

  // Account Information
  'privacy.account.title': 'Account Information',
  'privacy.account.content': 'When you create an account on our web application, we collect the following information:',
  'privacy.account.items': 'Email Address: Used for account registration, login, and password recovery. This is the only personal identifier we collect.|Hashed Password: Your password is securely encrypted using industry-standard bcrypt hashing. We never store or have access to your plain-text password.|Account Creation Date: Recorded for account management purposes.|Session Tokens: Temporary tokens used to keep you logged in securely.',

  'privacy.collect.title': 'Information We Collect',
  'privacy.collect.userProvided.title': 'User-Provided Information',
  'privacy.collect.userProvided.items': 'OpenAI API Key: You provide your own API key which is stored locally on your device.|Audio Content: Processed in real-time when you use interpretation, not stored.|Configuration Settings: Your preferences for language models and voice settings.',

  'privacy.collect.analytics.title': 'Analytics Data (Optional)',
  'privacy.collect.analytics.content': 'With your explicit consent, we collect anonymous usage analytics:',
  'privacy.collect.analytics.items': 'App Usage Patterns: Which features you use and how often|Performance Metrics: App startup time, translation latency, error rates|Device Information: Operating system, device type (anonymized)|Language Preferences: Source and target language selections',
  'privacy.collect.analytics.optout': 'You can opt-out of analytics at any time through the app settings.',

  'privacy.use.title': 'How We Use Your Information',
  'privacy.use.items': 'To provide real-time language interpretation services|To create and manage virtual audio devices|To save your preferences between sessions|To improve and optimize performance (with consent)',

  'privacy.analytics.title': 'Analytics and Tracking',
  'privacy.analytics.posthog.title': 'PostHog Analytics',
  'privacy.analytics.posthog.content': 'We use PostHog, a privacy-focused analytics platform, to understand how users interact with Sokuji.',
  'privacy.analytics.control.title': 'Your Control Over Analytics',
  'privacy.analytics.control.items': 'Explicit Consent Required: Analytics are only enabled after you explicitly consent|Easy Opt-Out: You can disable analytics at any time|Granular Control: Choose what types of data you share|GDPR Compliant: Full compliance with European privacy regulations',

  'privacy.storage.title': 'Data Storage and Security',
  'privacy.storage.local.title': 'Local Storage',
  'privacy.storage.local.content': 'Extension and app settings are stored locally on your device using secure browser mechanisms.',
  'privacy.storage.server.title': 'Server Storage',
  'privacy.storage.server.content': 'Account data is stored securely on Cloudflare D1, a distributed SQLite database running on Cloudflare\'s global edge network. Your data benefits from:',
  'privacy.storage.server.items': 'Edge-based Storage: Data is stored close to you for faster access|Encryption at Rest: All stored data is encrypted|Secure Infrastructure: Cloudflare\'s enterprise-grade security measures|Data Isolation: Your account data is logically separated from other users',
  'privacy.storage.transmission.title': 'Data Transmission',
  'privacy.storage.transmission.content': 'Audio data is transmitted directly to AI provider servers. All transmission occurs over secure HTTPS connections.',

  'privacy.thirdParty.title': 'Third-Party Services',
  'privacy.thirdParty.cloudflare.title': 'Cloudflare',
  'privacy.thirdParty.cloudflare.content': 'We use Cloudflare for web hosting, content delivery, and database services (Cloudflare D1). Your account data is processed and stored according to Cloudflare\'s Privacy Policy.',
  'privacy.thirdParty.openai.title': 'OpenAI',
  'privacy.thirdParty.openai.content': 'Audio data is sent to OpenAI servers for processing, governed by OpenAI\'s Privacy Policy.',
  'privacy.thirdParty.posthog.title': 'PostHog Analytics (Optional)',
  'privacy.thirdParty.posthog.content': 'If you consent to analytics, anonymous usage data is sent to PostHog.',

  // Account Deletion
  'privacy.deletion.title': 'Account Deletion',
  'privacy.deletion.content': 'You have the right to delete your account at any time. To request account deletion:',
  'privacy.deletion.items': 'Contact us at privacy@kizuna.ai with your account email|Or use the account deletion feature in your dashboard settings (if available)|Your account and all associated data will be permanently deleted|This action cannot be undone and processing may take up to 30 days',

  'privacy.retention.title': 'Data Retention',
  'privacy.retention.content': 'Configuration data is retained locally until you uninstall. Account data is retained until you request deletion. Audio is processed in real-time and not stored.',

  'privacy.rights.title': 'User Rights and Control',
  'privacy.rights.items': 'Access, update, or delete your account data|Request a copy of your personal data|Opt-out of analytics tracking|Request deletion of analytics data|Be informed of how your data is used|Withdraw consent without affecting core functionality',

  'privacy.gdpr.title': 'GDPR Compliance',
  'privacy.gdpr.content': 'For EU users, we ensure full GDPR compliance including lawful basis, data minimization, right to erasure, and transparent processing.',

  'privacy.children.title': 'Children\'s Privacy',
  'privacy.children.content': 'Our extension is not intended for children under 13. We do not knowingly collect personal information from children.',

  'privacy.changes.title': 'Changes to This Privacy Policy',
  'privacy.changes.content': 'We may update this policy. We will notify you by posting updates and showing in-app notifications for significant changes.',

  'privacy.contact.title': 'Contact Us',
  'privacy.contact.content': 'If you have questions about our Privacy Policy:',
  'privacy.contact.email': 'Email: contact@kizuna.ai',
  'privacy.contact.privacy': 'Privacy Requests: privacy@kizuna.ai',
  'privacy.contact.github': 'GitHub: github.com/kizuna-ai-lab/sokuji',

  'privacy.consent.title': 'Consent',
  'privacy.consent.content': 'By using our extension, you consent to this Privacy Policy. For analytics, we will request separate explicit consent.',

  // Dashboard
  'dashboard.notice.comingSoon': 'Kizuna AI Realtime API (proxy service) and Kizuna AI\'s proprietary Realtime service are currently under development and will be available soon.',

  // Dashboard Navigation
  'dashboard.nav.dashboard': 'Dashboard',
  'dashboard.nav.profile': 'Profile',
  'dashboard.nav.security': 'Security',
  'dashboard.nav.feedback': 'Feedback',
  'dashboard.nav.signOut': 'Sign out',
  'dashboard.user.fallback': 'User',

  // Dashboard Home
  'dashboard.home.welcomeBack': 'Welcome back, {name}',
  'dashboard.home.subtitle': 'Manage your account settings and preferences',
  'dashboard.home.accountOverview': 'Account Overview',
  'dashboard.home.accountStatus': 'Account Status',
  'dashboard.home.accountDetails': 'Account Details',
  'dashboard.home.quickActions': 'Quick Actions',
  'dashboard.home.name': 'Name',
  'dashboard.home.email': 'Email',
  'dashboard.home.emailVerified': 'Email Verified',
  'dashboard.home.accountType': 'Account Type',
  'dashboard.home.userId': 'User ID',
  'dashboard.home.created': 'Created',
  'dashboard.home.lastUpdated': 'Last Updated',
  'dashboard.home.notSet': 'Not set',
  'dashboard.home.verified': 'Verified',
  'dashboard.home.notVerified': 'Not Verified',
  'dashboard.home.anonymous': 'Anonymous',
  'dashboard.home.registered': 'Registered',
  'dashboard.home.editProfile': 'Edit Profile',
  'dashboard.home.securitySettings': 'Security Settings',
  'dashboard.home.na': 'N/A',

  // Dashboard Profile
  'dashboard.profile.title': 'Profile Settings',
  'dashboard.profile.subtitle': 'Manage your personal information',
  'dashboard.profile.personalInfo': 'Personal Information',
  'dashboard.profile.personalInfoDesc': 'Update your name and basic information',
  'dashboard.profile.nameLabel': 'Name',
  'dashboard.profile.namePlaceholder': 'Your name',
  'dashboard.profile.saveChanges': 'Save Changes',
  'dashboard.profile.profileUpdated': 'Profile updated successfully',
  'dashboard.profile.emailAddress': 'Email Address',
  'dashboard.profile.emailAddressDesc': 'Manage your email address and verification status',
  'dashboard.profile.currentEmail': 'Current Email',
  'dashboard.profile.verified': 'Verified',
  'dashboard.profile.notVerified': 'Not Verified',
  'dashboard.profile.resendVerification': 'Resend Verification',
  'dashboard.profile.verificationSent': 'Verification email sent! Check your inbox.',
  'dashboard.profile.changeEmailTitle': 'Change Email Address',
  'dashboard.profile.newEmailLabel': 'New Email Address',
  'dashboard.profile.newEmailPlaceholder': 'new@email.com',
  'dashboard.profile.newEmailHint': 'A verification email will be sent to the new address',
  'dashboard.profile.changeEmail': 'Change Email',
  'dashboard.profile.emailChangeSent': 'Verification email sent to your new address. Please check your inbox.',

  // Dashboard Security
  'dashboard.security.title': 'Security Settings',
  'dashboard.security.subtitle': 'Manage your password and account security',
  'dashboard.security.changePassword': 'Change Password',
  'dashboard.security.changePasswordDesc': 'Update your password to keep your account secure',
  'dashboard.security.currentPassword': 'Current Password',
  'dashboard.security.currentPasswordPlaceholder': 'Enter current password',
  'dashboard.security.newPassword': 'New Password',
  'dashboard.security.newPasswordPlaceholder': 'Minimum 8 characters',
  'dashboard.security.confirmPassword': 'Confirm New Password',
  'dashboard.security.confirmPasswordPlaceholder': 'Confirm new password',
  'dashboard.security.changePasswordBtn': 'Change Password',
  'dashboard.security.activeSessions': 'Active Sessions',
  'dashboard.security.activeSessionsDesc': 'Manage your active login sessions ({count} active)',
  'dashboard.security.current': 'Current',
  'dashboard.security.lastActive': 'Last active: {time}',
  'dashboard.security.loadingSessions': 'Loading sessions...',
  'dashboard.security.signOutOther': 'Sign Out All Other Sessions',
  'dashboard.security.deleteAccount': 'Delete Account',
  'dashboard.security.deleteAccountDesc': 'Permanently delete your account and all associated data',
  'dashboard.security.deleteWarning': 'This action is irreversible. All your data will be permanently deleted.',
  'dashboard.security.deleteBtn': 'Delete My Account',
  'dashboard.security.deleteConfirmText': 'To confirm deletion, please type DELETE below:',
  'dashboard.security.deleteConfirmPlaceholder': 'Type DELETE to confirm',
  'dashboard.security.cancel': 'Cancel',
  'dashboard.security.anonymousNote': 'Anonymous accounts cannot change passwords. Please convert to a full account first.',
  'dashboard.security.passwordMinLength': 'New password must be at least 8 characters',
  'dashboard.security.passwordMismatch': 'Passwords do not match',
  'dashboard.security.passwordIncorrect': 'Current password is incorrect',
  'dashboard.security.passwordSuccess': 'Password changed successfully. Other sessions have been logged out.',
  'dashboard.security.typeDelete': 'Please type DELETE to confirm',

  // Dashboard Feedback
  'dashboard.feedback.title': 'Send Feedback',
  'dashboard.feedback.subtitle': 'Report bugs, suggest features, or share your thoughts. We read every message and appreciate your input!',
  'dashboard.feedback.yourFeedback': 'Your Feedback',
  'dashboard.feedback.sendingAs': 'Sending as {email}',
  'dashboard.feedback.remainingCount': 'You have {remaining} of {limit} feedback messages remaining today',
  'dashboard.feedback.limitReached': 'Daily limit reached. You can send more feedback tomorrow.',
  'dashboard.feedback.feedbackType': 'Feedback Type',
  'dashboard.feedback.bugReport': 'Bug Report',
  'dashboard.feedback.bugReportDesc': 'Report a problem or issue',
  'dashboard.feedback.suggestion': 'Feature Suggestion',
  'dashboard.feedback.suggestionDesc': 'Suggest a new feature or improvement',
  'dashboard.feedback.other': 'Other',
  'dashboard.feedback.otherDesc': 'General feedback or questions',
  'dashboard.feedback.message': 'Message',
  'dashboard.feedback.messagePlaceholder': 'Describe your feedback in detail...',
  'dashboard.feedback.messageHint': '{count}/5000 characters (minimum 10)',
  'dashboard.feedback.sendFeedback': 'Send Feedback',
  'dashboard.feedback.verificationRequired': 'Email Verification Required',
  'dashboard.feedback.verificationRequiredDesc': 'Please verify your email address before submitting feedback. We need a verified email to respond to your feedback.',
  'dashboard.feedback.goToProfile': 'Go to Profile Settings',
  'dashboard.feedback.thankYou': 'Thank you! Your feedback has been sent successfully.',
};

export default en;
