import type { MouseEvent } from 'react';

/** Minimal signed-in home: account menu + the two entry points.
 *  #14 wires Join; #22 replaces this with the dashboard. */
export function Home({
  displayName,
  onCreate,
  onJoin,
  onEditProfile,
  onSignOut,
}: {
  displayName: string;
  onCreate: () => void;
  onJoin: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
}) {
  // Native <details> dropdown; close it when a menu item is picked.
  const closeMenu = (e: MouseEvent) => e.currentTarget.closest('details')?.removeAttribute('open');
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-800">
            {displayName}
          </summary>
          <div className="absolute right-0 z-10 mt-2 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <button
              onClick={(e) => {
                closeMenu(e);
                onEditProfile();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Edit profile
            </button>
            <button
              onClick={(e) => {
                closeMenu(e);
                onSignOut();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </details>
      </header>
      <main className="mx-auto max-w-lg p-6 pt-16">
        <h1 className="text-center text-2xl font-semibold text-slate-900">
          What are we deciding today?
        </h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            onClick={onCreate}
            className="rounded-xl bg-indigo-600 px-6 py-4 font-medium text-white hover:bg-indigo-700"
          >
            Create session
          </button>
          <button
            onClick={onJoin}
            className="rounded-xl border border-indigo-600 bg-white px-6 py-4 font-medium text-indigo-600 hover:bg-indigo-50"
          >
            Join session
          </button>
        </div>
      </main>
    </div>
  );
}
