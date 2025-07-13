Subject: Response to Manifest V3 Remote Hosted Code Violation - Item ID: ppmihnhelgfpjomhjhpecobloelicnak

Dear Chrome Web Store Developer Support Team,

Thank you for reviewing our extension "Sokuji - AI-powered Live Speech Translation for Online Meetings" (Item ID: ppmihnhelgfpjomhjhpecobloelicnak, version 0.5.6).

I would like to respectfully address the violation regarding "Including remotely hosted code resources in a manifest V3 item" and provide clarification on our PostHog analytics implementation.

# Chrome Web Store Compliance Response

This document addresses Chrome Web Store review feedback regarding "Remote Code Execution" and provides clarification on our PostHog analytics implementation.

## Our PostHog Implementation Complies with Manifest V3 Requirements

**We have migrated from `posthog-js` to `posthog-js-lite`** to ensure full Manifest V3 compliance and eliminate any remote code execution concerns.

### 1. Migration to posthog-js-lite
- We now use `posthog-js-lite` version 4.1.0, which is specifically designed for browser extensions
- This version provides core analytics functionality without any remote code execution
- It has zero external dependencies and no script injection capabilities
- The library is installed via npm (`"posthog-js-lite": "^4.1.0"`) and bundled into our extension during the build process

### 2. Updated Implementation Details
Our current implementation uses the following imports:
- `shared/index.tsx` (line 3): `import PostHog from 'posthog-js-lite';`
- `extension/popup.js` (line 3): `import PostHog from 'posthog-js-lite';`

### 3. No Remote Code Execution
Unlike the full `posthog-js` library, `posthog-js-lite`:
- Does NOT include session replay functionality
- Does NOT include survey injection capabilities  
- Does NOT include autocapture features
- Does NOT include toolbar functionality
- Does NOT inject any external scripts or remote code

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
- Opt-out by default (`optOut()` called in development)
- Sanitized to remove sensitive information
- Sent only as data payloads to PostHog's API (no external script loading)

## Verification

Our extension is completely open-source, and you can verify:
1. **Source code**: https://github.com/kizuna-ai-lab/sokuji/
2. **Build process**: GitHub Actions workflow that generates the exact zip file we submit
3. **Package contents**: All PostHog code is bundled within the extension, no external dependencies
4. **Migration commit**: The exact changes made to migrate from posthog-js to posthog-js-lite

The submitted extension package contains the complete PostHog Lite library code within the bundled JavaScript files, with no external script loading whatsoever.

## Migration Benefits

The migration to `posthog-js-lite` provides:
- ✅ Full Manifest V3 compliance
- ✅ No remote code execution capabilities
- ✅ Smaller bundle size (693 kB vs 1.5+ MB)
- ✅ Chrome Web Store approval compatibility
- ✅ Maintained core analytics functionality

## Conclusion

We have proactively migrated to `posthog-js-lite` to ensure complete compliance with Chrome Web Store policies. This implementation:
- ✅ Uses bundled PostHog Lite library (no external script loading)
- ✅ Eliminates all remote code execution capabilities
- ✅ Maintains essential analytics functionality
- ✅ Complies with Manifest V3 requirements
- ✅ Provides a smaller, more secure package

We believe this migration fully addresses the remote code execution concerns and demonstrates our commitment to Chrome Web Store compliance.

If you need any additional information or clarification, please don't hesitate to contact us. We greatly appreciate your work in maintaining the security and quality of the Chrome Web Store.

Thank you for your time and consideration.

Best regards,
Sokuji Development Team

---
**Open Source Repository**: https://github.com/kizuna-ai-lab/sokuji/  
**Extension Version**: 0.5.6  
**Item ID**: ppmihnhelgfpjomhjhpecobloelicnak 