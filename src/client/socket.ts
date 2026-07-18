import { io, type Socket } from 'socket.io-client';
import { getToken } from './auth';

/** Connects to the room engine on the same origin (vite proxies /socket.io in dev).
 *  `auth` is a callback so EVERY (re)connect attempt reads the current token —
 *  a token captured once would fail reconnects after it expires (contract). */
export function connectSocket(): Socket {
  return io({
    transports: ['websocket'],
    auth: (cb) => {
      void getToken().then((token) => cb({ token }));
    },
  });
}
