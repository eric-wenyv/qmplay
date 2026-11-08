import type { NavigationMode, SourceType, View } from "../contracts.js";
import type { ApplicationStore } from "./store.js";

const pageModes: Partial<Record<View, NavigationMode>> = {
  search: "artist",
  albums: "artist",
  albumTracks: "artist",
  browse: "radio",
  liked: "liked",
  queue: "queue",
};
export class NavigationController {
  constructor(
    private store: ApplicationStore,
    private leave: (previous: View, next: View, suspended: boolean) => void,
    private cancelSource: () => void,
  ) {}
  isPageActive(view: View): boolean {
    const nav = this.store.state.navigation;
    return nav.view === view || (nav.mobile && nav.mobilePage === view);
  }
  setView(view: View): void {
    const nav = this.store.state.navigation;
    const mode = pageModes[view];
    const previous = nav.mobile ? nav.mobilePage : nav.view;
    if (previous) this.leave(previous, view, nav.mobile && !mode);
    if (nav.mobile && mode) {
      nav.mobilePage = view;
      nav.mobileMode = mode;
    }
    nav.view = view;
    this.store.publish();
  }
  browse(view: View): void {
    this.cancelSource();
    this.store.state.navigation.menuOpen = false;
    this.setView(view);
  }
  returnToPlayer(): void {
    this.browse("player");
  }
  toggleMobileHome(): void {
    const nav = this.store.state.navigation;
    if (!nav.mobile) return;
    if (nav.view === "player") this.setView(nav.mobilePage ?? "liked");
    else this.returnToPlayer();
  }
  setMenu(open: boolean): void {
    this.store.state.navigation.menuOpen = open;
    this.store.publish();
  }
  setMobile(mobile: boolean): void {
    const nav = this.store.state.navigation;
    if (nav.mobile === mobile) return;
    nav.menuOpen = false;
    nav.queueOpen = false;
    nav.mobile = mobile;
    if (!mobile && nav.view === "queue") nav.view = "player";
    const mode = pageModes[nav.view];
    if (mobile && mode) {
      nav.mobilePage = nav.view;
      nav.mobileMode = mode;
    }
    this.store.publish();
  }
  openQueue(): void {
    const nav = this.store.state.navigation;
    if (nav.mobile) {
      this.browse("queue");
      return;
    }
    nav.menuOpen = false;
    nav.queueOpen = true;
    this.store.publish();
  }
  closeQueue(): void {
    const nav = this.store.state.navigation;
    if (nav.view === "queue") {
      this.returnToPlayer();
      return;
    }
    if (!nav.queueOpen) return;
    nav.queueOpen = false;
    this.store.publish();
  }
}

export function initialMobileMode(source: SourceType | undefined): NavigationMode {
  return source === "artist" || source === "album"
    ? "artist"
    : source === "liked"
      ? "liked"
      : "radio";
}
