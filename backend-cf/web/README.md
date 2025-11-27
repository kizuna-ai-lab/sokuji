# Sokuji Web Dashboard

Web frontend for user account management, integrated with the backend-cf Cloudflare Worker.

## Features

- **Authentication**: Sign in, sign up, forgot password (OTP-based)
- **Dashboard**: Account overview with quick actions
- **Profile Management**: Update name, email address
- **Security Settings**: Change password, manage sessions, delete account

## Development

### Prerequisites

- Node.js 18+
- Parent backend-cf dependencies installed

### Setup

From the `backend-cf/` directory:

```bash
# Install web dependencies
npm run web:install

# Start development server (builds web + starts wrangler)
npm run dev
```

The combined app runs on `http://localhost:8787`.

### Alternative: Separate Development

```bash
# Terminal 1: Run API only
npm run dev:api

# Terminal 2: Run web with hot reload (port 5174)
npm run dev:web
```

### Build

```bash
npm run web:build
```

Output is in the `web/dist/` directory.

## Deployment

The web frontend is deployed together with the backend-cf Worker:

```bash
npm run deploy
```

This builds the web app and deploys everything to Cloudflare.

## Architecture

```
web/
├── src/
│   ├── pages/
│   │   ├── auth/           # Authentication pages
│   │   │   ├── SignIn.tsx
│   │   │   ├── SignUp.tsx
│   │   │   ├── ForgotPassword.tsx
│   │   │   └── ResetPassword.tsx
│   │   └── dashboard/      # Dashboard pages
│   │       ├── Dashboard.tsx
│   │       ├── Profile.tsx
│   │       └── Security.tsx
│   ├── components/
│   │   ├── ui/            # Reusable UI components
│   │   └── layout/        # Layout components
│   ├── lib/               # Utilities and config
│   └── styles/            # Global styles
├── public/                # Static assets
└── package.json
```

## Design System

Based on the main Sokuji app design:

- **Background**: #0d0d0d (primary), #1a1a1a (secondary)
- **Accent**: #10a37f (Sokuji green)
- **Typography**: System font stack
- **Components**: Consistent with main app styling
