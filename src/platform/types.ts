export interface DesktopBridge {
  minimize(): void;
  close(): void;
}
export interface AndroidBridge {
  minimize(): void;
  playback(title: string, artist: string, playing: boolean): void;
}

declare global {
  interface Window {
    qmplayDesktop?: DesktopBridge;
    qmplayAndroid?: AndroidBridge;
  }
}
