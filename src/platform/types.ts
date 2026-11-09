export interface DesktopBridge {
  minimize(): void;
  close(): void;
}
export type HapticEffect = "wheel-key" | "play-key" | "cover-step";

export interface AndroidBridge {
  topInset?(): number;
  haptic?(effect: HapticEffect): void;
  minimize(): void;
  playback(title: string, artist: string, playing: boolean): void;
  openQqLogin(url: string): boolean;
}

declare global {
  interface Window {
    qmplayDesktop?: DesktopBridge;
    qmplayAndroid?: AndroidBridge;
  }
}
