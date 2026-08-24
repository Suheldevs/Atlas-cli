/**
 * Ambient declarations for the three packages `templates/auth` declares but this repository does
 * not install: `argon2` compiles a native module, and `mongoose` and `@prisma/client` are large and
 * would need `prisma generate` to be meaningful.
 *
 * Everything else the auth template imports — jose, zod, express, cookie-parser — is a real
 * devDependency here and resolves to its real types. That is the default, and this file is the
 * exception. See the header of `ambient.d.ts` for why: an earlier shim declared `express`, which
 * the template had never declared, and the gate reported PASS on code that could not compile.
 *
 * Each declaration below models only the surface the templates actually call, at the real types.
 * Widening one to `any` to make an error go away removes the only thing this file is for. Where a
 * declaration is deliberately *narrower* than reality that is fine — narrower can only produce a
 * false failure, never a false pass.
 */

declare module 'argon2' {
  /** The `type` discriminator. Only argon2id is used; argon2i and argon2d are not modelled. */
  export const argon2id: unique symbol;

  export interface HashOptions {
    readonly type?: typeof argon2id;
    readonly memoryCost?: number;
    readonly timeCost?: number;
    readonly parallelism?: number;
  }

  export function hash(password: string, options?: HashOptions): Promise<string>;

  /** Throws rather than returning false when `hash` is not a well-formed PHC string. */
  export function verify(hash: string, password: string): Promise<boolean>;
}

declare module 'mongoose' {
  export namespace Types {
    class ObjectId {
      /** Real Mongoose accepts a hex string, a buffer or another ObjectId; only the string form is used. */
      constructor(value?: string);
      toString(): string;
      /** Guards `new ObjectId(...)` against a caller-supplied id that would otherwise throw. */
      static isValid(value: string): boolean;
    }
  }

  /** Every document the templates touch reaches Mongoose through a typed interface extending this. */
  export interface Document {
    // Intentionally empty: the templates declare their own fields and never rely on Mongoose's
    // instance methods.
    readonly __document?: never;
  }

  export interface IndexOptions {
    readonly unique?: boolean;
    readonly expireAfterSeconds?: number;
  }

  export interface SchemaOptions {
    readonly versionKey?: boolean;
  }

  /**
   * The definition object is not modelled field by field. Mongoose accepts a large, deeply
   * polymorphic grammar there, and a partial model of it would reject valid definitions — a false
   * failure with no diagnostic value. What matters for the gate is that the *document* type is
   * checked, which the type parameter carries into the model below.
   */
  export class Schema<TDocument> {
    constructor(definition: Record<string, unknown>, options?: SchemaOptions);
    index(fields: Record<string, number>, options?: IndexOptions): void;
    readonly __document?: TDocument;
  }

  export interface Query<TResult> {
    exec(): Promise<TResult>;
  }

  export interface UpdateResult {
    readonly modifiedCount: number;
  }

  export interface DeleteResult {
    readonly deletedCount: number;
  }

  export interface Model<TDocument> {
    findOne(filter: Record<string, unknown>): Query<TDocument | null>;
    findById(id: string | Types.ObjectId): Query<TDocument | null>;
    create(document: Record<string, unknown>): Promise<TDocument>;
    updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ): Query<UpdateResult>;
    updateMany(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ): Query<UpdateResult>;
    deleteMany(filter: Record<string, unknown>): Query<DeleteResult>;
  }

  interface Mongoose {
    /** Typed as `unknown` so a template has to narrow it, which is what the real guard does. */
    readonly models: Record<string, unknown>;
    model<TDocument>(name: string, schema: Schema<TDocument>): Model<TDocument>;
    readonly Types: typeof Types;
  }

  const mongoose: Mongoose;
  export default mongoose;
}

declare module '@prisma/client' {
  interface UserRow {
    readonly id: string;
    readonly email: string;
    readonly passwordHash: string;
    readonly role: string;
    readonly createdAt: Date;
  }

  interface RefreshTokenRow {
    readonly jti: string;
    readonly family: string;
    readonly userId: string;
    readonly expiresAt: Date;
    readonly revokedAt: Date | null;
  }

  interface BatchResult {
    readonly count: number;
  }

  interface UserDelegate {
    findUnique(args: { readonly where: Record<string, unknown> }): Promise<UserRow | null>;
    create(args: { readonly data: Record<string, unknown> }): Promise<UserRow>;
    update(args: {
      readonly where: Record<string, unknown>;
      readonly data: Record<string, unknown>;
    }): Promise<UserRow>;
  }

  interface RefreshTokenDelegate {
    findUnique(args: {
      readonly where: Record<string, unknown>;
    }): Promise<RefreshTokenRow | null>;
    create(args: { readonly data: Record<string, unknown> }): Promise<RefreshTokenRow>;
    updateMany(args: {
      readonly where: Record<string, unknown>;
      readonly data: Record<string, unknown>;
    }): Promise<BatchResult>;
    deleteMany(args: { readonly where: Record<string, unknown> }): Promise<BatchResult>;
  }

  export interface PrismaClientOptions {
    readonly log?: readonly ('query' | 'info' | 'warn' | 'error')[];
    readonly datasources?: Record<string, { readonly url: string }>;
  }

  export class PrismaClient {
    constructor(options?: PrismaClientOptions);
    readonly user: UserDelegate;
    readonly refreshToken: RefreshTokenDelegate;
    /** Closes the connection pool. Called from a shutdown hook, so it is part of the surface. */
    $disconnect(): Promise<void>;
    $connect(): Promise<void>;
  }
}
