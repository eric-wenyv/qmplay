import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface MusicCredential {
  musicid: number;
  musickey: string;
  loginType?: number;
  openid?: string;
  refresh_token?: string;
  access_token?: string;
  refresh_key?: string;
  unionid?: string;
  str_musicid?: string;
  expired_at?: number;
  musickeyCreateTime?: number;
  keyExpiresIn?: number;
}
export interface MusicSession {
  credential: MusicCredential;
  expiresAt: number;
}
export const SESSION_COOKIE = 'qq_music_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export const newToken = () => randomBytes(32).toString('hex');

// Only opaque tokens leave the server. Account credentials are authenticated and encrypted at rest.
export class SessionStore {
  private keyPromise?: Promise<Buffer>;
  private operations = new Map<string, Promise<void>>();
  private revoked = new Set<string>();
  constructor(
    private directory = process.env.QQ_MUSIC_AUTH_DIR ||
      path.join(os.homedir(), '.local/share/qq-music-api/auth'),
  ) {}
  private async key(): Promise<Buffer> {
    if (!this.keyPromise)
      this.keyPromise = (async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const filename = path.join(this.directory, 'key');
        try {
          await writeFile(filename, randomBytes(32), { mode: 0o600, flag: 'wx' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const key = await readFile(filename);
        if (key.length !== 32) throw new Error('Invalid authentication storage key');
        return key;
      })();
    return this.keyPromise;
  }
  private filename(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return path.join(this.directory, `${createHash('sha256').update(token).digest('hex')}.session`);
  }
  private serialize(token: string, operation: () => Promise<void>) {
    const pending = (this.operations.get(token) || Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.operations.set(token, pending);
    const cleanup = () => {
      if (this.operations.get(token) === pending) this.operations.delete(token);
    };
    pending.then(cleanup, cleanup);
    return pending;
  }
  async save(token: string, session: MusicSession) {
    return this.serialize(token, async () => {
      if (this.revoked.has(token)) throw new Error('Session has been revoked');
      const filename = this.filename(token);
      if (!filename) throw new Error('Invalid session token');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
      const temporary = `${filename}.${newToken()}.tmp`;
      try {
        await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), {
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporary, filename);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  async get(token: string | undefined): Promise<MusicSession | null> {
    if (!token) return null;
    const filename = this.filename(token);
    if (!filename) return null;
    let bytes: Buffer;
    try {
      bytes = await readFile(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const key = await this.key();
    let session: MusicSession;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      session = JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
      );
    } catch {
      return null;
    }
    if (
      !session.credential?.musickey ||
      !(session.credential.musicid > 0) ||
      !Number.isFinite(session.expiresAt)
    )
      return null;
    if (session.expiresAt <= Date.now()) {
      await this.delete(token);
      return null;
    }
    return session;
  }
  async delete(token: string) {
    this.revoked.add(token);
    return this.serialize(token, async () => {
      const filename = this.filename(token);
      if (filename) await rm(filename, { force: true });
    });
  }
}
export const sessions = new SessionStore();
