import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import asar from "@electron/asar";
import {
  validateMetadata,
  packageGroups,
  verifyChecksums,
  prepareRelease,
  publishRelease,
} from "../scripts/ci/release.mjs";
import { prepareAndroidSigning, cleanupAndroidSigning } from "../scripts/ci/android-signing.mjs";
import { smokeBackend, verifyDesktop } from "../scripts/ci/verify-desktop.mjs";
import { buildBackend } from "../scripts/build-backend.mjs";
import { verifyAndroidBadging } from "../scripts/ci/verify-android.mjs";

const pkg = { version: "1.2.3" };
const manifest = '<manifest android:versionCode="12" android:versionName="1.0.0" />';
const releaseEnv = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/tags/v1.2.3",
  GITHUB_SHA: "a".repeat(40),
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qmplay-ci-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("release metadata validates exact tags and Android version codes; dispatches never publish", () => {
  const result = validateMetadata(pkg, manifest, releaseEnv);
  assert.equal(result.isRelease, true);
  assert.equal(result.androidVersionCode, 12);
  assert.equal(result.prerelease, false);
  assert.equal(
    validateMetadata(pkg, manifest, { ...releaseEnv, GITHUB_EVENT_NAME: "workflow_dispatch" })
      .isRelease,
    false,
  );
  assert.equal(
    validateMetadata(pkg, manifest, { ...releaseEnv, GITHUB_REF: "refs/heads/main" }).isRelease,
    false,
  );
  assert.throws(
    () => validateMetadata(pkg, manifest, { ...releaseEnv, GITHUB_REF: "refs/tags/v2.0.0" }),
    /must match/,
  );
  assert.throws(() => validateMetadata(pkg, '<manifest android:versionCode="0" />'), /versionCode/);
  assert.throws(() => validateMetadata({ version: "../outside" }, manifest), /version/);
  assert.equal(validateMetadata({ version: "1.2.3-beta.1" }, manifest).prerelease, true);
});

async function releaseFixture(t) {
  const directory = await temporary(t);
  for (const group of packageGroups(pkg.version)) {
    const checksums = [];
    for (const name of group.files) {
      const bytes = Buffer.from(`test package ${name}`);
      await writeFile(path.join(directory, name), bytes);
      checksums.push(`${sha256(bytes)}  ${name}`);
    }
    await writeFile(path.join(directory, group.checksum), checksums.join("\n") + "\n");
  }
  return directory;
}

test("release collection verifies every platform and only uploads explicit package assets", async (t) => {
  const directory = await releaseFixture(t);
  await writeFile(path.join(directory, "private.p12"), "never upload this");
  const release = await prepareRelease(directory, pkg, manifest, releaseEnv);
  assert.equal(release.assets.length, 14);
  assert(!release.assets.some((name) => name.endsWith("private.p12")));
  const inventory = JSON.parse(await readFile(path.join(directory, "build-manifest.json"), "utf8"));
  assert.equal(inventory.files.length, 8);
  assert.equal(inventory.commit, releaseEnv.GITHUB_SHA);
  assert.equal(inventory.androidVersionCode, 12);
  assert.equal(
    (
      await verifyChecksums(
        directory,
        "SHA256SUMS",
        inventory.files.map((file) => file.name),
      )
    ).length,
    8,
  );
});

test("tampered or missing platform packages stop collection before a release manifest is written", async (t) => {
  const directory = await releaseFixture(t);
  const android = packageGroups(pkg.version).find((group) => group.platform === "android");
  await writeFile(path.join(directory, android.files[0]), "tampered");
  await assert.rejects(prepareRelease(directory, pkg, manifest, releaseEnv), /Checksum mismatch/);
  await assert.rejects(access(path.join(directory, "build-manifest.json")), { code: "ENOENT" });
  await rm(path.join(directory, android.files[0]));
  await assert.rejects(prepareRelease(directory, pkg, manifest, releaseEnv), { code: "ENOENT" });
});

test("checksum manifests reject traversal and duplicate package names", async (t) => {
  const directory = await temporary(t);
  const hash = "a".repeat(64);
  await writeFile(path.join(directory, "sums"), `${hash}  ../outside\n`);
  await assert.rejects(
    verifyChecksums(directory, "sums", ["../outside"]),
    /Invalid checksum entry/,
  );
  await writeFile(path.join(directory, "sums"), `${hash}  file.exe\n${hash}  file.exe\n`);
  await assert.rejects(verifyChecksums(directory, "sums", ["file.exe"]), /Unexpected or missing/);
});

function publishing(options = {}) {
  const commands = [];
  publishRelease({
    tag: "v1.2.3",
    prerelease: false,
    assets: ["release/package.exe"],
    repository: "owner/repo",
    run: (args) => {
      commands.push(args);
      if (args[1] === "view") return { status: 1 };
      return { status: 0, stdout: "" };
    },
    ...options,
  });
  return commands;
}

test("release publishing creates a draft and publishes only after the complete asset upload", () => {
  const commands = publishing();
  assert.deepEqual(
    commands.map((args) => args[1]),
    ["view", "create", "upload", "edit"],
  );
  assert(commands[1].includes("--draft"));
  assert(commands[1].includes("--verify-tag"));
  assert(commands[3].includes("--draft=false"));
  assert(commands[3].includes("--latest=true"));
});

test("published releases cannot be overwritten and an upload failure leaves the draft unpublished", () => {
  const commands = [];
  assert.throws(
    () =>
      publishing({
        run: (args) => {
          commands.push(args);
          return { status: 0, stdout: '{"isDraft":false}' };
        },
      }),
    /immutable/,
  );
  assert.equal(commands.length, 1);
  commands.length = 0;
  assert.throws(
    () =>
      publishing({
        run: (args) => {
          commands.push(args);
          if (args[1] === "view") return { status: 1 };
          return { status: args[1] === "upload" ? 1 : 0, stderr: "upload interrupted" };
        },
      }),
    /upload interrupted/,
  );
  assert(!commands.some((args) => args[1] === "edit"));
});

test("draft retries do not recreate releases and prereleases are not marked latest", () => {
  const commands = [];
  publishing({
    prerelease: true,
    run: (args) => {
      commands.push(args);
      return { status: 0, stdout: '{"isDraft":true}' };
    },
  });
  assert.deepEqual(
    commands.map((args) => args[1]),
    ["view", "upload", "edit"],
  );
  assert(commands[2].includes("--latest=false"));
  assert(commands[2].includes("--prerelease=true"));
});

test("Android release signing requires configured secrets and never falls back to an ephemeral key", async () => {
  await assert.rejects(prepareAndroidSigning({}), /require.*secrets/);
  await assert.rejects(
    prepareAndroidSigning({
      QMPLAY_ANDROID_KEYSTORE_BASE64: "invalid!",
      QMPLAY_ANDROID_KEYSTORE_PASSWORD: "secret",
    }),
    /base64/,
  );
});

test("APK verification accepts current and legacy aapt2 minimum SDK fields and rejects debuggable release APKs", () => {
  for (const field of ["minSdkVersion", "sdkVersion"]) {
    const badging = `package: name='app.qmplay' versionCode='12' versionName='1.2.3'\n${field}:'26'\ntargetSdkVersion:'35'\nnative-code: 'arm64-v8a'\n`;
    const metadata = validateMetadata(pkg, manifest);
    verifyAndroidBadging(badging, metadata, false);
    verifyAndroidBadging(badging + "application-debuggable\n", metadata, true);
    assert.throws(
      () => verifyAndroidBadging(badging + "application-debuggable\n", metadata, false),
      /debug status/,
    );
    assert.throws(() => verifyAndroidBadging(badging.replace("'26'", "'24'"), metadata, false));
  }
});

test("Android signing stages only a private temporary file and never writes key material to the Actions environment", async (t) => {
  const directory = await temporary(t);
  const bytes = Buffer.alloc(300, 0x51);
  bytes[0] = 0x30;
  const env = {
    RUNNER_TEMP: directory,
    GITHUB_ENV: path.join(directory, "github-env"),
    QMPLAY_ANDROID_KEYSTORE_BASE64: bytes.toString("base64"),
    QMPLAY_ANDROID_KEYSTORE_PASSWORD: "private-password",
  };
  const staged = await prepareAndroidSigning(env);
  assert.deepEqual(await readFile(staged.filename), bytes);
  if (process.platform !== "win32") assert.equal((await stat(staged.filename)).mode & 0o777, 0o600);
  const exported = await readFile(env.GITHUB_ENV, "utf8");
  assert(!exported.includes(env.QMPLAY_ANDROID_KEYSTORE_BASE64));
  assert(!exported.includes(env.QMPLAY_ANDROID_KEYSTORE_PASSWORD));
  await cleanupAndroidSigning({ ...env, QMPLAY_ANDROID_SIGNING_DIR: staged.directory });
  await assert.rejects(access(staged.filename), { code: "ENOENT" });
  await assert.rejects(
    cleanupAndroidSigning({ ...env, QMPLAY_ANDROID_SIGNING_DIR: directory }),
    /runner temp|unrelated/,
  );
});

test("desktop archive verification reads nested ASAR manifests on every host", async (t) => {
  const directory = await temporary(t);
  const source = path.join(directory, "source");
  const current = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const files = {
    "package.json": JSON.stringify({ version: current.version, main: "electron/main.cjs" }),
    "electron/main.cjs": "",
    "electron/preload.cjs": "",
    "dist/index.html": "<!doctype html>",
    "dist/assets/icon.png": "fixture",
    "dist/src/app.js": "fixture",
    "dist/src/app.css": "fixture",
    "dist/assets/frontend/dependencies.json": JSON.stringify(
      ["react", "react-dom", "scheduler"].map((name) => ({ name })),
    ),
    "dist/assets/frontend/THIRD_PARTY_NOTICES.txt": "fixture notices",
    "dist/backend/server.cjs": "process.exit(0);",
    "dist/backend/dependencies.json": JSON.stringify(
      ["koa", "axios", "zod", "@jixun/qmweb-sign"].map((name) => ({ name })),
    ),
    "dist/backend/THIRD_PARTY_NOTICES.txt": "fixture notices",
    "THIRD_PARTY_NOTICES.md": "fixture notices",
  };
  for (const [name, content] of Object.entries(files)) {
    const filename = path.join(source, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  const archive = path.join(directory, "resources/app.asar");
  await mkdir(path.dirname(archive), { recursive: true });
  await asar.createPackage(source, archive);
  t.after(() => asar.uncache(archive));
  // Use the other architecture so this fixture checks the archive without executing a fake PE file.
  const arch = process.arch === "arm64" ? "x64" : "arm64";
  const executable = Buffer.alloc(128);
  executable.write("MZ");
  executable.writeUInt32LE(64, 60);
  executable.write("PE\0\0", 64);
  executable.writeUInt16LE(arch === "arm64" ? 0xaa64 : 0x8664, 68);
  await writeFile(path.join(directory, "qmplay.exe"), executable);
  await verifyDesktop(directory, arch);
});

test(
  "the packaged-backend smoke check boots the standalone bundle with a private token and rejects early exits",
  { timeout: 20000 },
  async (t) => {
    const directory = await temporary(t);
    const entry = await buildBackend({ outdir: path.join(directory, "backend") });
    await smokeBackend(process.execPath, entry, path.join(directory, "auth"));
    const failed = path.join(directory, "failed.cjs");
    await writeFile(failed, "process.exit(2);");
    await assert.rejects(
      smokeBackend(process.execPath, failed, path.join(directory, "auth")),
      /exited before readiness/,
    );
  },
);
