import type { AuthState, AuthStatus, LoginQr, LoginResult, QqLogin, User } from "./contracts.js";

type Timer = ReturnType<typeof globalThis.setTimeout>;
export interface AuthenticationOptions {
  provider: {
    getAuthStatus(): Promise<AuthStatus>;
    createLoginQr(): Promise<LoginQr>;
    checkLoginQr(id: string): Promise<LoginResult>;
  };
  onState(state: AuthState): void;
  onAuthenticated(user: User): void | Promise<void>;
  qqLogin?: {
    create(): Promise<QqLogin>;
    open(url: string): void;
  };
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
  private qqLogin: AuthenticationOptions["qqLogin"];
  generation = 0;
  timer?: Timer;
  constructor({
    provider,
    onState,
    onAuthenticated,
    qqLogin,
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancel = (id) => globalThis.clearTimeout(id),
  }: AuthenticationOptions) {
    this.provider = provider;
    this.onState = onState;
    this.onAuthenticated = onAuthenticated;
    this.qqLogin = qqLogin;
    this.schedule = schedule;
    this.cancel = cancel;
  }
  stop() {
    this.generation++;
    this.cancel(this.timer);
  }
  async start(status?: AuthStatus) {
    this.stop();
    const generation = this.generation;
    this.onState({ state: "checking", message: "正在恢复登录…" });
    try {
      const result = status ?? (await this.provider.getAuthStatus());
      if (generation !== this.generation) return;
      if (result.authenticated) await this.complete(result.user, generation);
      else await this.requireLogin();
    } catch (error) {
      if (generation !== this.generation) return;
      if (code(error) === "AUTH_REQUIRED") await this.requireLogin();
      else this.onState({ state: "unavailable", message: message(error) });
    }
  }
  async requireLogin() {
    if (this.qqLogin) {
      this.stop();
      this.onState({ state: "needsLogin", method: "qq", message: "请通过手机 QQ 授权登录" });
    } else await this.login();
  }
  async complete(user: User | undefined, generation: number) {
    if (!user || !/^\d+$/.test(user.uin)) throw new Error("登录账号数据不完整，请重试");
    await this.onAuthenticated(user);
    if (generation === this.generation) this.onState({ state: "ready", user });
  }
  async login() {
    this.stop();
    const generation = this.generation;
    const qqLogin = this.qqLogin;
    const method = qqLogin ? { method: "qq" as const } : {};
    const expired = qqLogin ? "QQ 登录已过期，请重试" : "二维码已过期，请刷新";
    const cancelled = qqLogin ? "已取消 QQ 登录" : "已取消登录，请重新扫码";
    this.onState(
      qqLogin
        ? { state: "authorizing", ...method, message: "正在打开 QQ 登录…" }
        : { state: "loadingQr", message: "正在获取登录二维码…" },
    );
    try {
      const qr = await (qqLogin ? qqLogin.create() : this.provider.createLoginQr());
      if (generation !== this.generation) return;
      if (qqLogin && "url" in qr) qqLogin.open(qr.url);
      const image = "image" in qr ? qr.image : undefined;
      const waiting = (scanned = false, retrying = false): AuthState => ({
        state: qqLogin ? "authorizing" : scanned ? "scanned" : "waiting",
        ...method,
        image,
        message: retrying
          ? "网络波动，正在重新检查登录…"
          : qqLogin
            ? "请在手机 QQ 确认登录"
            : scanned
              ? "已扫码，请在手机上确认登录"
              : "请使用手机 QQ 扫码登录",
      });
      this.onState(waiting());
      const poll = async () => {
        if (generation !== this.generation) return;
        if (Date.now() >= qr.expiresAt) {
          this.onState({ state: "expired", ...method, message: expired });
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
              ...method,
              message: result.state === "expired" ? expired : cancelled,
            });
            return;
          }
          if (result.state !== "waiting" && result.state !== "scanned")
            throw new Error(qqLogin ? "登录状态异常，请重试" : "登录状态异常，请刷新二维码");
          this.onState(waiting(result.state === "scanned"));
          this.timer = this.schedule(poll, 2000);
        } catch (error) {
          if (generation !== this.generation) return;
          if (["UPSTREAM_UNAVAILABLE", "API_UNAVAILABLE", "POLL_TOO_FAST"].includes(code(error))) {
            this.onState(waiting(false, true));
            this.timer = this.schedule(poll, 3000);
          } else this.onState({ state: "loginError", ...method, message: message(error) });
        }
      };
      this.timer = this.schedule(poll, 2000);
    } catch (error) {
      if (generation === this.generation)
        this.onState({ state: "loginError", ...method, message: message(error) });
    }
  }
}
