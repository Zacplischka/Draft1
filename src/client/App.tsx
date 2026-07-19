import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { Ack, ErrorCode, Profile, SessionCancelled, SessionState } from '../shared/contract';
import { getToken, signOut } from './auth';
import { connectSocket } from './socket';
import { SignIn } from './SignIn';
import { ProfileForm } from './ProfileForm';
import { Home } from './Home';
import { History } from './History';
import { CreateSession } from './CreateSession';
import { JoinSession } from './JoinSession';
import { Lobby } from './Lobby';
import { CrowdsourcedParticipant } from './CrowdsourcedParticipant';
import { HostLobby } from './HostLobby';
import { HostVotingControl } from './HostVotingControl';
import { PresetParticipant } from './PresetParticipant';
import { Voting } from './Voting';
import { Curation } from './Curation';
import { RankedList } from './RankedList';
import { Report } from './Report';
import { everyoneVotedAdvance } from './host-voting';
import { SESSION_ID_KEY } from './create-session';
import { landedRoute, rejoinSession } from './reconnect';
import { btnNeutral, btnGhost, Spinner } from './button';

type Route =
  | 'loading'
  | 'signed-out'
  | 'first-profile'
  | 'home'
  | 'history'
  | 'create'
  | 'join'
  | 'session'
  | 'report';

export default function App() {
  const [route, setRoute] = useState<Route>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeSessionId = useRef<string | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0); // bumped after dev sign-in to re-run the effect
  const prevSnapshot = useRef<SessionState | null>(null);
  const coldRejoin = useRef<string | null>(null); // sessionId whose first snapshot decides the cold-load landing (#23)
  const [conn, setConn] = useState<'online' | 'offline' | 'restored'>('online');
  const [everyoneVoted, setEveryoneVoted] = useState(false); // "opening the Ranked list…" toast
  const [sessionCancelled, setSessionCancelled] = useState(false);
  const [reportBack, setReportBack] = useState<Route>('session'); // where the report placeholder returns to

  function forgetSession() {
    activeSessionId.current = null;
    localStorage.removeItem(SESSION_ID_KEY);
    setSessionId(null);
    setSessionState(null);
    setRoute('home');
  }

  useEffect(() => {
    activeSessionId.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    let disposed = false;
    let socket: Socket | null = null;
    void (async () => {
      if (!(await getToken())) {
        if (!disposed) setRoute('signed-out');
        return;
      }
      socket = connectSocket();
      socketRef.current = socket;
      let unauthorized = 0;
      socket.on('connect_error', (err) => {
        // Transport errors auto-reconnect (auth callback re-reads the token), but a
        // middleware rejection is FATAL to socket.io — no automatic retry. Contract:
        // retry once with a freshly-read token; a second rejection means signed out —
        // never loop (or hang) silently.
        if (err.message !== 'unauthorized') return;
        if (++unauthorized < 2) {
          socket!.connect();
          return;
        }
        socket!.disconnect();
        void signOut().then(() => {
          if (!disposed) setRoute('signed-out');
        });
      });
      socket.on('session:state', (s: SessionState) => {
        if (disposed) return;
        if (everyoneVotedAdvance(prevSnapshot.current, s)) {
          setEveryoneVoted(true);
          setTimeout(() => {
            if (!disposed) setEveryoneVoted(false);
          }, 4000);
        }
        prevSnapshot.current = s;
        // Cold-load auto-rejoin: this session's first snapshot decides where we land (#23).
        if (coldRejoin.current === s.sessionId) {
          coldRejoin.current = null;
          if (landedRoute('cold', s.phase) === 'home') {
            localStorage.removeItem(SESSION_ID_KEY); // finished session — dead rejoin key
            setRoute('home');
            return;
          }
          setSessionId(s.sessionId);
          setRoute('session');
        }
        setSessionState(s);
      });
      socket.on('session:cancelled', ({ sessionId: cancelledId, isHost }: SessionCancelled) => {
        if (
          disposed ||
          (activeSessionId.current !== cancelledId && localStorage.getItem(SESSION_ID_KEY) !== cancelledId)
        ) {
          return;
        }
        forgetSession();
        if (isHost) return;
        setSessionCancelled(true);
        setTimeout(() => {
          if (!disposed) setSessionCancelled(false);
        }, 4000);
      });
      // Auto-rejoin the stored session; a stale id clears the key and lands home (#23).
      async function resume(id: string, kind: 'cold' | 'reconnect') {
        if (kind === 'cold') coldRejoin.current = id;
        const r = await rejoinSession((event, payload) => socket!.emitWithAck(event, payload), id).catch(() => null);
        if (disposed || r === 'rejoined') return; // rejoined → the snapshot broadcast lands us
        coldRejoin.current = null;
        // Only a definitive not-found kills the key — a transient failure keeps it for next time.
        if (r === 'stale') localStorage.removeItem(SESSION_ID_KEY);
        // Clear only the DEAD session's state — a report/other screen open on a different
        // session must not lose its id under it.
        setSessionId((cur) => (cur === id ? null : cur));
        setSessionState((cur) => (cur?.sessionId === id ? null : cur));
        setRoute((prev) => (kind === 'cold' || prev === 'session' ? 'home' : prev));
      }
      let hadConnection = false;
      socket.on('disconnect', (reason) => {
        // Deliberate disconnects (sign-out, unmount) aren't "offline".
        if (disposed || reason === 'io client disconnect') return;
        setConn('offline');
      });
      socket.on('connect', () => {
        unauthorized = 0;
        if (hadConnection) {
          // Reconnect: back-online banner + silent rejoin — never yank the user's route.
          setConn('restored');
          setTimeout(() => {
            if (!disposed) setConn((c) => (c === 'restored' ? 'online' : c));
          }, 4000);
          const stored = localStorage.getItem(SESSION_ID_KEY);
          if (stored) void resume(stored, 'reconnect');
          return;
        }
        hadConnection = true;
        // First connect: profile:get routes first-time users to the form (contract).
        void socket!
          .emitWithAck('profile:get', {})
          .then((ack: Ack<{ displayName: string; profile: Profile | null }>) => {
            if (disposed || !('ok' in ack)) return;
            setDisplayName(ack.displayName);
            setProfile(ack.profile);
            if (!ack.profile) {
              setRoute('first-profile');
              return;
            }
            // Cold load with a stored live session rejoins automatically — "we'll bring
            // you back here" (#23). Route stays 'loading' until its snapshot lands.
            const stored = localStorage.getItem(SESSION_ID_KEY);
            if (stored) void resume(stored, 'cold');
            else setRoute('home');
          });
      });
    })();
    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [authEpoch]);

  async function saveProfile(p: Profile) {
    setSaveError(null);
    const ack: Ack = await socketRef.current!.emitWithAck('profile:set', p);
    if (!('ok' in ack)) {
      // profile-required routes to the first-time form (contract) — unreachable from
      // profile:set (it's gate-exempt), but #13/#14's gated emits must keep this rule.
      if (ack.error === 'profile-required') {
        setEditing(false);
        setRoute('first-profile');
        return;
      }
      setSaveError(`Could not save profile (${ack.error}). Please try again.`);
      return;
    }
    // Per contract the change affects only FUTURE ballots — nothing else to refresh.
    setProfile(p);
    setEditing(false);
    setRoute('home');
  }

  // Dashboard "Open session" / "View ranked list": sessionId rejoin, legal in ANY phase
  // (contract). Resolves the ErrorCode on failure so the dashboard can surface it.
  async function openSession(id: string): Promise<ErrorCode | null> {
    const ack: Ack = await socketRef.current!.emitWithAck('session:join', { sessionId: id });
    if (!('ok' in ack)) {
      if (ack.error === 'profile-required') setRoute('first-profile');
      return ack.error;
    }
    localStorage.setItem(SESSION_ID_KEY, id); // the rejoin key (contract)
    setSessionId(id);
    setRoute('session');
    return null;
  }

  // Report placeholder (#21): remember the session and where to return to.
  function openReport(id: string, back: Route) {
    setSessionId(id);
    setReportBack(back);
    setRoute('report');
  }

  async function handleSignOut() {
    socketRef.current?.disconnect();
    await signOut();
    setProfile(null);
    setDisplayName('');
    setEditing(false);
    setRoute('signed-out');
  }

  function screen() {
    if (route === 'loading') {
      return (
        <div className="flex min-h-screen items-center justify-center gap-3 text-slate-400">
          <Spinner className="h-5 w-5" /> Loading…
        </div>
      );
    }
    if (route === 'signed-out') {
      return (
        <SignIn
          onDevSignIn={() => {
            setRoute('loading');
            setAuthEpoch((n) => n + 1);
          }}
        />
      );
    }
    if (route === 'first-profile') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
            <div className="mb-2 text-center font-semibold text-slate-900">🗳️ Group Decision</div>
            <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">
              Complete your profile
            </h1>
            <ProfileForm
              initial={null}
              submitLabel="Save profile"
              onSave={(p) => void saveProfile(p)}
              error={saveError}
            />
            <p className="mt-4 text-center text-xs text-slate-500">
              🔒 Used only for anonymous, suppression-filtered reports.
            </p>
          </div>
        </div>
      );
    }
    if (route === 'create') {
      return (
        <CreateSession
          socket={socketRef.current!}
          onBack={() => setRoute('home')}
          onCreated={(id) => {
            setSessionId(id);
            setRoute('session');
          }}
          onProfileRequired={() => setRoute('first-profile')}
        />
      );
    }
    if (route === 'join') {
      return (
        <JoinSession
          socket={socketRef.current!}
          displayName={displayName}
          onBack={() => setRoute('home')}
          onJoined={(id) => {
            setSessionId(id);
            setRoute('session');
          }}
          onSwitchAccount={() => void handleSignOut()}
          onProfileRequired={() => setRoute('first-profile')}
        />
      );
    }
    if (route === 'session') {
      // Only this session's snapshots — a stale broadcast from an earlier room must not render.
      const s = sessionState?.sessionId === sessionId ? sessionState : null;
      // Host lobbies (#16); curation (#17); crowdsourced participant submit/waiting (#15);
      // preset participant waiting (#16). Later phases stay on the placeholder.
      if (s && s.isHost && s.phase === 'curation') {
        return (
          <Curation
            state={s}
            emit={(event, payload) => socketRef.current!.emitWithAck(event, payload)}
          />
        );
      }
      if (s && s.isHost && s.phase === 'lobby') {
        return (
          <HostLobby
            state={s}
            emit={(event, payload) => socketRef.current!.emitWithAck(event, payload)}
          />
        );
      }
      if (s && s.phase === 'voting') {
        // Host control (#19) once the host has no ballot left to cast — a participating
        // host votes on the deck (#18) first, then lands on the control screen.
        if (s.isHost && (!s.hostParticipates || s.me.voted)) {
          return (
            <HostVotingControl
              state={s}
              emit={(event, payload) => socketRef.current!.emitWithAck(event, payload)}
            />
          );
        }
        return (
          <Voting
            state={s}
            emit={(event, payload) => socketRef.current!.emitWithAck(event, payload)}
          />
        );
      }
      if (s && !s.isHost && s.workflow === 'crowdsourced' && (s.phase === 'lobby' || s.phase === 'curation')) {
        return (
          <CrowdsourcedParticipant
            state={s}
            emit={(event, payload) => socketRef.current!.emitWithAck(event, payload)}
          />
        );
      }
      if (s && !s.isHost && s.workflow === 'preset' && s.phase === 'lobby') {
        return <PresetParticipant state={s} />;
      }
      if (s && s.phase === 'results') {
        return (
          <>
            <RankedList
              state={s}
              onDone={() => {
                localStorage.removeItem(SESSION_ID_KEY); // Done clears the rejoin key (contract)
                setSessionId(null);
                setSessionState(null);
                setRoute('home');
              }}
              onOpenReport={() => {
                setReportBack('session');
                setRoute('report');
              }}
            />
            {/* Everyone-voted auto-advance toast (#19) rides the voting → results flip. */}
            {everyoneVoted && (
              <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 shadow-lg">
                <span aria-hidden>✅</span> Everyone has voted — opening the Ranked list…
              </div>
            )}
          </>
        );
      }
      return (
        <Lobby
          state={s}
          onBack={() => {
            setSessionState(null);
            setRoute('home');
          }}
        />
      );
    }
    if (route === 'report') {
      // Host report (#21) — reached only from host surfaces (Ranked-list host panel,
      // dashboard, history); the HTTP endpoint 404s everyone else anyway.
      return (
        <Report
          sessionId={sessionId!}
          backLabel={reportBack === 'session' ? 'Back to Ranked list' : 'Back'}
          onBack={() => setRoute(reportBack)}
        />
      );
    }
    return (
      <>
        {route === 'history' ? (
          <History
            displayName={displayName}
            onHome={() => setRoute('home')}
            onEditProfile={() => {
              setSaveError(null);
              setEditing(true);
            }}
            onSignOut={() => void handleSignOut()}
            onCreate={() => setRoute('create')}
            onOpenReport={(id) => openReport(id, 'history')}
          />
        ) : (
          <Home
            displayName={displayName}
            onCreate={() => setRoute('create')}
            onJoin={() => setRoute('join')}
            onEditProfile={() => {
              setSaveError(null);
              setEditing(true);
            }}
            onSignOut={() => void handleSignOut()}
            onOpenSession={openSession}
            onOpenReport={(id) => openReport(id, 'home')}
            onOpenHistory={() => setRoute('history')}
          />
        )}
        {editing && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Edit profile</h2>
                <button
                  onClick={() => setEditing(false)}
                  aria-label="Close"
                  className={btnGhost}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <ProfileForm
                initial={profile}
                submitLabel="Save changes"
                onSave={(p) => void saveProfile(p)}
                error={saveError}
              >
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className={`${btnNeutral} flex-1 rounded-lg px-4 py-2.5`}
                >
                  Cancel
                </button>
              </ProfileForm>
            </div>
          </div>
        )}
      </>
    );
  }

  // Offline indicator / "You're back online" banner overlay every signed-in screen,
  // including the cold-load 'loading' rejoin window (#23).
  const chip =
    conn === 'online' || route === 'signed-out' ? null : conn === 'offline' ? (
      <div className="fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 shadow-lg">
        <span aria-hidden>📡</span> You're offline — reconnecting…
      </div>
    ) : (
      <div className="fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 shadow-lg">
        <span aria-hidden>✅</span> You're back online
      </div>
    );

  return (
    <>
      {screen()}
      {chip}
      {sessionCancelled && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 shadow-lg">
          <span aria-hidden>ℹ️</span> The host cancelled this session
        </div>
      )}
    </>
  );
}
