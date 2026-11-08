import type { AuthState, MusicApplication } from "../contracts.js";

export function AuthView({ app, auth }: { app: MusicApplication; auth: AuthState }) {
  const qq = auth.method === "qq";
  const authorizing = auth.state === "authorizing";
  const retry = ["needsLogin", "unavailable", "expired", "cancelled", "loginError"].includes(
    auth.state,
  );
  const loginButton = (
    <button
      id="auth-retry"
      className={qq ? "auth-login-button" : "text-button"}
      type="button"
      hidden={!retry && !(qq && authorizing)}
      disabled={authorizing}
      aria-busy={authorizing}
      onClick={() => void app.retryAuthentication()}
    >
      {auth.state === "unavailable" ? "重新连接" : qq ? "登录" : "刷新二维码"}
    </button>
  );
  return (
    <section
      id="auth-view"
      className="auth-view"
      aria-label="QQ 音乐登录"
      hidden={auth.state === "checking" || auth.state === "ready"}
    >
      <h1>qmplay</h1>
      <p
        className="auth-caption"
        hidden={["checking", "unavailable", "ready"].includes(auth.state)}
      >
        登录 QQ 音乐，同步喜欢的音乐
      </p>
      {qq && loginButton}
      <img
        id="auth-qr"
        src={auth.image || undefined}
        width="180"
        height="180"
        alt="QQ 登录二维码"
        hidden={!auth.image}
      />
      <p id="auth-message" role="status" aria-live="polite" hidden={auth.state === "needsLogin"}>
        {auth.message || ""}
      </p>
      {!qq && loginButton}
    </section>
  );
}
