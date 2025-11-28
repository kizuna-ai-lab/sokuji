import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

interface EmailConfig {
  user: string;
  password: string;
}

/**
 * Create SMTP transporter with provided credentials
 */
function createTransporter(config: EmailConfig) {
  return nodemailer.createTransport({
    host: 'smtp.zoho.jp',
    port: 465, // SSL port
    secure: true, // Use SSL
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
}

/**
 * Send email (generic function)
 */
export async function sendEmail(
  { to, subject, html, text, replyTo }: EmailOptions,
  config: EmailConfig
): Promise<void> {
  try {
    const transporter = createTransporter(config);

    const mailOptions: {
      from: string;
      to: string;
      subject: string;
      html?: string;
      text?: string;
      replyTo?: string;
    } = {
      from: `"Sokuji" <${config.user}>`,
      to,
      subject,
    };

    // Support both HTML and plain text emails
    if (html) {
      mailOptions.html = html;
      mailOptions.text = text || html.replace(/<[^>]*>/g, '');
    } else if (text) {
      mailOptions.text = text;
    }

    // Add Reply-To if provided
    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }

    const info = await transporter.sendMail(mailOptions);

    console.log('Email sent successfully:', {
      messageId: info.messageId,
      to,
      subject,
    });
  } catch (error) {
    console.error('Email sending failed:', error);
    throw new Error(`Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(
  {
    email,
    verificationUrl,
  }: {
    email: string;
    verificationUrl: string;
  },
  config: EmailConfig
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Sokuji!</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            Thank you for signing up for Sokuji AI Real-time Translation. Please click the button below to verify your email address:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}"
               style="display: inline-block; padding: 14px 32px; background: #10a37f; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
              Verify Email Address
            </a>
          </div>

          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="font-size: 12px; color: #999; word-break: break-all; background: #fff; padding: 10px; border-radius: 4px;">
            ${verificationUrl}
          </p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="font-size: 12px; color: #999; margin: 0;">
            This verification link will expire in 24 hours.<br>
            If you didn't sign up for Sokuji, please ignore this email.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
          <p>© 2025 Sokuji - AI Real-time Translation Service</p>
        </div>
      </body>
    </html>
  `;

  await sendEmail(
    {
      to: email,
      subject: 'Verify Your Sokuji Account',
      html,
    },
    config
  );
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  {
    email,
    resetUrl,
  }: {
    email: string;
    resetUrl: string;
  },
  config: EmailConfig
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Reset Your Password</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            We received a request to reset the password for your Sokuji account. Click the button below to set a new password:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}"
               style="display: inline-block; padding: 14px 32px; background: #e74c3c; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
              Reset Password
            </a>
          </div>

          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="font-size: 12px; color: #999; word-break: break-all; background: #fff; padding: 10px; border-radius: 4px;">
            ${resetUrl}
          </p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="font-size: 12px; color: #999; margin: 0;">
            This reset link will expire in 1 hour.<br>
            If you didn't request a password reset, please ignore this email. Your password will not be changed.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
          <p>© 2025 Sokuji - AI Real-time Translation Service</p>
        </div>
      </body>
    </html>
  `;

  await sendEmail(
    {
      to: email,
      subject: 'Reset Your Sokuji Password',
      html,
    },
    config
  );
}

/**
 * Send OTP email for password reset or verification
 */
export async function sendOTPEmail(
  {
    email,
    otp,
    type,
  }: {
    email: string;
    otp: string;
    type: 'sign-in' | 'email-verification' | 'forget-password';
  },
  config: EmailConfig
): Promise<void> {
  const typeLabels = {
    'sign-in': { title: 'Sign In', action: 'sign in to' },
    'email-verification': { title: 'Verify Email', action: 'verify your email for' },
    'forget-password': { title: 'Reset Password', action: 'reset your password for' },
  };

  const { title, action } = typeLabels[type];

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">${title}</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            Use the following verification code to ${action} your Sokuji account:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <div style="display: inline-block; padding: 20px 40px; background: #fff; border: 2px dashed #10a37f; border-radius: 10px;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #10a37f; font-family: monospace;">
                ${otp}
              </span>
            </div>
          </div>

          <p style="font-size: 14px; color: #666; text-align: center;">
            Enter this code in the Sokuji app to continue.
          </p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="font-size: 12px; color: #999; margin: 0;">
            This code will expire in 10 minutes.<br>
            If you didn't request this code, please ignore this email.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
          <p>© 2025 Sokuji - AI Real-time Translation Service</p>
        </div>
      </body>
    </html>
  `;

  await sendEmail(
    {
      to: email,
      subject: `Your Sokuji Verification Code: ${otp}`,
      html,
    },
    config
  );
}

/**
 * Send email change confirmation email
 */
export async function sendEmailChangeConfirmation(
  {
    email,
    newEmail,
    confirmationUrl,
  }: {
    email: string;
    newEmail: string;
    confirmationUrl: string;
  },
  config: EmailConfig
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Confirm Email Change</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            You are changing your Sokuji account email address to:
          </p>

          <div style="background: #fff; padding: 15px; border-radius: 6px; border-left: 4px solid #10a37f; margin: 20px 0;">
            <strong style="color: #10a37f; font-size: 16px;">${newEmail}</strong>
          </div>

          <p style="font-size: 14px; color: #666;">
            If this was you, please click the button below to confirm the change:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${confirmationUrl}"
               style="display: inline-block; padding: 14px 32px; background: #10a37f; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
              Confirm Email Change
            </a>
          </div>

          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="font-size: 12px; color: #999; word-break: break-all; background: #fff; padding: 10px; border-radius: 4px;">
            ${confirmationUrl}
          </p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="font-size: 12px; color: #e74c3c; margin: 0;">
            ⚠️ If this wasn't you, please log in to your account immediately and change your password.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
          <p>© 2025 Sokuji - AI Real-time Translation Service</p>
        </div>
      </body>
    </html>
  `;

  await sendEmail(
    {
      to: email,
      subject: 'Confirm Your Email Change - Sokuji',
      html,
    },
    config
  );
}

/**
 * Send feedback/bug report email to support
 * Uses plain text format for easy reply workflow
 */
export async function sendFeedbackEmail(
  {
    fromEmail,
    feedbackType,
    message,
    userId,
    userAgent,
  }: {
    fromEmail: string;
    feedbackType: 'bug' | 'suggestion' | 'other';
    message: string;
    userId?: string;
    userAgent?: string;
  },
  config: EmailConfig
): Promise<void> {
  const typeLabels = {
    bug: 'Bug Report',
    suggestion: 'Feature Suggestion',
    other: 'General Feedback',
  };

  const title = typeLabels[feedbackType];
  const timestamp = new Date().toISOString();
  const supportEmail = 'support@kizuna.ai';

  // Simple plain text format for easy reply workflow
  const text = `New Feedback Received
=====================

Type: ${title}
From: ${fromEmail}
User ID: ${userId || 'N/A'}
Time: ${timestamp}

Message:
${message}

---
User Agent: ${userAgent || 'Unknown'}
`;

  await sendEmail(
    {
      to: supportEmail,
      replyTo: fromEmail,
      subject: `[Sokuji ${title}] From ${fromEmail}`,
      text,
    },
    config
  );
}
