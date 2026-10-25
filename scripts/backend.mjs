import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import lifecycle from "../electron/backend.cjs";
import { buildBackend } from "./build-backend.mjs";

export async function ensureBackend({ build = true } = {}) {
  if (build) await buildBackend();
  const backend = lifecycle.createBackendController({
    entry: fileURLToPath(new URL("../dist/backend/server.cjs", import.meta.url)),
    spawn: (entry, env) => fork(entry, [], {
      env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    }),
  });
  const cleanup = () => backend.stop();
  process.once("exit", cleanup);
  try {
    const connection = await backend.start();
    return {
      connection,
      start: () => backend.start(),
      stop: () => { process.removeListener("exit", cleanup); backend.stop(); },
    };
  } catch (error) {
    process.removeListener("exit", cleanup);
    backend.stop();
    throw error;
  }
}
