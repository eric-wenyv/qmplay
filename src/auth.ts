import type { AuthState, AuthStatus, LoginQr, LoginResult, User } from "./contracts.js";

type Timer = ReturnType<typeof globalThis.setTimeout>;
export interface AuthenticationOptions {
  provider: {
    getAuthStatus(): Promise<AuthStatus>;
    createLoginQr(): Promise<LoginQr>;
    checkLoginQr(id: string): Promise<LoginResult>;
  };
  onState(state: AuthState): void;
  onAuthenticated(user: User): void | Promise<void>;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (id: Timer | undefined) => void;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const code = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? String(error.code) : "";

// The gate distinguishes an unavailable server from a confirmed missing/expired session.
export class Authentication {
  readonly provider: AuthenticationOptions["provider"];
  readonly onState: AuthenticationOptions["onState"];
  readonly onAuthenticated: AuthenticationOptions["onAuthenticated"];
  readonly schedule: NonNullable<AuthenticationOptions["schedule"]>;
  readonly cancel: NonNullable<AuthenticationOptions["cancel"]>;
  generation = 0;
  timer?: Timer;
  constructor({
    provider,
    onState,
    onAuthenticated,
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancel = (id) => globalThis.clearTimeout(id),
  }: AuthenticationOptions) {
    this.provider = provider;
    this.onState = onState;
    this.onAuthenticated = onAuthenticated;
    this.schedule = schedule;
    this.cancel = cancel;
  }
  stop() {
    this.generation++;
    this.cancel(this.timer);
  }
  async start() {
    this.stop();
    const generation = this.generation;
    this.onState({ state: "checking", message: "正在恢复登录…" });
    try {
      const result = await this.provider.getAuthStatus();
      if (generation !== this.generation) return;
      if (result.authenticated) await this.complete(result.user, generation);
      else await this.login();
    } catch (error) {
      if (generation === this.generation)
        this.onState({ state: "unavailable", message: message(error) });
    }
  }
  async complete(user: User | undefined, generation: number) {
    if (!user || !/^\d+$/.test(user.uin)) throw new Error("登录账号数据不完整，请重试");
    await this.onAuthenticated(user);
    if (generation === this.generation) this.onState({ state: "ready", user });
  }
  async login() {
    this.stop();
    const generation = this.generation;
    this.onState({ state: "loadingQr", message: "正在获取登录二维码…" });
    try {
      const qr = await this.provider.createLoginQr();
      if (generation !== this.generation) return;
      this.onState({ state: "waiting", message: "请使用手机 QQ 扫码登录", image: qr.image });
      const poll = async () => {
        if (generation !== this.generation) return;
        if (Date.now() >= qr.expiresAt) {
          this.onState({ state: "expired", message: "二维码已过期，请刷新" });
          return;
        }
        try {
          const result = await this.provider.checkLoginQr(qr.id);
          if (generation !== this.generation) return;
          if (result.state === "authenticated") {
            await this.complete(result.user, generation);
            return;
          }
          if (result.state === "expired" || result.state === "cancelled") {
            this.onState({
              state: result.state,
              message:
                result.state === "expired" ? "二维码已过期，请刷新" : "已取消登录，请重新扫码",
            });
            return;
          }
          if (result.state !== "waiting" && result.state !== "scanned")
            throw new Error("登录状态异常，请刷新二维码");
          this.onState({
            state: result.state,
            image: qr.image,
            message:
              result.state === "scanned" ? "已扫码，请在手机上确认登录" : "请使用手机 QQ 扫码登录",
          });
          this.timer = this.schedule(poll, 2000);
        } catch (error) {
          if (generation !== this.generation) return;
          if (["UPSTREAM_UNAVAILABLE", "API_UNAVAILABLE", "POLL_TOO_FAST"].includes(code(error))) {
            this.onState({
              state: "waiting",
              image: qr.image,
              message: "网络波动，正在重新检查登录…",
            });
            this.timer = this.schedule(poll, 3000);
          } else this.onState({ state: "loginError", message: message(error) });
        }
      };
      this.timer = this.schedule(poll, 2000);
    } catch (error) {
      if (generation === this.generation)
        this.onState({ state: "loginError", message: message(error) });
    }
  }
}
