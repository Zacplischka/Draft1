import { useState } from 'react';
import { SOLUTION_MAX_LENGTH, type SessionState } from '../shared/contract';
import type { Emit } from './create-session';
import { JoinCode, Stepper } from './HostLobby';
import { Modal } from './Modal';
import { ErrorText } from './Announce';
import { btnPrimary, btnDanger, btnSecondary, btnNeutral, btnLink, btnGhost, btnGhostDanger } from './button';
import {
  addSolution,
  combineSolutions,
  defaultCombinedText,
  deleteSolution,
  editSolution,
  hostSteps,
  startVoting,
} from './host-lobby';

type Row = NonNullable<SessionState['deck']>[number];

function CombineModal({
  sources,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  sources: Row[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState(() => defaultCombinedText(sources.map((s) => s.text)));
  return (
    <Modal onClose={onCancel} className="m-auto w-[calc(100%-2rem)] max-w-lg">
      <div className="rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Combine {sources.length} Solutions</h2>
          <button onClick={onCancel} aria-label="Close" className={btnGhost}>
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Edit this into one clear Solution.</p>
        <label className="mt-4 block text-sm text-slate-600" htmlFor="combined-text">
          Solution (required)
        </label>
        <textarea
          id="combined-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, SOLUTION_MAX_LENGTH))}
          rows={3}
          data-autofocus
          className="mt-1 w-full rounded-xl border border-indigo-300 bg-white p-3 text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-3 text-sm font-medium text-slate-700">
          ⧉ Combined from {sources.length} Solutions
        </div>
        <ul className="mt-1 list-disc pl-6 text-sm text-slate-500">
          {sources.map((s) => (
            <li key={s.id} className="break-words">
              {s.text}
            </li>
          ))}
        </ul>
        {error && <ErrorText className="mt-3">{error}</ErrorText>}
        <div className="mt-5 flex justify-between gap-3">
          <button
            onClick={onCancel}
            className={`${btnNeutral} rounded-lg px-5 py-2.5`}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(text.trim())}
            disabled={!text.trim() || busy}
            className={`${btnPrimary} rounded-lg px-6 py-2.5`}
          >
            Combine
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel} className="m-auto w-[calc(100%-2rem)] max-w-sm">
      <div className="relative rounded-2xl bg-white p-6 text-center shadow-xl">
        <button
          onClick={onCancel}
          aria-label="Close"
          className={`${btnGhost} absolute right-4 top-4`}
        >
          ✕
        </button>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-xl" aria-hidden>
          🗑️
        </div>
        <h2 className="mt-3 text-lg font-semibold text-slate-900">Remove this Solution?</h2>
        <p className="mt-1 text-sm text-slate-500">This can&rsquo;t be undone after voting starts.</p>
        {error && <ErrorText className="mt-2">{error}</ErrorText>}
        <div className="mt-5 flex justify-center gap-3">
          <button
            onClick={onCancel}
            className={`${btnNeutral} rounded-lg px-5 py-2.5`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`${btnDanger} rounded-lg px-6 py-2.5`}
          >
            Remove
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Mock 07 — the crowdsourced host's Curation screen: combine, edit, delete, start voting. */
export function Curation({ state, emit }: { state: SessionState; emit: Emit }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Frozen at modal open — the ids sent always match the sources shown, even if a snapshot lands mid-modal.
  const [combineSources, setCombineSources] = useState<Row[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [emptyDeck, setEmptyDeck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deck = state.deck ?? [];
  // Selection is derived against the live deck, so ids deleted/combined away just drop out.
  const selectedRows = deck.filter((d) => selected.has(d.id));
  const fail = (err: unknown) =>
    setError(`Something went wrong (${err instanceof Error ? err.message : 'unknown'}). Please try again.`);

  function run(op: Promise<unknown>, then?: () => void) {
    setBusy(true);
    setError(null);
    op.then(then)
      .catch(fail)
      .finally(() => setBusy(false));
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function add() {
    const text = draft.trim();
    if (!text) return;
    run(addSolution(emit, text), () => {
      setDraft('');
      setEmptyDeck(false);
    });
  }
  function saveEdit(id: string) {
    const text = editText.trim();
    setEditingId(null);
    if (text) run(editSolution(emit, id, text));
  }
  function confirmCombine(text: string) {
    run(
      combineSolutions(
        emit,
        combineSources!.map((r) => r.id),
        text,
      ),
      () => {
        setCombineSources(null);
        setSelected(new Set());
        setEmptyDeck(false);
      },
    );
  }
  function confirmDelete(id: string) {
    run(deleteSolution(emit, id), () => setDeleteTarget(null));
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      // Disabled at zero locally, but a raced empty deck still acks empty-deck — surface it.
      setEmptyDeck((await startVoting(emit)) === 'empty-deck');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
        <span className="rounded-full border border-slate-300 px-3 py-0.5 text-sm text-slate-700">
          👤 Crowdsourced
        </span>
      </header>
      <main className="mx-auto max-w-2xl p-4 pb-10 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          {state.joinCode && <JoinCode code={state.joinCode} />}
          <div>
            <div className="text-sm text-slate-500">Participants</div>
            <div className="text-2xl font-semibold text-slate-900">
              <span className="text-green-600">{state.participants.count}</span> / {state.participants.cap}
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Workflow</div>
            <span className="mt-1 inline-block rounded-full bg-indigo-50 px-3 py-0.5 text-sm font-medium text-indigo-700">
              Crowdsourced
            </span>
          </div>
        </div>

        <Stepper steps={hostSteps(state.workflow)} active={1} />

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <span aria-hidden>❓</span>
          <p className="font-medium text-slate-900">{state.problem}</p>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Curate the Deck</h2>
            <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-sm font-medium text-indigo-700">
              {deck.length} Solutions in Deck
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Combine duplicates, edit wording, or remove irrelevant Solutions.</p>

          {deck.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <div className="text-2xl" aria-hidden>
                📭
              </div>
              <p className="mt-2 text-slate-600">No Solutions in your Deck yet.</p>
              <p className="mt-1 text-sm font-medium text-red-600">Add at least one Solution before starting voting.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {deck.map((d) =>
                editingId === d.id ? (
                  <li key={d.id} className="flex items-center gap-2 rounded-xl border border-indigo-300 px-3 py-2">
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(d.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      maxLength={SOLUTION_MAX_LENGTH}
                      autoFocus
                      className="w-full bg-transparent py-1 text-slate-900 focus:outline-none"
                    />
                    <button
                      onClick={() => saveEdit(d.id)}
                      className={`${btnLink} shrink-0 text-sm`}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className={`${btnGhost} shrink-0 text-sm`}
                    >
                      Cancel
                    </button>
                  </li>
                ) : (
                  <li
                    key={d.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                      selected.has(d.id) ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                      aria-label={`Select ${d.text}`}
                      className="h-4 w-4 shrink-0 accent-indigo-600"
                    />
                    <span className="min-w-0 flex-1 break-words text-slate-900">{d.text}</span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        onClick={() => {
                          setEditingId(d.id);
                          setEditText(d.text);
                        }}
                        aria-label={`Edit ${d.text}`}
                        className={`${btnGhost} rounded border border-slate-200 px-2 py-1`}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => {
                          setError(null);
                          setDeleteTarget(d);
                        }}
                        aria-label={`Delete ${d.text}`}
                        className={`${btnGhostDanger} rounded border border-slate-200 px-2 py-1`}
                      >
                        🗑️
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}

          {selectedRows.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-100 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">{selectedRows.length} selected</span>
              <button
                onClick={() => {
                  setError(null);
                  setCombineSources(selectedRows);
                }}
                disabled={selectedRows.length < 2 || busy}
                className={`${btnPrimary} rounded-lg px-4 py-2`}
              >
                Combine selected
              </button>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
              maxLength={SOLUTION_MAX_LENGTH}
              placeholder="Add a solution"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={add}
              disabled={!draft.trim() || busy}
              className={`${btnSecondary} shrink-0 rounded-lg border-indigo-600 px-3 py-2 text-sm`}
            >
              Add solution
            </button>
          </div>
        </div>

        {emptyDeck && deck.length > 0 && (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span aria-hidden>ℹ️</span> Add at least one Solution to start voting.
          </p>
        )}
        {error && <ErrorText className="mt-4">{error}</ErrorText>}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <span aria-hidden>🕐</span> You can leave this page — we&rsquo;ll bring you back here.
          </p>
          <button
            onClick={() => void start()}
            disabled={deck.length === 0 || busy}
            className={`${btnPrimary} rounded-lg px-6 py-3`}
          >
            Start voting
          </button>
        </div>
      </main>

      {combineSources && (
        <CombineModal
          sources={combineSources}
          busy={busy}
          error={error}
          onCancel={() => setCombineSources(null)}
          onConfirm={confirmCombine}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          busy={busy}
          error={error}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => confirmDelete(deleteTarget.id)}
        />
      )}
    </div>
  );
}
