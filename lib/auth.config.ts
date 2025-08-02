import type { NextAuthConfig } from 'next-auth';
import { Pool } from '@neondatabase/serverless';
import NeonAdapter from '@auth/neon-adapter';
import EmailProvider from 'next-auth/providers/email';
import { Resend } from 'resend';

export const authConfig = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const resend = new Resend(process.env.AUTH_RESEND_KEY);

  return {
    adapter: NeonAdapter(pool),
  providers: [
    EmailProvider({
      server: ' ',
      from: ' ',
      sendVerificationRequest({ identifier: email, url }) {
        resend.emails.send({
          from: 'onboarding@resend.dev',
          to: email,
          subject: 'Sign in to My Wardrobe',
          html: `<p>Click the magic link to sign in</p><p><a href="${url}">Sign in</a></p>`,
        });
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
  } satisfies NextAuthConfig;
};
