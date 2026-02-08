import 'server-only';

import { auth } from '@/lib/auth';

const OWNER_EMAIL = process.env.EDITOR_OWNER_EMAIL?.toLowerCase();

export async function isOwnerSession(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return Boolean(email && email === OWNER_EMAIL);
}

