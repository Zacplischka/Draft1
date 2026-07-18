import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Ack, ErrorCode, Profile, SessionState } from '../shared/contract';
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
import { everyoneVotedAdvance } from './host-voting';
import { SESSION_ID_KEY } from './create-session';

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
  const [authEpoch, setAuthEpoch] = useState(0); // bumped after dev sign-in to re-run the effect
  const prevSnapshot = useRef<SessionState | null>(null);
  const [everyoneVoted, setEveryoneVoted] = useState(false); // "opening the Ranked list…" toast
  const [reportBack, setReportBack] = useState<Route>('session'); // where the report placeholder returns to

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
        setSessionState(s);
      });
      socket.on('connect', () => {
        unauthorized = 0;
        // On every (re)connect: profile:get routes first-time users to the form (contract).
        void socket!
          .emitWithAck('profile:get', {})
          .then((ack: Ack<{ displayName: string; profile: Profile | null }>) => {
            if (disposed || !('ok' in ack)) return;
            setDisplayName(ack.displayName);
            setProfile(ack.profile);
            setRoute(ack.profile ? 'home' : 'first-profile');
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

  if (route === 'loading') {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
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
    // Mount point for the Host report screen (#21) — placeholder until it lands.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 p-6">
        <p className="text-slate-500">The Host report is under construction.</p>
        <button
          onClick={() => setRoute(reportBack)}
          className="rounded-lg border border-indigo-300 px-5 py-2.5 font-medium text-indigo-600 hover:bg-indigo-50"
        >
          {reportBack === 'session' ? 'Back to Ranked list' : 'Back'}
        </button>
      </div>
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
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
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
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
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
