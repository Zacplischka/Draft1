import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Emit } from './create-session';
import { cancelSession } from './host-lobby';
import { ErrorText } from './Announce';
import { btnDanger, btnGhost, btnGhostDanger, btnNeutral, BusyButton } from './button';
import { Modal } from './Modal';

export function CancelSessionButton({ emit, className }: { emit: Emit; className: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setBusy(true);
    setError(null);
    cancelSession(emit)
      .catch((err) =>
        setError(`Something went wrong (${err instanceof Error ? err.message : 'unknown'}). Please try again.`),
      )
      .finally(() => setBusy(false));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`${btnGhostDanger} ${className}`}
      >
        Cancel session
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} className="m-auto w-[calc(100%-2rem)] max-w-sm">
          <div className="relative rounded-2xl bg-white p-6 text-center shadow-xl">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className={`${btnGhost} absolute right-4 top-4`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500"
              aria-hidden
            >
              <Trash2 className="h-6 w-6" />
            </div>
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Cancel this session?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Everyone will be ejected and all submissions and votes discarded.
            </p>
            {error && <ErrorText className="mt-2">{error}</ErrorText>}
            <div className="mt-5 flex justify-center gap-3">
              <button
                data-autofocus
                onClick={() => setOpen(false)}
                className={`${btnNeutral} rounded-lg px-5 py-2.5`}
              >
                Keep session
              </button>
              <BusyButton
                onClick={confirm}
                busy={busy}
                busyLabel="Cancelling…"
                className={`${btnDanger} rounded-lg px-5 py-2.5`}
              >
                Cancel session
              </BusyButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
