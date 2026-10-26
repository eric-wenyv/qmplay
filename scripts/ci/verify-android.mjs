import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateMetadata, verifyChecksums } from "./release.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function verifyAndroidBadging(badging, metadata, debug) {
	assert(badging.includes("package: name='app.qqmui'"));
	assert(badging.includes(`versionName='${metadata.version}'`));
	assert(badging.includes(`versionCode='${metadata.androidVersionCode}'`));
	// Recent aapt2 reports minSdkVersion; older versions called this sdkVersion.
	assert.match(badging, /^(?:minSdkVersion|sdkVersion):'26'\r?$/m);
	assert.match(badging, /^targetSdkVersion:'35'\r?$/m);
	assert.match(badging, /^native-code: 'arm64-v8a'\r?$/m);
	assert.equal(badging.includes("application-debuggable"), debug, "Unexpected APK debug status");
}

export async function verifyAndroid(debug = false) {
	const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
	const metadata = validateMetadata(pkg, await readFile(path.join(root, "android/AndroidManifest.xml"), "utf8"));
	const name = `qqmui-${pkg.version}-arm64${debug ? "-debug" : ""}.apk`;
	const apk = path.join(root, "release", name);
	await verifyChecksums(path.dirname(apk), name + ".sha256", [name]);
	const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), "Android/Sdk");
	const version = process.env.ANDROID_BUILD_TOOLS_VERSION || (await readdir(path.join(sdk, "build-tools"))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
	const tools = path.join(sdk, "build-tools", version);
	execFileSync(path.join(tools, "apksigner"), ["verify", "--verbose", apk], { stdio: "inherit" });
	execFileSync(path.join(tools, "zipalign"), ["-c", "-p", "4", apk], { stdio: "inherit" });
	execFileSync("unzip", ["-tq", apk], { stdio: "inherit" });
	const badging = execFileSync(path.join(tools, "aapt2"), ["dump", "badging", apk], { encoding: "utf8" });
	verifyAndroidBadging(badging, metadata, debug);
	const entries = execFileSync("unzip", ["-Z1", apk], { encoding: "utf8" }).trim().split(/\r?\n/);
	const extract = (name) => execFileSync("unzip", ["-p", apk, name], { maxBuffer: 128 * 1024 * 1024 });
	assert.equal(extract("classes.dex").toString("ascii", 0, 4), "dex\n");
	for (const name of ["libnode.so", "libqqmui.so", "libc++_shared.so"]) {
		const header = extract("lib/arm64-v8a/" + name);
		assert.equal(header.toString("ascii", 0, 4), "\x7fELF");
		assert.equal(header.readUInt16LE(18), 183, `${name} must be ARM64`);
	}
	assert(entries.filter((name) => name.endsWith(".so")).every((name) => name.startsWith("lib/arm64-v8a/")));
	const runtime = extract("assets/runtime.zip");
	assert.equal(createHash("sha256").update(runtime).digest("hex"), extract("assets/runtime.sha256").toString().trim());
	const temporary = await mkdtemp(path.join(os.tmpdir(), "qqmui-apk-"));
	try {
		const filename = path.join(temporary, "runtime.zip");
		await writeFile(filename, runtime);
		execFileSync("unzip", ["-tq", filename], { stdio: "inherit" });
		const files = execFileSync("unzip", ["-Z1", filename], { encoding: "utf8" }).trim().split(/\r?\n/);
		for (const name of ["server.cjs", "dependencies.json", "web/index.html", "web/assets/THIRD_PARTY_NOTICES.txt", "web/assets/NODE_LICENSE.txt", "web/assets/LIBCXX_LICENSE.txt"])
			assert(files.includes(name), `Missing Android runtime file: ${name}`);
	} finally { await rm(temporary, { recursive: true, force: true }); }
	console.log(`Verified ${name}: signature, alignment, version, ARM64 libraries and embedded runtime.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
	await verifyAndroid(process.argv.includes("--debug"));
