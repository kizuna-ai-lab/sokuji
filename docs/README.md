# Sokuji Documentation

This directory contains comprehensive documentation for the Sokuji project, organized with consistent naming conventions.

## Documentation Structure

### Application Documentation
- **[app-analytics-integration.md](./app-analytics-integration.md)** - PostHog analytics integration for the main application
- **[app-analytics-events.md](./app-analytics-events.md)** - Comprehensive reference for all PostHog analytics events
- **[privacy-policy.html](./privacy-policy.html)** - Privacy policy for the application

### Extension Documentation
- **[extension-audio-profile-notification.md](./extension-audio-profile-notification.md)** - Audio profile notification feature for browser extension

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

### 📱 Application (app-*)
Documentation related to the main Electron/React application:
- Analytics and tracking
- Configuration and setup
- Feature guides
- Deployment instructions

### 🔌 Extension (extension-*)
Documentation related to the browser extension:
- Feature implementations
- Content script guides
- Manifest configuration
- Store submission guides

### 🔧 API (api-*)
Documentation related to API integrations:
- Authentication guides
- Endpoint references
- Integration examples
- Rate limiting

### 🚀 Deployment (deployment-*)
Documentation related to deployment and infrastructure:
- Build processes
- Release procedures
- Environment setup
- CI/CD configuration

### 🧪 Testing (testing-*)
Documentation related to testing:
- Test strategies
- Testing guides
- Quality assurance
- Performance testing

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