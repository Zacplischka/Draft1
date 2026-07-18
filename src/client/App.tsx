import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Ack, Profile, SessionState } from '../shared/contract';
import { getToken, signOut } from './auth';
import { connectSocket } from './socket';
import { SignIn } from './SignIn';
import { ProfileForm } from './ProfileForm';
import { Home } from './Home';
import { CreateSession } from './CreateSession';
import { JoinSession } from './JoinSession';
import { Lobby } from './Lobby';
import { CrowdsourcedParticipant } from './CrowdsourcedParticipant';
import { HostLobby } from './HostLobby';
import { PresetParticipant } from './PresetParticipant';

type Route = 'loading' | 'signed-out' | 'first-profile' | 'home' | 'create' | 'join' | 'session';

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
        if (!disposed) setSessionState(s);
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
    // Host lobbies (#16); crowdsourced participant submit/waiting (#15); preset participant
    // waiting (#16). Curation (host) + later phases stay on the placeholder.
    if (s && s.isHost && s.phase === 'lobby') {
      return (
        <HostLobby
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
  return (
    <>
      <Home
        displayName={displayName}
        onCreate={() => setRoute('create')}
        onJoin={() => setRoute('join')}
        onEditProfile={() => {
          setSaveError(null);
          setEditing(true);
        }}
        onSignOut={() => void handleSignOut()}
      />
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
