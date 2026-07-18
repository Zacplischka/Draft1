import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Real auth is Supabase Google OAuth. Without VITE_SUPABASE_* env vars the client falls
// back to dev-token mode against scripts/dev-server.ts — no production credentials in
// local dev (README.md "Local development").
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const devAuth = !url || !anonKey;
const supabase: SupabaseClient | null = devAuth ? null : createClient(url!, anonKey!);

const DEV_NAME_KEY = 'dev-auth-name';

/** The CURRENT access token — read fresh at every socket (re)connect attempt.
 *  Supabase rotates tokens ~hourly; a token captured once fails reconnects after sleep. */
export async function getToken(): Promise<string | null> {
  if (devAuth) {
    const name = localStorage.getItem(DEV_NAME_KEY);
    return name ? `dev:${name}` : null;
  }
  const { data } = await supabase!.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithGoogle(): Promise<void> {
  await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
}

export function devSignIn(name: string): void {
  localStorage.setItem(DEV_NAME_KEY, name);
}

export async function signOut(): Promise<void> {
  if (devAuth) localStorage.removeItem(DEV_NAME_KEY);
  else await supabase!.auth.signOut();
}
