Subject: Response to Manifest V3 Remote Hosted Code Violation - Item ID: ppmihnhelgfpjomhjhpecobloelicnak

Dear Chrome Web Store Developer Support Team,

Thank you for reviewing our extension "Sokuji - AI-powered Live Speech Translation for Online Meetings" (Item ID: ppmihnhelgfpjomhjhpecobloelicnak, version 0.5.6).

I would like to respectfully address the violation regarding "Including remotely hosted code resources in a manifest V3 item" and provide clarification on our PostHog analytics implementation.

## Our PostHog Implementation Complies with Manifest V3 Requirements

**We do NOT inject external PostHog scripts from posthog.com**. Instead, we use the bundled, self-contained version of PostHog that is included within our extension package. Here are the technical details:

### 1. Bundled PostHog Library
- We use `posthog-js/dist/module.full.no-external` which is specifically designed for browser extensions
- This version includes ALL PostHog functionality within the bundle and does NOT load external dependencies
- The library is installed via npm (`"posthog-js": "1.167.0"`) and bundled into our extension during the build process

### 2. Code Evidence
You can verify this in our open-source repository at https://github.com/kizuna-ai-lab/sokuji/

Key files showing our compliant implementation:
- `shared/index.tsx` (line 3): `import posthog from 'posthog-js/dist/module.full.no-external';`
- `extension/popup.js` (line 3): `import posthog from 'posthog-js/dist/module.full.no-external';`
- `shared/index.tsx` (line 42): `disable_external_dependency_loading: true`

### 3. Explicit Configuration for Extensions
Our PostHog configuration explicitly disables external dependency loading:

```javascript
const options = {
  api_host: ANALYTICS_CONFIG.POSTHOG_HOST,
  // According to official documentation, browser extensions must disable external dependency loading
  disable_external_dependency_loading: true,
  disable_surveys: true,
  disable_session_recording: true,
  autocapture: false,
  capture_dead_clicks: false,
  enable_heatmaps: false,
  // ... other extension-specific settings
};
```

### 4. Content Security Policy Compliance
Our manifest.json includes PostHog's API endpoint in the CSP for data transmission only:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; worker-src 'self'; connect-src 'self' https://us.i.posthog.com ..."
}
```

The `connect-src` directive allows HTTPS requests to PostHog's API for sending analytics data, but does NOT allow loading external scripts.

## Why We Use PostHog

PostHog is used for privacy-focused analytics to help us:
- Understand user behavior and improve the extension
- Track feature usage and performance metrics
- Identify and fix issues
- Comply with GDPR and privacy regulations

All analytics are:
- Opt-out by default (`opt_out_capturing_by_default: true`)
- Sanitized to remove sensitive information
- Sent only as data payloads to PostHog's API (no external script loading)

## Verification

Our extension is completely open-source, and you can verify:
1. **Source code**: https://github.com/kizuna-ai-lab/sokuji/
2. **Build process**: GitHub Actions workflow that generates the exact zip file we submit
3. **Package contents**: All PostHog code is bundled within the extension, no external dependencies

The submitted extension package contains the complete PostHog library code within the bundled JavaScript files, with no external script loading whatsoever.

## Conclusion

We believe this may be a false positive in your automated detection system. Our implementation:
- ✅ Uses bundled PostHog library (no external script loading)
- ✅ Explicitly disables external dependency loading
- ✅ Only makes HTTPS API calls for data transmission
- ✅ Complies with all Manifest V3 requirements

We respectfully request a manual review of our extension, as we are confident that our PostHog implementation fully complies with Chrome Web Store policies.

If you need any additional information or clarification, please don't hesitate to contact us. We greatly appreciate your work in maintaining the security and quality of the Chrome Web Store.

Thank you for your time and consideration.

Best regards,
Sokuji Development Team

---
**Open Source Repository**: https://github.com/kizuna-ai-lab/sokuji/  
**Extension Version**: 0.5.6  
**Item ID**: ppmihnhelgfpjomhjhpecobloelicnak 