import { mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildBackend } from "./build-backend.mjs";
import { buildFrontend } from "./build-frontend.mjs";

const root = new URL("../", import.meta.url);
for (const filename of ["assets/coast.jpg", "assets/icon.png"])
  await access(new URL(filename, root));
await rm(new URL("dist/", root), { recursive: true, force: true });
await mkdir(new URL("dist/", root), { recursive: true });
await buildFrontend();
await buildBackend();
console.log(`Built ${fileURLToPath(new URL("dist/", root))}`);
