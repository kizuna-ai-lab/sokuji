# Email Verification Setup with Zoho Mail

This document explains how to configure email verification for Sokuji backend using Zoho Mail SMTP.

## Overview

The backend now supports email verification for user authentication using Better Auth and Zoho Mail SMTP. This includes:

- ✅ Email verification on sign up
- ✅ Password reset emails
- ✅ Email change confirmation

## Prerequisites

1. A Zoho Mail account (free or paid)
2. Your domain configured with Zoho Mail
3. SMTP credentials from Zoho

## Getting Zoho Mail SMTP Credentials

### For Zoho Mail Free/Standard Users

1. Log in to your Zoho Mail account
2. Go to **Settings** → **Mail Accounts** → **IMAP/POP Access**
3. Enable **SMTP** access
4. Use your Zoho email and password for authentication

### For Zoho Mail with Custom Domain

1. Your email: `your-name@yourdomain.com`
2. Password: Your Zoho Mail account password
3. SMTP Server: `smtp.zoho.jp` (Japan) or `smtp.zoho.com` (Global)
4. Port: `465` (SSL) or `587` (TLS)

**Note**: This project is configured to use `smtp.zoho.jp` for Japan region.

### App-Specific Password (Recommended)

For enhanced security, create an app-specific password:

1. Go to https://accounts.zoho.jp/home#security/app-passwords (Japan) or https://accounts.zoho.com/home#security/app-passwords (Global)
2. Click **Generate New Password**
3. Enter a name like "Sokuji Backend"
4. Copy the generated password
5. Use this password instead of your regular password

## Configuration

### Local Development

1. Copy the example environment file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Edit `.dev.vars` and add your Zoho Mail credentials:
   ```env
   ZOHO_MAIL_USER=your-email@yourdomain.com
   ZOHO_MAIL_PASSWORD=your-zoho-password-or-app-password
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

### Production Deployment (Cloudflare Workers)

1. Go to your [Cloudflare Workers Dashboard](https://dash.cloudflare.com/)

2. Select your worker (or create a new one)

3. Go to **Settings** → **Variables**

4. Add the following **Environment Variables**:
   - Name: `ZOHO_MAIL_USER`
   - Value: `your-email@yourdomain.com`
   - Click **Add variable**

   - Name: `ZOHO_MAIL_PASSWORD`
   - Value: `your-zoho-password-or-app-password`
   - Click **Encrypt** (recommended)
   - Click **Add variable**

5. Click **Save and Deploy**

## Email Templates

The following email templates are included:

### 1. Email Verification
- Sent automatically when users sign up
- Contains a verification link valid for 24 hours
- Auto sign-in after verification

### 2. Password Reset
- Sent when users request a password reset
- Contains a reset link valid for 1 hour
- Users can set a new password

### 3. Email Change Confirmation
- Sent to the **current email** when users change their email
- Requires confirmation before the change takes effect
- Security measure to prevent unauthorized email changes

## Testing Email Verification

### Test Sign Up Flow

1. Start the backend:
   ```bash
   npm run dev
   ```

2. Sign up a new user via your frontend

3. Check your email inbox (or spam folder)

4. Click the verification link

5. You should be automatically signed in

### Test Email Sending Locally

You can test the email service directly:

```typescript
import { sendVerificationEmail } from './src/lib/email';

await sendVerificationEmail({
  email: 'test@example.com',
  verificationUrl: 'https://your-app.com/verify?token=abc123'
});
```

## Troubleshooting

### Emails Not Sending

1. **Check credentials**: Verify your `ZOHO_MAIL_USER` and `ZOHO_MAIL_PASSWORD` are correct

2. **Check SMTP access**: Ensure SMTP is enabled in your Zoho Mail settings

3. **Check spam folder**: Verification emails might be in spam

4. **Check console logs**: Look for error messages in the terminal:
   ```bash
   npm run dev
   ```

5. **Test SMTP connection**:
   ```bash
   # Install telnet if not available
   sudo apt-get install telnet

   # Test SMTP connection (use smtp.zoho.jp for Japan)
   telnet smtp.zoho.jp 465
   ```

### Common Errors

#### "Authentication failed"
- Wrong email or password
- SMTP access not enabled in Zoho
- Use app-specific password instead

#### "Connection timeout"
- Firewall blocking port 465
- Try port 587 with TLS instead

#### "Rate limit exceeded"
- Zoho free tier: 500 emails/day
- Wait or upgrade to paid plan

### Email Not Received

1. **Check spam/junk folder**
2. **Verify email address is correct**
3. **Check Zoho Mail quota** (if using free tier)
4. **Check server logs** for sending errors

## Zoho Mail Limits

### Free Tier
- **Daily limit**: 500 emails
- **Hourly limit**: ~100 emails
- **Storage**: 5GB per user

### Paid Plans
- **Daily limit**: Higher limits based on plan
- **Better deliverability**
- **Priority support**

## Security Best Practices

1. **Use app-specific passwords** instead of your main password
2. **Enable 2FA** on your Zoho account
3. **Encrypt environment variables** in production
4. **Use HTTPS** for all email verification links
5. **Monitor email logs** for suspicious activity
6. **Rotate passwords regularly**

## Alternative Email Providers

If you want to switch from Zoho Mail to another provider, update `src/lib/email.ts`:

### Resend
```typescript
const resend = new Resend(process.env.RESEND_API_KEY);
await resend.emails.send({...});
```

### SendGrid
```typescript
const SMTP_CONFIG = {
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY
  }
};
```

### Gmail
```typescript
const SMTP_CONFIG = {
  host: 'smtp.gmail.com',
  port: 587,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD // Requires app password
  }
};
```

## API Endpoints

The following Better Auth endpoints are available:

### POST `/api/auth/email/signup`
Sign up with email and password, sends verification email

### POST `/api/auth/email/send-verification-email`
Resend verification email

### GET `/api/auth/email/verify`
Verify email with token

### POST `/api/auth/email/forget-password`
Request password reset email

### POST `/api/auth/email/reset-password`
Reset password with token

### POST `/api/auth/user/change-email`
Request email change (sends confirmation to current email)

## Support

For issues or questions:
- Check Better Auth docs: https://www.better-auth.com/docs
- Check Zoho Mail docs: https://www.zoho.com/mail/help/
- File an issue in the repository
