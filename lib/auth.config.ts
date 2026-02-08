import type { NextAuthConfig } from 'next-auth';
import { Pool } from '@neondatabase/serverless';
import NeonAdapter from '@auth/neon-adapter';
import EmailProvider from 'next-auth/providers/email';
import { Resend } from 'resend';

const VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
const VERIFICATION_COOLDOWN_MS = 30 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 5;

type VerificationAttemptState = {
  count: number;
  windowStart: number;
  lastSentAt: number;
};

const verificationAttempts = new Map<string, VerificationAttemptState>();

function getRateLimitError(identifier: string): Error | null {
  const now = Date.now();
  const key = identifier.toLowerCase();
  const existing = verificationAttempts.get(key);

  if (!existing) {
    verificationAttempts.set(key, { count: 1, windowStart: now, lastSentAt: now });
    return null;
  }

  const windowExpired = now - existing.windowStart > VERIFICATION_WINDOW_MS;
  if (windowExpired) {
    verificationAttempts.set(key, { count: 1, windowStart: now, lastSentAt: now });
    return null;
  }

  if (now - existing.lastSentAt < VERIFICATION_COOLDOWN_MS) {
    return new Error('Please wait before requesting another magic link.');
  }

  if (existing.count >= VERIFICATION_MAX_ATTEMPTS) {
    return new Error('Too many magic link requests. Please try again later.');
  }

  verificationAttempts.set(key, {
    count: existing.count + 1,
    windowStart: existing.windowStart,
    lastSentAt: now,
  });
  return null;
}

export const authConfig = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const resend = new Resend(process.env.AUTH_RESEND_KEY);
  const emailFrom = process.env.AUTH_EMAIL_FROM || 'onboarding@resend.dev';

  return {
    adapter: NeonAdapter(pool),
    providers: [
      EmailProvider({
        server: ' ',
        from: emailFrom,
        async sendVerificationRequest({ identifier, url }) {
          const normalizedEmail = identifier.trim().toLowerCase();
          const rateLimitError = getRateLimitError(normalizedEmail);
          if (rateLimitError) {
            throw rateLimitError;
          }

          const { error } = await resend.emails.send({
            from: emailFrom,
            to: normalizedEmail,
            subject: 'Sign in to My Wardrobe',
            html: `<p>Click the magic link to sign in</p><p><a href="${url}">Sign in</a></p>`,
          });

          if (error) {
            throw new Error(`Unable to send magic link email: ${error.message}`);
          }
        },
      }),
    ],
    secret: process.env.AUTH_SECRET,
  } satisfies NextAuthConfig;
};
