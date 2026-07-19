import { useState } from 'react';
import { devAuth, devSignIn, signInWithGoogle } from './auth';
import { btnSecondary } from './button';

/** Signed-out screen per mock 01: hero + sign-in card with the trust copy.
 *  In dev-token mode the Google button becomes a name form (README.md). */
export function SignIn({ onDevSignIn }: { onDevSignIn: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="grid w-full max-w-4xl gap-10 md:grid-cols-2 md:items-center">
        <div>
          <div className="mb-6 text-xl font-semibold text-slate-900">🗳️ Group Decision</div>
          <h1 className="text-4xl font-bold leading-tight text-slate-900">
            Decide honestly.
            <br />
            Move forward together.
          </h1>
          <p className="mt-4 text-slate-600">
            Real-time anonymous confidence voting helps groups see the full picture and move forward
            with clarity.
          </p>
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="text-center text-xl font-semibold text-slate-900">Welcome back</h2>
          <p className="mt-1 text-center text-sm text-slate-500">
            Sign in to continue to Group Decision.
          </p>
          {devAuth ? (
            <form
              className="mt-6 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                devSignIn(name.trim());
                onDevSignIn();
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                aria-label="Dev sign-in name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-indigo-500"
              />
              <button className={`${btnSecondary} w-full rounded-lg border-indigo-600 px-4 py-2.5`}>
                Continue (dev sign-in)
              </button>
              <p className="text-center text-xs text-slate-400">
                Dev-token mode — no Supabase configured.
              </p>
            </form>
          ) : (
            <button
              onClick={() => void signInWithGoogle()}
              className={`${btnSecondary} mt-6 w-full rounded-lg border-indigo-600 px-4 py-2.5`}
            >
              <span className="mr-2 font-bold">G</span>
              Continue with Google
            </button>
          )}
          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <hr className="flex-1 border-slate-200" />
            or
            <hr className="flex-1 border-slate-200" />
          </div>
          <p className="text-center text-sm text-slate-600">
            ✅ Individual scores are never shared.
          </p>
        </div>
      </div>
    </div>
  );
}
