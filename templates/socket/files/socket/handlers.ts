import type { AckResult, ChatMessage, ChatNamespace, ChatSocket } from './events__IMPORT_SUFFIX__';

const MAX_ROOM_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 2000;

/** Room names end up in adapter keys and client UIs, so keep them boring. */
const ROOM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

interface IncomingMessage {
  readonly room: string;
  readonly text: string;
}

/** The parameters are `unknown` because the event map is a contract, not a runtime guarantee. */
function readRoom(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const room = value.trim();

  if (room === '' || room.length > MAX_ROOM_LENGTH || !ROOM_PATTERN.test(room)) {
    return undefined;
  }

  return room;
}

function readMessage(value: unknown): IncomingMessage | undefined {
  if (typeof value !== 'object' || value === null || !('room' in value) || !('text' in value)) {
    return undefined;
  }

  const room = readRoom(value.room);
  const text = typeof value.text === 'string' ? value.text.trim() : '';

  if (room === undefined || text === '' || text.length > MAX_MESSAGE_LENGTH) {
    return undefined;
  }

  return { room, text };
}

/** A client can send an event without its acknowledgement callback, leaving nobody to answer. */
function respond(ack: (result: AckResult) => void, result: AckResult): void {
  if (typeof ack === 'function') {
    ack(result);
  }
}

export function registerChatHandlers(namespace: ChatNamespace, socket: ChatSocket): void {
  const { userId } = socket.data;

  socket.on('room:join', async (room, ack) => {
    const name = readRoom(room);

    if (name === undefined) {
      respond(ack, { ok: false, error: 'Invalid room name.' });
      return;
    }

    await socket.join(name);
    socket.to(name).emit('room:joined', name, userId);
    respond(ack, { ok: true });
  });

  socket.on('room:leave', async (room) => {
    const name = readRoom(room);

    if (name === undefined || !socket.rooms.has(name)) {
      return;
    }

    await socket.leave(name);
    namespace.to(name).emit('room:left', name, userId);
  });

  socket.on('message:send', (payload, ack) => {
    const incoming = readMessage(payload);

    if (incoming === undefined) {
      respond(ack, { ok: false, error: `Send a room and 1-${String(MAX_MESSAGE_LENGTH)} chars.` });
      return;
    }

    // Membership is the authorisation check. Without it any authenticated client could post into
    // a room it never joined.
    if (!socket.rooms.has(incoming.room)) {
      respond(ack, { ok: false, error: 'Join the room before sending to it.' });
      return;
    }

    const message: ChatMessage = {
      room: incoming.room,
      from: userId,
      text: incoming.text,
      sentAt: new Date().toISOString(),
    };

    // `namespace.to` includes the sender, so their own client renders the message it just sent.
    namespace.to(incoming.room).emit('message:new', message);
    respond(ack, { ok: true });
  });

  // `socket.rooms` is already empty by the time `disconnect` fires, so the rooms the user was in
  // have to be read here.
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      // Every socket is in a room named after its own id; that is not a chat room.
      if (room !== socket.id) {
        socket.to(room).emit('room:left', room, userId);
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`socket ${socket.id} (user ${userId}) disconnected: ${reason}`);
  });
}
