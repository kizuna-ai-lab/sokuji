# GitHub Secrets Setup for Production Builds

This guide explains how to configure GitHub Secrets for automated production builds of Sokuji.

## Overview

Production environment variables are managed through GitHub Secrets to keep sensitive information secure. These secrets are used by GitHub Actions during the build process.

## Required Secrets

You need to configure the following secrets in your GitHub repository:

### 1. `VITE_CLERK_PUBLISHABLE_KEY_PROD` (Required)
- **Description**: Production Clerk publishable key for authentication
- **Format**: `pk_live_xxxxxxxxxxxxx`
- **How to get it**: 
  1. Log in to [Clerk Dashboard](https://dashboard.clerk.com)
  2. Select your production application
  3. Go to API Keys section
  4. Copy the "Publishable key" (starts with `pk_live_`)

### 2. `VITE_BACKEND_URL_PROD` (Optional)
- **Description**: Production backend API URL
- **Default**: `https://sokuji-api.kizuna.ai`
- **Note**: Only set this if using a different production API endpoint

### 3. `VITE_EXTENSION_ID_PROD` (Optional)
- **Description**: Chrome Web Store extension ID
- **Format**: 32-character string
- **How to get it**: 
  1. Publish your extension to Chrome Web Store
  2. Copy the ID from the extension's URL or dashboard

## How to Add Secrets to GitHub

1. Navigate to your GitHub repository
2. Click on **Settings** (requires admin access)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Enter the secret name (e.g., `VITE_CLERK_PUBLISHABLE_KEY_PROD`)
6. Enter the secret value
7. Click **Add secret**

## Verification

After setting up the secrets:

1. Create a new tag to trigger the build:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```

2. Check the GitHub Actions tab to monitor the build process

3. Verify that the build completes successfully

## Environment Variables Used

### Electron App
The Electron app uses these environment variables during build:
- `VITE_CLERK_PUBLISHABLE_KEY`: Clerk authentication key
- `VITE_BACKEND_URL`: Backend API endpoint
- `VITE_ENVIRONMENT`: Set to "production"
- `VITE_ENABLE_DEBUG`: Set to false
- `VITE_ENABLE_ANALYTICS`: Set to true

### Chrome Extension
The Chrome extension build also uses:
- `VITE_CLERK_PUBLISHABLE_KEY`: Same as Electron
- `VITE_BACKEND_URL`: Same as Electron

## Local Development

For local development, create `.env.development` and `.env.production` files based on the provided templates:
- `.env.example`: General template
- `.env.production.example`: Production-specific template

**Note**: Never commit actual `.env.production` or `.env.development` files to the repository. They are excluded in `.gitignore`.

## Security Best Practices

1. **Never commit secrets to the repository**
2. **Use different keys for development and production**
3. **Rotate secrets periodically**
4. **Limit secret access to necessary team members**
5. **Use GitHub's secret scanning to detect leaked secrets**

## Troubleshooting

### Build Fails with "Unauthorized" Error
- Verify that `VITE_CLERK_PUBLISHABLE_KEY_PROD` is set correctly
- Ensure you're using the production key (starts with `pk_live_`)

### Extension Can't Connect to Backend
- Check that the backend URL is correct
- Verify CORS settings allow the extension origin

### Environment Variables Not Applied
- Ensure secret names match exactly (case-sensitive)
- Check that GitHub Actions workflow is using the correct secret names
- Verify that the build process is reading environment variables

## Support

For issues related to:
- **Clerk Authentication**: Check [Clerk Documentation](https://clerk.com/docs)
- **GitHub Secrets**: See [GitHub Docs on Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- **Build Process**: Review `.github/workflows/build-and-release.yml`