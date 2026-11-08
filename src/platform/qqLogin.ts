import "./types.js";

export function openQqLogin(url: string): void {
  if (!window.qmplayAndroid?.openQqLogin(url))
    throw new Error("无法打开手机 QQ，请确认已安装 QQ 后重试");
}
