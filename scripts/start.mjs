import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildBackend } from "./build-backend.mjs";
import { buildFrontend } from "./build-frontend.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
try {
  await buildFrontend();
  await buildBackend();
  const require = createRequire(import.meta.url);
  const child = spawn(require("electron"), ["."], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code || 0;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
