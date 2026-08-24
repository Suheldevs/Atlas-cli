import type { Server as HttpServer } from 'node:http';

import { jwtVerify } from 'jose';
import { Server } from 'socket.io';

import type {
  ClientToServerEvents,
  ServerSideEvents,
  ServerToClientEvents,
  SocketData,
  SocketServer,
} from './events__IMPORT_SUFFIX__';
import { registerChatHandlers } from './handlers__IMPORT_SUFFIX__';

/** Clients connect to `io('http://host/chat', { auth: { token } })`. */
export const CHAT_NAMESPACE = '/chat';

/** Turns a handshake token into a user id. Throws or rejects if the token is not good. */
export type VerifyToken = (token: string) => Promise<string> | string;

export interface SocketServerOptions {
  /** Defaults to HS256 verification against JWT_SECRET. */
  readonly verifyToken?: VerifyToken;
}

/**
 * Explicit origins rather than `*`, read from SOCKET_CORS_ORIGIN as a comma-separated list.
 * Browsers reject `*` on a credentialed request anyway, so `*` here only looks permissive.
 */
function allowedOrigins(): string[] {
  const configured = process.env['SOCKET_CORS_ORIGIN'] ?? 'http://localhost:5173';

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

function jwtSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'];

  if (secret === undefined || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters to authenticate sockets.');
  }

  return new TextEncoder().encode(secret);
}

/**
 * The default verification: an HS256 JWT signed with JWT_SECRET, whose `sub` claim is the user id.
 * That is the token `atlas auth` issues, so the two modules line up with no extra wiring. If your
 * access tokens look different, pass your own `verifyToken` instead of editing this.
 */
async function verifyJwt(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] });

  if (payload.sub === undefined || payload.sub === '') {
    throw new Error('Token has no subject claim.');
  }

  return payload.sub;
}

/**
 * Attaches a Socket.IO server to an HTTP server you already created.
 *
 * Nothing is listening yet: call `httpServer.listen(port)` afterwards, as usual.
 */
export function createSocketServer(
  httpServer: HttpServer,
  options: SocketServerOptions = {},
): SocketServer {
  const verifyToken = options.verifyToken ?? verifyJwt;

  const io = new Server<ClientToServerEvents, ServerToClientEvents, ServerSideEvents, SocketData>(
    httpServer,
    {
      cors: { origin: allowedOrigins(), credentials: true },
    },
  );

  const chat = io.of(CHAT_NAMESPACE);

  // Authentication happens here, before the connection is accepted. Skipping it leaves a
  // wide-open channel: anyone who can reach the port could join rooms and read every message.
  chat.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth['token'];

    if (typeof token !== 'string' || token === '') {
      next(new Error('Authentication token missing.'));
      return;
    }

    try {
      socket.data.userId = await verifyToken(token);
      next();
    } catch {
      // Deliberately vague to the client; log the cause server-side if you need the detail.
      next(new Error('Authentication failed.'));
    }
  });

  chat.on('connection', (socket) => {
    registerChatHandlers(chat, socket);
  });

  return io;
}

/**
 * Graceful shutdown. Call this from your SIGTERM handler.
 *
 * `io.close()` closes the HTTP server it was attached to as well, so call this *instead of*
 * `httpServer.close()` rather than in addition to it.
 */
export async function closeSocketServer(io: SocketServer): Promise<void> {
  // Disconnect first, with `close: true`, so clients see the socket go down and stop retrying
  // instead of hammering a server that is on its way out.
  io.of(CHAT_NAMESPACE).disconnectSockets(true);
  await io.close();
}
