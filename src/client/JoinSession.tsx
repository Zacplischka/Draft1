import { useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SESSION_ID_KEY } from './create-session';
import { joinSession, previewSession, screenFor, type Preview, type Screen } from './join-session';
import { btnLink, btnPrimary } from './button';
import { ErrorText } from './Announce';

const CODE_LENGTH = 6;

/** Mock 04: segmented 6-digit code entry — one invisible input over six rendered boxes,
 *  so paste/backspace/caret come for free. */
function CodeInput({
  code,
  onChange,
  invalid,
  autoFocus,
}: {
  code: string;
  onChange: (code: string) => void;
  invalid: boolean;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="block">
      <span className={`mb-1 block text-sm font-medium ${invalid ? 'text-red-600' : 'text-slate-700'}`}>
        Join code
      </span>
      <span className="relative block">
        <input
          value={code}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={autoFocus}
          aria-invalid={invalid}
          className="absolute inset-0 h-full w-full opacity-0"
        />
        <span aria-hidden className="grid grid-cols-6 gap-2">
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <span
              key={i}
              className={`flex h-14 items-center justify-center rounded-lg border bg-white text-2xl font-semibold text-slate-900 ${
                invalid
                  ? 'border-red-400'
                  : focused && i === Math.min(code.length, CODE_LENGTH - 1)
                    ? 'border-indigo-500'
                    : 'border-slate-300'
              }`}
            >
              {code[i] ?? ''}
            </span>
          ))}
        </span>
      </span>
    </label>
  );
}

function PreviewRows({ preview, countClass }: { preview: Preview; countClass: string }) {
  return (
    <dl className="mt-6 space-y-3 text-left text-sm">
      <div>
        <dt className="text-slate-500">Workflow</dt>
        <dd className="font-medium text-slate-900">
          {preview.workflow === 'preset' ? 'Preset' : 'Crowdsourced'}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Participant cap</dt>
        <dd className="font-medium text-slate-900">{preview.participants.cap}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Participants</dt>
        <dd className={`font-medium ${countClass}`}>
          {preview.participants.count} / {preview.participants.cap}
        </dd>
      </div>
    </dl>
  );
}

function StatusBadge({ tone, glyph }: { tone: string; glyph: string }) {
  return (
    <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl ${tone}`}>
      {glyph}
    </div>
  );
}

export function JoinSession({
  socket,
  displayName,
  onBack,
  onJoined,
  onSwitchAccount,
  onProfileRequired,
}: {
  socket: Socket;
  displayName: string;
  onBack: () => void;
  onJoined: (sessionId: string) => void;
  onSwitchAccount: () => void;
  onProfileRequired: () => void;
}) {
  const [code, setCode] = useState('');
  const [screen, setScreen] = useState<'enter' | 'not-found' | Screen>('enter');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emit = (event: string, payload: unknown) => socket.emitWithAck(event, payload);

  function fail(err: unknown) {
    const codeOrMsg = err instanceof Error ? err.message : 'unknown';
    switch (codeOrMsg) {
      case 'profile-required': // gated emit routes to the first-time form (contract)
        onProfileRequired();
        return;
      case 'not-found':
        setScreen('not-found');
        return;
      // Join races after a stale preview land on the same screens as the preview (contract).
      case 'session-full':
        // The ack proves the room filled since preview — patch the stale count so the
        // screen doesn't say "cap reached" over a below-cap number.
        setPreview((p) => p && { ...p, participants: { ...p.participants, count: p.participants.cap } });
        setScreen('full');
        return;
      case 'voting-started':
        setScreen('voting-started');
        return;
      default:
        setError(`Something went wrong (${codeOrMsg}). Please try again.`);
    }
  }

  async function find() {
    setBusy(true);
    setError(null);
    try {
      const p = await previewSession(emit, code);
      setPreview(p);
      setScreen(screenFor(p));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const sessionId = await joinSession(emit, code);
      localStorage.setItem(SESSION_ID_KEY, sessionId); // the rejoin key (contract)
      onJoined(sessionId);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  const primaryButton = `${btnPrimary} mt-6 w-full rounded-lg px-4 py-2.5`;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">🗳️ Group Decision</span>
      </header>
      <main className="mx-auto max-w-md p-6">
        <button onClick={onBack} className={`${btnLink} text-sm`}>
          &lsaquo; Home
        </button>

        {screen === 'enter' && (
          <>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Join a session</h1>
            <p className="mt-1 text-slate-500">Enter the 6-digit Join code shared by the Host.</p>
            <div className="mt-6">
              <CodeInput code={code} onChange={setCode} invalid={false} autoFocus />
            </div>
            <button onClick={() => void find()} disabled={code.length < CODE_LENGTH || busy} className={primaryButton}>
              {busy ? 'Finding…' : 'Find session'}
            </button>
          </>
        )}

        {screen === 'not-found' && (
          <div className="mt-8 text-center">
            <StatusBadge tone="bg-red-100 text-red-500" glyph="!" />
            <h1 className="mt-4 text-2xl font-semibold text-slate-900">
              We couldn&rsquo;t find that Session
            </h1>
            <p className="mt-2 text-slate-500">Check the Join code and try again.</p>
            <div className="mt-6 text-left">
              <CodeInput code={code} onChange={setCode} invalid />
              <ErrorText className="mt-1">Check the Join code and try again.</ErrorText>
            </div>
            <button onClick={() => void find()} disabled={code.length < CODE_LENGTH || busy} className={primaryButton}>
              {busy ? 'Finding…' : 'Try again'}
            </button>
          </div>
        )}

        {(screen === 'found' || screen === 'rejoin') && preview && (
          <div className="mt-8 text-center">
            <StatusBadge tone="bg-green-100 text-green-600" glyph="✓" />
            <h1 className="mt-4 text-2xl font-semibold text-slate-900">Session found</h1>
            <p className="mt-2 text-slate-500">{preview.problem}</p>
            <PreviewRows preview={preview} countClass="text-green-600" />
            <button onClick={() => void join()} disabled={busy} className={primaryButton}>
              {busy ? 'Joining…' : screen === 'rejoin' ? 'Rejoin session' : 'Join session'}
            </button>
          </div>
        )}

        {screen === 'full' && preview && (
          <div className="mt-8 text-center">
            <StatusBadge tone="bg-red-100 text-red-500" glyph="👥" />
            <h1 className="mt-4 text-2xl font-semibold text-slate-900">This Session is full</h1>
            <p className="mt-2 text-slate-500">
              The participant cap of {preview.participants.cap} has been reached.
            </p>
            <PreviewRows preview={preview} countClass="text-red-600" />
            <button onClick={onBack} className={primaryButton}>
              Back to home
            </button>
          </div>
        )}

        {screen === 'voting-started' && preview && (
          <div className="mt-8 text-center">
            <StatusBadge tone="bg-red-100 text-red-500" glyph="🕐" />
            <h1 className="mt-4 text-2xl font-semibold text-slate-900">Voting has already started</h1>
            <p className="mt-2 text-slate-500">New Participants can&rsquo;t join after voting begins.</p>
            <PreviewRows preview={preview} countClass="text-slate-900" />
            <button onClick={onBack} className={primaryButton}>
              Back to home
            </button>
          </div>
        )}

        {error && <ErrorText className="mt-3">{error}</ErrorText>}

        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-800">
              {displayName
                .split(/\s+/)
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="text-sm text-slate-500">
              Joining as <span className="font-medium text-slate-900">{displayName}</span>
            </span>
          </span>
          <button
            onClick={onSwitchAccount}
            className={`${btnLink} text-sm`}
          >
            Switch account
          </button>
        </div>
      </main>
    </div>
  );
}
