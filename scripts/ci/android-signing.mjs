import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareAndroidSigning(env = process.env) {
  assert(
    env.QMPLAY_ANDROID_KEYSTORE_BASE64 && env.QMPLAY_ANDROID_KEYSTORE_PASSWORD,
    "Android releases require QMPLAY_ANDROID_KEYSTORE_BASE64 and QMPLAY_ANDROID_KEYSTORE_PASSWORD secrets",
  );
  const encoded = env.QMPLAY_ANDROID_KEYSTORE_BASE64.replace(/\s/g, "");
  assert(
    /^[A-Za-z\d+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0,
    "Invalid Android keystore base64",
  );
  const bytes = Buffer.from(encoded, "base64");
  assert(
    bytes.length >= 256 && bytes[0] === 0x30 && bytes.toString("base64") === encoded,
    "Expected a base64 PKCS12 keystore",
  );
  const directory = await mkdtemp(
    path.join(path.resolve(env.RUNNER_TEMP || os.tmpdir()), "qmplay-signing-"),
  );
  const filename = path.join(directory, "keystore.p12");
  try {
    await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
    if (env.GITHUB_ENV)
      await appendFile(
        env.GITHUB_ENV,
        `QMPLAY_ANDROID_KEYSTORE=${filename}\nQMPLAY_ANDROID_SIGNING_DIR=${directory}\n`,
      );
    return { directory, filename };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupAndroidSigning(env = process.env) {
  if (!env.QMPLAY_ANDROID_SIGNING_DIR) return;
  const directory = path.resolve(env.QMPLAY_ANDROID_SIGNING_DIR);
  assert.equal(
    path.dirname(directory),
    path.resolve(env.RUNNER_TEMP || os.tmpdir()),
    "Signing directory must be inside runner temp",
  );
  assert(
    path.basename(directory).startsWith("qmplay-signing-"),
    "Refusing to remove an unrelated directory",
  );
  await rm(directory, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === "--stage") {
    await prepareAndroidSigning();
    console.log("Android release keystore staged in runner temp.");
  } else if (process.argv[2] === "--cleanup") await cleanupAndroidSigning();
  else throw new Error("Usage: android-signing.mjs --stage | --cleanup");
}
