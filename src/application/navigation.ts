import type { NavigationMode, SourceType, View } from "../contracts.js";
import type { ApplicationStore } from "./store.js";

const pageModes: Partial<Record<View, NavigationMode>> = {
  search: "artist",
  albums: "artist",
  albumTracks: "artist",
  browse: "radio",
  liked: "liked",
};
export class NavigationController {
  private artistParent: View | null = null;
  constructor(
    private store: ApplicationStore,
    private leave: (previous: View, next: View, suspended: boolean) => void,
    private cancelSource: () => void,
  ) {}
  isPageActive(view: View): boolean {
    const nav = this.store.state.navigation;
    const page = nav.mobile ? nav.mobilePage : nav.view;
    return (
      nav.view === view ||
      page === view ||
      ((page === "albums" || page === "albumTracks") && this.artistParent === view)
    );
  }
  setView(view: View): void {
    const nav = this.store.state.navigation;
    const mode = pageModes[view];
    const previous = nav.mobile ? nav.mobilePage : nav.view;
    if (previous) this.leave(previous, view, nav.mobile && !mode);
    if (nav.view !== view) nav.queueOpen = false;
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
  openArtist(): void {
    const { view, mobile, mobilePage } = this.store.state.navigation;
    if (view !== "albums" && view !== "albumTracks") {
      this.artistParent = mobile && view === "player" ? (mobilePage ?? "browse") : view;
    }
    this.browse("albums");
  }
  goBack(): boolean {
    const nav = this.store.state.navigation;
    if (nav.queueOpen) this.closeQueue();
    else if (nav.menuOpen) this.setMenu(false);
    else if (nav.view === "albumTracks") this.browse("albums");
    else if (nav.view === "albums")
      this.browse(this.artistParent ?? (nav.mobile ? "browse" : "player"));
    else if (nav.view === "lyrics") this.returnToPlayer();
    else if (nav.mobile && nav.view === "player") this.setView(nav.mobilePage ?? "browse");
    else if (nav.mobile && nav.view !== "browse") this.browse("browse");
    else if (!nav.mobile && nav.view !== "player") this.returnToPlayer();
    else return false;
    return true;
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
    const mode = pageModes[nav.view];
    if (mobile && mode) {
      nav.mobilePage = nav.view;
      nav.mobileMode = mode;
    }
    this.store.publish();
  }
  openQueue(): void {
    const nav = this.store.state.navigation;
    if (nav.mobile && nav.view === "lyrics") this.returnToPlayer();
    nav.menuOpen = false;
    nav.queueOpen = true;
    this.store.publish();
  }
  closeQueue(): void {
    const nav = this.store.state.navigation;
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
