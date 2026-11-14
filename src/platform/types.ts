export interface DesktopBridge {
  minimize(): void;
  close(): void;
}
export type HapticEffect = "wheel-key" | "wheel-tick" | "play-key" | "cover-step";

export interface AndroidBridge {
  topInset?(): number;
  haptic?(effect: HapticEffect): void;
  minimize(): void;
  playback(
    id: string,
    title: string,
    artist: string,
    album: string,
    artwork: string,
    playing: boolean,
    positionMs: number,
    durationMs: number,
  ): void;
  openQqLogin(url: string): boolean;
}

declare global {
  interface Window {
    qmplayDesktop?: DesktopBridge;
    qmplayAndroid?: AndroidBridge;
  }
}
