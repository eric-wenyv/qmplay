import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildBackend } from "./build-backend.mjs";
import { buildFrontend } from "./build-frontend.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(os.homedir(), "Android/Sdk");
const cache = path.join(root, ".cache/android");
const output = path.join(root, "output/android");
const staging = path.join(output, "apk");
const runtimeVersion = "18.20.4";
const runtimeSha256 = "bd7321eaa1a7602fbe0bb87302df2d79d87835cf4363fbdd17c350dbb485c2af";
const runtimeZip = path.join(cache, `nodejs-mobile-v${runtimeVersion}-android.zip`);
const runtimeDirectory = path.join(cache, `nodejs-mobile-${runtimeVersion}`);
const debug = process.argv.includes("--debug");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const run = (command, args, cwd = root) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}
async function newest(directory) {
  const names = (await readdir(directory))
    .filter((name) => /^\d/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) throw new Error(`Install the Android SDK component in ${directory}`);
  return path.join(directory, names.at(-1));
}
async function walk(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
}
await mkdir(cache, { recursive: true });
const tools = process.env.ANDROID_BUILD_TOOLS_VERSION
  ? path.join(sdk, "build-tools", process.env.ANDROID_BUILD_TOOLS_VERSION)
  : await newest(path.join(sdk, "build-tools"));
const ndk = process.env.ANDROID_NDK_HOME || (await newest(path.join(sdk, "ndk")));
const androidJar = path.join(sdk, "platforms/android-35/android.jar");
await access(androidJar);
if (!(await exists(path.join(runtimeDirectory, "include/node/node.h")))) {
  if (!(await exists(runtimeZip))) {
    console.log("Downloading the official Node.js Mobile Android runtime…");
    await run("curl", [
      "--fail",
      "--location",
      "--retry",
      "3",
      "--continue-at",
      "-",
      `https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v${runtimeVersion}/nodejs-mobile-v${runtimeVersion}-android.zip`,
      "--output",
      runtimeZip + ".partial",
    ]);
    await rename(runtimeZip + ".partial", runtimeZip);
  }
  if (
    createHash("sha256")
      .update(await readFile(runtimeZip))
      .digest("hex") !== runtimeSha256
  )
    throw new Error("Node.js Mobile archive checksum does not match the pinned runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  await run("unzip", ["-q", "-o", runtimeZip, "-d", runtimeDirectory]);
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(staging, "assets"), { recursive: true });
const runtime = path.join(output, "runtime");
const web = path.join(runtime, "web");
await mkdir(web, { recursive: true });
await buildFrontend({ outdir: web });
await buildBackend({ entry: "android/server.ts", outdir: runtime, target: "node18" });
await cp(
  path.join(runtime, "THIRD_PARTY_NOTICES.txt"),
  path.join(web, "assets/THIRD_PARTY_NOTICES.txt"),
);
// The complete Node.js license includes notices for V8, OpenSSL and the runtime's other components.
await cp(
  path.join(root, "licenses/nodejs-mobile.LICENSE"),
  path.join(web, "assets/NODE_LICENSE.txt"),
);
await cp(path.join(ndk, "NOTICE.toolchain"), path.join(web, "assets/LIBCXX_LICENSE.txt"));
await run("zip", ["-q", "-r", path.join(staging, "assets/runtime.zip"), "."], runtime);
await writeFile(
  path.join(staging, "assets/runtime.sha256"),
  createHash("sha256")
    .update(await readFile(path.join(staging, "assets/runtime.zip")))
    .digest("hex"),
);

const native = path.join(staging, "lib/arm64-v8a");
await mkdir(native, { recursive: true });
const toolchain = path.join(ndk, "toolchains/llvm/prebuilt/linux-x86_64");
await cp(path.join(runtimeDirectory, "bin/arm64-v8a/libnode.so"), path.join(native, "libnode.so"));
await cp(
  path.join(toolchain, "sysroot/usr/lib/aarch64-linux-android/libc++_shared.so"),
  path.join(native, "libc++_shared.so"),
);
await run(path.join(toolchain, "bin/aarch64-linux-android26-clang++"), [
  "-shared",
  "-fPIC",
  "-std=c++17",
  "-O2",
  "-Wl,-z,max-page-size=16384",
  "-I" + path.join(runtimeDirectory, "include/node"),
  path.join(root, "android/native/runtime.cpp"),
  "-L" + native,
  "-lnode",
  "-llog",
  "-o",
  path.join(native, "libqmplay.so"),
]);
await run(path.join(toolchain, "bin/llvm-strip"), [
  "--strip-unneeded",
  path.join(native, "libqmplay.so"),
]);

const res = path.join(output, "res");
await cp(path.join(root, "android/res"), res, { recursive: true });
await cp(path.join(root, "assets/icon.png"), path.join(res, "drawable/icon.png"));
const apkManifest = path.join(output, "AndroidManifest.xml");
let xml = await readFile(path.join(root, "android/AndroidManifest.xml"), "utf8");
xml = xml.replace(/android:versionName="[^"]*"/, `android:versionName="${manifest.version}"`);
if (debug) xml = xml.replace("<application ", '<application android:debuggable="true" ');
await writeFile(apkManifest, xml);
const compiled = path.join(output, "resources.zip");
await run(path.join(tools, "aapt2"), ["compile", "--dir", res, "-o", compiled]);
const unsigned = path.join(output, "unsigned.apk");
const generated = path.join(output, "generated");
await mkdir(generated, { recursive: true });
await run(path.join(tools, "aapt2"), [
  "link",
  "-o",
  unsigned,
  "--manifest",
  apkManifest,
  "-I",
  androidJar,
  "--java",
  generated,
  "--auto-add-overlay",
  compiled,
]);
const classes = path.join(output, "classes");
await mkdir(classes, { recursive: true });
await run("javac", [
  "--release",
  "17",
  "-classpath",
  androidJar,
  "-d",
  classes,
  ...(await walk(path.join(root, "android/java"))),
  ...(await walk(generated)),
]);
await run("jar", ["cf", path.join(output, "classes.jar"), "-C", classes, "."]);
await run(path.join(tools, "d8"), [
  "--lib",
  androidJar,
  "--min-api",
  "26",
  "--output",
  staging,
  path.join(output, "classes.jar"),
]);
await run("zip", ["-q", "-r", unsigned, "assets", "lib", "classes.dex"], staging);
const aligned = path.join(output, "aligned.apk");
await run(path.join(tools, "zipalign"), ["-f", "-p", "4", unsigned, aligned]);
const keystore =
  process.env.QMPLAY_ANDROID_KEYSTORE ||
  path.join(os.homedir(), ".local/share/qmplay/android-signing.p12");
const password = process.env.QMPLAY_ANDROID_KEYSTORE_PASSWORD || "android";
const alias = process.env.QMPLAY_ANDROID_KEY_ALIAS || "qmplay";
process.env.QMPLAY_SIGN_PASSWORD = password;
process.env.QMPLAY_SIGN_KEY_PASSWORD = process.env.QMPLAY_ANDROID_KEY_PASSWORD || password;
if (!(await exists(keystore))) {
  if (process.env.QMPLAY_ANDROID_KEYSTORE)
    throw new Error("Configured Android keystore does not exist");
  await mkdir(path.dirname(keystore), { recursive: true, mode: 0o700 });
  await run("keytool", [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-storepass:env",
    "QMPLAY_SIGN_PASSWORD",
    "-alias",
    alias,
    "-keyalg",
    "RSA",
    "-keysize",
    "3072",
    "-validity",
    "10000",
    "-dname",
    "CN=qmplay local Android build",
  ]);
}
await mkdir(path.join(root, "release"), { recursive: true });
const apk = path.join(root, `release/qmplay-${manifest.version}-arm64${debug ? "-debug" : ""}.apk`);
await run(path.join(tools, "apksigner"), [
  "sign",
  "--ks",
  keystore,
  "--ks-key-alias",
  alias,
  "--ks-pass",
  "env:QMPLAY_SIGN_PASSWORD",
  "--key-pass",
  "env:QMPLAY_SIGN_KEY_PASSWORD",
  "--v4-signing-enabled",
  "false",
  "--out",
  apk,
  aligned,
]);
await run(path.join(tools, "apksigner"), ["verify", "--verbose", apk]);
await writeFile(
  apk + ".sha256",
  `${createHash("sha256")
    .update(await readFile(apk))
    .digest("hex")}  ${path.basename(apk)}\n`,
);
console.log(`Android APK: ${apk}`);
