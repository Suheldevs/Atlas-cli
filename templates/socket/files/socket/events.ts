/**
 * The event contract, shared by this server and any TypeScript client.
 *
 * These two maps are the whole reason to use TypeScript with socket.io: once they are passed
 * through the generics below, `emit` and `on` only accept these event names with these payloads,
 * so a renamed event or a changed shape is a compile error instead of a message nobody receives.
 *
 * They describe the *intended* contract, not a guarantee. Payloads arrive as JSON from a client
 * you do not control, so the handlers re-check everything at runtime.
 */
import type { DefaultEventsMap, Namespace, Server, Socket } from 'socket.io';

export interface ChatMessage {
  readonly room: string;
  /** The sender's user id, taken from the verified token — never from the payload. */
  readonly from: string;
  readonly text: string;
  /** ISO 8601, stamped by the server. */
  readonly sentAt: string;
}

export interface SendMessagePayload {
  readonly room: string;
  readonly text: string;
}

/** Reply to a request the client sent with an acknowledgement callback. */
export interface AckResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface ClientToServerEvents {
  'room:join': (room: string, ack: (result: AckResult) => void) => void;
  'room:leave': (room: string) => void;
  'message:send': (payload: SendMessagePayload, ack: (result: AckResult) => void) => void;
}

export interface ServerToClientEvents {
  'message:new': (message: ChatMessage) => void;
  'room:joined': (room: string, userId: string) => void;
  'room:left': (room: string, userId: string) => void;
}

/** Whatever the handshake middleware proved about the client, available on every socket. */
export interface SocketData {
  userId: string;
}

/**
 * Events exchanged between server instances. Left as the default map: that only matters once
 * you run several Node processes behind a shared adapter such as @socket.io/redis-adapter.
 */
export type ServerSideEvents = DefaultEventsMap;

export type SocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  ServerSideEvents,
  SocketData
>;

export type ChatNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  ServerSideEvents,
  SocketData
>;

export type ChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  ServerSideEvents,
  SocketData
>;
