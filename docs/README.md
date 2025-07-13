# Sokuji Documentation

This directory contains comprehensive documentation for the Sokuji project, organized with consistent naming conventions.

## Documentation Structure

### Application Documentation
- **[app/](./app/)** - Main application (Electron/React) documentation
  - Analytics integration and event tracking
  - Configuration and setup guides

### Extension Documentation  
- **[extension/](./extension/)** - Browser extension documentation
  - Feature implementations and integrations
  - Analytics and user tracking

### Store Documentation
- **[store/](./store/)** - App store submission and response documentation
  - Chrome Web Store communications
  - Compliance and review feedback

### User Guides
- **[guides/](./guides/)** - User-facing guides and tutorials
  - Onboarding and setup instructions
  - Feature walkthroughs

### Legal Documentation
- **[privacy-policy.html](./privacy-policy.html)** - Privacy policy and data practices
- **[legal/](./legal/)** - Additional legal documentation and compliance materials

### Technical Analysis Documentation
- **[audio-analysis/](./audio-analysis/)** - Comprehensive audio flow analysis and echo feedback documentation
- **[github-issues/](./github-issues/)** - Technical analysis for specific GitHub issues

### Project Documentation
- **[../README.md](../README.md)** - Main project README
- **[../extension/README.md](../extension/README.md)** - Browser extension specific README
- **[../.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)** - Contribution guidelines

## Naming Conventions

All documentation files follow a consistent naming pattern:

### Format: `{component}-{feature}-{type}.md`

- **component**: The part of the system (app, extension, api, etc.)
- **feature**: The specific feature or functionality
- **type**: The type of documentation (integration, guide, reference, etc.)

### Examples:
- `app-analytics-integration.md` - Analytics integration for the main app
- `extension-audio-profile-notification.md` - Audio profile notification for extension
- `api-authentication-guide.md` - Authentication guide for API (future)
- `app-deployment-guide.md` - Deployment guide for the app (future)

## Documentation Categories

### 📱 Application (app/)
Documentation related to the main Electron/React application:
- Analytics and tracking
- Configuration and setup
- Feature guides
- Deployment instructions

### 🔌 Extension (extension/)
Documentation related to the browser extension:
- Feature implementations
- Content script guides
- Manifest configuration
- Analytics and tracking

### 🏪 Store (store/)
Documentation related to app store submissions:
- Chrome Web Store communications
- Review feedback and compliance
- Publication requirements
- Store optimization

### 📚 Guides (guides/)
User-facing guides and tutorials:
- Onboarding processes
- Feature walkthroughs
- Setup instructions
- Best practices

### ⚖️ Legal (legal/)
Legal documents and policies:
- Privacy policies
- Terms of service
- Compliance documentation
- Data protection

### 🔊 Audio Analysis (audio-analysis/)
Technical documentation and analysis:
- Audio flow architecture
- Echo feedback analysis
- Browser AEC limitations
- Solution recommendations

### 🐛 GitHub Issues (github-issues/)
Issue-specific technical analysis:
- Problem investigation reports
- Solution implementation details
- Technical explanations for community

## Contributing to Documentation

When adding new documentation:

1. **Follow the naming convention**: Use the format `{component}-{feature}-{type}.md`
2. **Place in correct directory**: All documentation goes in the `docs/` directory
3. **Update this index**: Add your new documentation to the appropriate section
4. **Use English**: All documentation should be written in English for international collaboration
5. **Include examples**: Provide practical examples and code snippets where applicable

## Quick Links

- [Main Application](../README.md)
- [Browser Extension](../extension/README.md)
- [Contributing Guidelines](../.github/CONTRIBUTING.md)
- [Privacy Policy](./privacy-policy.html)

## Support

For questions about the documentation or to suggest improvements, please:
- Open an issue in the GitHub repository
- Follow the contributing guidelines
- Use the appropriate issue templates 