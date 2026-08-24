import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';
import { buildPlanFromTemplate } from '../template-plan.js';

import { readSocketOptions, validateSocketOptions, type SocketOptions } from './socket.schema.js';

const META: GeneratorMeta = {
  name: 'socket',
  summary: 'Typed Socket.IO server with authenticated handshakes, rooms and a /chat namespace.',
  aliases: [],
  version: '1.0.0',
  argument: undefined,
  flags: [
    {
      flag: '--dir <path>',
      description: "Where to write the module. Defaults to the project's source directory.",
      defaultValue: undefined,
    },
  ],
  // Express only: the server attaches to the `http.Server` an Express app is served from, and
  // the template's `requires` declares the same thing.
  frameworks: ['express'],
  languages: ['typescript'],
};

const NOTES: readonly string[] = [
  'Set JWT_SECRET to at least 32 characters. The default handshake check verifies an HS256 JWT and takes its `sub` claim as the user id, so tokens from `atlas auth` work as they are.',
  'Set SOCKET_CORS_ORIGIN to a comma-separated list of browser origins. It defaults to http://localhost:5173.',
  'Attach it to your existing server: `const server = http.createServer(app);` then `const io = createSocketServer(server);` then `server.listen(port);` — call `server.listen`, not `app.listen`, or the sockets have nothing to attach to.',
  'On shutdown call `await closeSocketServer(io)` instead of `server.close()`: closing the io server closes the HTTP server with it.',
  'Clients connect to the namespace with `io("http://localhost:3000/chat", { auth: { token } })`.',
];

/**
 * The socket generator.
 *
 * One flag, no questions: the interesting decisions here are in the template — typed event maps,
 * an authenticated handshake — not in the options.
 */
export const socketGenerator: Generator<SocketOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The socket template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    if (context.project.framework !== 'express') {
      return {
        supported: false,
        reason: `The socket template targets Express, and this looks like ${context.project.framework}.`,
        hint: 'Nest and Fastify have their own websocket idioms; those generators are not written yet.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<SocketOptions> {
    return readSocketOptions(invocation.flags, context.project.layout.sourceDir);
  },

  validate(options: SocketOptions): void {
    validateSocketOptions(options);
  },

  generate(options: SocketOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildPlanFromTemplate({
      context,
      generator: META.name,
      template: 'socket',
      destinationPrefix: options.directory,
      notes: NOTES,
    });
  },
};
