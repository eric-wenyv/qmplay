import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import asar from "@electron/asar";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function smokeBackend(executable, entry, authDirectory) {
  const token = randomBytes(32).toString("hex");
  const child = fork(entry, [], {
    execPath: executable,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: "0",
      QMPLAY_API_TOKEN: token,
      QQ_MUSIC_AUTH_DIR: authDirectory,
      LOG_LEVEL: "silent",
    },
  });
  child.stdout.resume();
  child.stderr.resume();
  const exited = once(child, "exit");
  let timer;
  try {
    const message = await Promise.race([
      once(child, "message").then(([message]) => message),
      exited.then(() => {
        throw new Error("Packaged backend exited before readiness");
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Packaged backend startup timed out")), 15000);
      }),
    ]);
    assert.equal(message.type, "ready");
    assert.match(message.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const request = (pathname, authenticated = true) =>
      fetch(message.origin + pathname, {
        headers: authenticated ? { "X-QMPLAY-Token": token } : {},
        signal: AbortSignal.timeout(5000),
      });
    assert.equal((await (await request("/health")).json()).service, "qmplay-api");
    assert.equal((await request("/health", false)).status, 403);
    const auth = await request("/auth/status");
    assert.equal(auth.status, 200);
    assert.equal((await auth.json()).data.authenticated, false);
  } finally {
    clearTimeout(timer);
    if (child.connected) child.disconnect();
    const kill = setTimeout(() => child.kill(), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(kill);
    }
  }
}

export async function verifyDesktop(directory, arch = process.arch) {
  assert(["x64", "arm64"].includes(arch), "Unsupported desktop architecture");
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const archive = path.join(directory, "resources/app.asar");
  const files = asar.listPackage(archive).map((name) => name.replaceAll("\\", "/"));
  // ASAR 3.x resolves archive entries using the host's path separator.
  const extract = (name) => asar.extractFile(archive, path.normalize(name));
  for (const name of [
    "electron/main.cjs",
    "electron/preload.cjs",
    "dist/index.html",
    "dist/assets/icon.png",
    "dist/src/app.js",
    "dist/src/app.css",
    "dist/assets/frontend/dependencies.json",
    "dist/assets/frontend/THIRD_PARTY_NOTICES.txt",
    "dist/backend/server.cjs",
    "dist/backend/dependencies.json",
    "dist/backend/THIRD_PARTY_NOTICES.txt",
    "THIRD_PARTY_NOTICES.md",
  ])
    assert(files.includes("/" + name), `Missing packaged file: ${name}`);
  assert(
    !files.some((name) =>
      /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:session|p12|jks|keystore))$/i.test(name),
    ),
    "Private files found in package",
  );
  const manifest = JSON.parse(extract("package.json"));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.main, "electron/main.cjs");
  const dependencies = JSON.parse(extract("dist/backend/dependencies.json"));
  for (const name of ["koa", "axios", "zod", "@jixun/qmweb-sign"])
    assert(
      dependencies.some((dependency) => dependency.name === name),
      `Missing dependency notice: ${name}`,
    );
  const frontend = JSON.parse(extract("dist/assets/frontend/dependencies.json"));
  for (const name of ["react", "react-dom", "scheduler"])
    assert(
      frontend.some((dependency) => dependency.name === name),
      `Missing frontend dependency notice: ${name}`,
    );
  const targetPlatform = existsSync(path.join(directory, "qmplay.exe")) ? "win32" : "linux";
  const executable = path.join(directory, targetPlatform === "win32" ? "qmplay.exe" : "qmplay");
  const file = await open(executable, "r");
  try {
    const header = Buffer.alloc(64);
    await file.read(header, 0, header.length, 0);
    if (targetPlatform === "win32") {
      assert.equal(header.toString("ascii", 0, 2), "MZ");
      const pe = Buffer.alloc(6);
      await file.read(pe, 0, pe.length, header.readUInt32LE(60));
      assert.equal(pe.toString("ascii", 0, 4), "PE\0\0");
      assert.equal(pe.readUInt16LE(4), arch === "arm64" ? 0xaa64 : 0x8664);
    } else {
      assert.equal(header.toString("ascii", 0, 4), "\x7fELF");
      assert.equal(header.readUInt16LE(18), arch === "arm64" ? 183 : 62);
    }
  } finally {
    await file.close();
  }
  if (arch !== process.arch || targetPlatform !== process.platform) {
    console.log(
      `${targetPlatform}/${arch} archive, executable and dependency notices verified; runtime smoke requires a matching host.`,
    );
    return;
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "qmplay-package-"));
  try {
    const entry = path.join(temporary, "server.cjs");
    await writeFile(entry, extract("dist/backend/server.cjs"));
    await smokeBackend(executable, entry, path.join(temporary, "auth"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`${arch} packaged runtime/API, archive and dependency notices verified.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.argv[2], "Usage: verify-desktop.mjs <unpacked-directory> [x64|arm64]");
  await verifyDesktop(path.resolve(process.argv[2]), process.argv[3] || process.arch);
}
