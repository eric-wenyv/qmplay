import { createRoot } from "react-dom/client";
import { QQMusicProvider } from "./api.js";
import { createApplication } from "./application/application.js";
import { App } from "./ui/App.js";
import type { Quality, StorageLike } from "./contracts.js";
import "./styles.css";

const audio = new Audio();

const formats: [Quality, string][] = [
  ["flac", "audio/flac"],
  ["320", "audio/mpeg"],
  ["128", "audio/mpeg"],
  ["m4a", "audio/mp4"],
];
const provider = new QQMusicProvider({
  supportedQualities: formats
    .filter(([, mime]) => audio.canPlayType(mime))
    .map(([quality]) => quality),
});

let storage: StorageLike;
try {
  storage = window.localStorage;
} catch {
  storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("本机存储不可用");
    },
  };
}

const app = createApplication({ provider, audio, storage });
const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(<App app={app} />);
