import type { AuthState, MusicApplication } from "../contracts.js";

export function AuthView({ app, auth }: { app: MusicApplication; auth: AuthState }) {
  return (
    <section
      id="auth-view"
      className="auth-view"
      aria-label="QQ 音乐登录"
      hidden={auth.state === "ready"}
    >
      <h1>qmplay</h1>
      <p
        className="auth-caption"
        hidden={["checking", "unavailable", "ready"].includes(auth.state)}
      >
        登录 QQ 音乐，同步喜欢的音乐
      </p>
      <img
        id="auth-qr"
        src={auth.image || undefined}
        width="180"
        height="180"
        alt="QQ 登录二维码"
        hidden={!auth.image}
      />
      <p id="auth-message" role="status" aria-live="polite">
        {auth.message || ""}
      </p>
      <button
        id="auth-retry"
        className="text-button"
        type="button"
        hidden={!["unavailable", "expired", "cancelled", "loginError"].includes(auth.state)}
        onClick={() => void app.retryAuthentication()}
      >
        {auth.state === "unavailable" ? "重新连接" : "刷新二维码"}
      </button>
    </section>
  );
}
