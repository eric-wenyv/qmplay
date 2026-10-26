import type { NavigationMode, SourceType, View } from "../contracts.js";
import type { ApplicationStore } from "./store.js";

const pageModes: Partial<Record<View, NavigationMode>> = {
  search: "artist",
  albums: "artist",
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
    return nav.view === view || (nav.mobile && nav.view === "player" && nav.mobilePage === view);
  }
  setView(view: View): void {
    const nav = this.store.state.navigation;
    const previous = nav.mobile && nav.view === "player" ? nav.mobilePage : nav.view;
    if (previous) this.leave(previous, view, nav.mobile && view === "player");
    if (nav.mobile && view !== "player") {
      nav.mobilePage = view;
      nav.mobileMode = pageModes[view] || nav.mobileMode;
    }
    nav.view = view;
    if (nav.mobile) nav.queueOpen = view === "queue";
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
  resumeMobilePage(): void {
    const page = this.store.state.navigation.mobilePage;
    if (page) this.setView(page);
  }
  setMenu(open: boolean): void {
    this.store.state.navigation.menuOpen = open;
    this.store.publish();
  }
  setMobile(mobile: boolean): void {
    const nav = this.store.state.navigation;
    if (nav.mobile === mobile) return;
    const wasOpen = nav.queueOpen;
    nav.menuOpen = false;
    nav.mobile = mobile;
    if (mobile && nav.view !== "player") {
      nav.mobilePage = nav.view;
      nav.mobileMode = pageModes[nav.view] || nav.mobileMode;
    }
    if (wasOpen) nav.view = mobile ? "queue" : nav.view === "queue" ? "player" : nav.view;
    this.store.publish();
  }
  openQueue(): void {
    const nav = this.store.state.navigation;
    if (nav.mobile && nav.view === "queue") {
      this.closeQueue();
      return;
    }
    nav.menuOpen = false;
    nav.queueOpen = true;
    if (nav.mobile) this.browse("queue");
    else this.store.publish();
  }
  closeQueue(): void {
    const nav = this.store.state.navigation;
    nav.queueOpen = false;
    if (nav.view === "queue") this.returnToPlayer();
    else this.store.publish();
  }
}

export function initialMobileMode(source: SourceType | undefined): NavigationMode {
  return source === "artist" || source === "album"
    ? "artist"
    : source === "liked"
      ? "liked"
      : "radio";
}
