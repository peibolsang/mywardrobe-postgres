import "server-only";

import { sql } from "@/lib/db";

export interface UserProfile {
  ownerKey: string;
  defaultLocation: string | null;
  updatedAt: string | null;
}

const normalize = (value: unknown): string => String(value ?? "").trim();

export const normalizeDefaultLocation = (value: unknown): string | null => {
  const normalized = normalize(value);
  return normalized.length > 0 ? normalized : null;
};

export const getUserProfileByOwnerKey = async (ownerKey: string): Promise<UserProfile | null> => {
  const rows = (await sql`
    SELECT owner_key, default_location, updated_at
    FROM user_profile
    WHERE owner_key = ${ownerKey}
    LIMIT 1;
  `) as Array<{ owner_key: string; default_location: string | null; updated_at: string | Date | null }>;

  const row = rows[0];
  if (!row) return null;

  return {
    ownerKey: normalize(row.owner_key),
    defaultLocation: normalizeDefaultLocation(row.default_location),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};

export const upsertUserProfileDefaultLocation = async ({
  ownerKey,
  defaultLocation,
}: {
  ownerKey: string;
  defaultLocation: string | null;
}): Promise<UserProfile> => {
  const persistedDefaultLocation = normalizeDefaultLocation(defaultLocation);

  const rows = (await sql`
    INSERT INTO user_profile (owner_key, default_location)
    VALUES (${ownerKey}, ${persistedDefaultLocation})
    ON CONFLICT (owner_key)
    DO UPDATE SET
      default_location = EXCLUDED.default_location,
      updated_at = NOW()
    RETURNING owner_key, default_location, updated_at;
  `) as Array<{ owner_key: string; default_location: string | null; updated_at: string | Date | null }>;

  const row = rows[0];
  return {
    ownerKey: normalize(row?.owner_key),
    defaultLocation: normalizeDefaultLocation(row?.default_location),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
};
