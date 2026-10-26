import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function validateMetadata(pkg, androidManifest, env = {}) {
	assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/, "Invalid package version");
	const androidVersionCode = Number(androidManifest.match(/android:versionCode="(\d+)"/)?.[1]);
	assert(Number.isInteger(androidVersionCode) && androidVersionCode > 0 && androidVersionCode <= 2100000000, "Invalid Android versionCode");
	const tag = env.GITHUB_REF?.startsWith("refs/tags/") ? env.GITHUB_REF.slice(10) : null;
	if (tag) assert.equal(tag, `v${pkg.version}`, "Version tag must match package.json");
	return { version: pkg.version, androidVersionCode, tag,
		isRelease: Boolean(tag && env.GITHUB_EVENT_NAME === "push"), prerelease: pkg.version.includes("-") };
}

export function packageGroups(version) {
	const prefix = `qmplay-${version}`;
	return [
		{ platform: "linux", arch: "x64", checksum: "SHA256SUMS-linux-x64", files:
			[`${prefix}-amd64.deb`, `${prefix}-x86_64.rpm`, `${prefix}-x86_64.AppImage`] },
		...["x64", "arm64"].map((arch) => ({ platform: "windows", arch, checksum: `SHA256SUMS-windows-${arch}`,
			files: ["setup", "portable"].map((kind) => `${prefix}-win-${arch}-${kind}.exe`) })),
		{ platform: "android", arch: "arm64", checksum: `${prefix}-arm64.apk.sha256`, files: [`${prefix}-arm64.apk`] },
	];
}

export async function verifyChecksums(directory, checksum, expected) {
	const records = (await readFile(path.join(directory, checksum), "utf8")).trim().split(/\r?\n/).map((line) => {
		const match = /^([a-f\d]{64}) [ *]([^/\\]+)$/.exec(line);
		assert(match && match[2] !== "." && match[2] !== "..", `Invalid checksum entry in ${checksum}`);
		return { sha256: match[1], name: match[2] };
	});
	assert.deepEqual(records.map((record) => record.name).sort(), [...expected].sort(), `Unexpected or missing files in ${checksum}`);
	for (const record of records) {
		const filename = path.join(directory, record.name);
		const info = await lstat(filename);
		assert(info.isFile() && info.size > 0, `Invalid artifact: ${record.name}`);
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(filename)) hash.update(chunk);
		assert.equal(hash.digest("hex"), record.sha256, `Checksum mismatch: ${record.name}`);
		record.size = info.size;
	}
	return records;
}

export async function prepareRelease(directory, pkg, androidManifest, env) {
	const metadata = validateMetadata(pkg, androidManifest, env);
	assert(metadata.isRelease, "Publishing requires a version tag push");
	const files = [], assets = [];
	for (const group of packageGroups(metadata.version)) {
		const verified = await verifyChecksums(directory, group.checksum, group.files);
		files.push(...verified.map((file) => ({ ...file, platform: group.platform, arch: group.arch })));
		assets.push(...group.files, group.checksum);
	}
	files.sort((a, b) => a.name.localeCompare(b.name));
	await writeFile(path.join(directory, "SHA256SUMS"), files.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n");
	await writeFile(path.join(directory, "build-manifest.json"), JSON.stringify({
		version: metadata.version, tag: metadata.tag, commit: env.GITHUB_SHA,
		androidVersionCode: metadata.androidVersionCode, files,
	}, null, 2) + "\n");
	return { ...metadata, assets: [...assets, "SHA256SUMS", "build-manifest.json"].map((name) => path.join(directory, name)) };
}

function gh(args) {
	try { return { status: 0, stdout: execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
	catch (error) { return { status: error.status, stderr: error.stderr?.toString() || error.message }; }
}

export function publishRelease({ tag, prerelease, assets, repository, run = gh }) {
	assert(repository && tag && assets.length, "Missing release metadata");
	const checked = (args) => {
		const result = run([...args, "--repo", repository]);
		assert.equal(result.status, 0, result.stderr || "GitHub release command failed");
		return result;
	};
	const existing = run(["release", "view", tag, "--json", "isDraft", "--repo", repository]);
	if (existing.status === 0) {
		assert.equal(JSON.parse(existing.stdout).isDraft, true, "Published releases are immutable; use a new version tag");
	} else {
		assert.equal(existing.status, 1, existing.stderr || "Cannot inspect release");
		checked(["release", "create", tag, "--verify-tag", "--generate-notes", "--draft", ...(prerelease ? ["--prerelease"] : [])]);
	}
	checked(["release", "upload", tag, ...assets, "--clobber"]);
	// Only expose the release after every platform asset has uploaded successfully.
	checked(["release", "edit", tag, "--draft=false", `--prerelease=${prerelease}`, `--latest=${!prerelease}`]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
	const manifest = await readFile(path.join(root, "android/AndroidManifest.xml"), "utf8");
	if (process.argv[2] === "--metadata") {
		const info = validateMetadata(pkg, manifest, process.env);
		if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
			`version=${info.version}\nis_release=${info.isRelease}\nprerelease=${info.prerelease}\nandroid_version_code=${info.androidVersionCode}\n`);
		console.log(`Version ${info.version}; Android versionCode ${info.androidVersionCode}; release ${info.isRelease}`);
	} else if (["--prepare", "--publish"].includes(process.argv[2])) {
		const release = await prepareRelease(path.resolve(process.argv[3] || "release"), pkg, manifest, process.env);
		if (process.argv[2] === "--publish") publishRelease({ ...release, repository: process.env.GITHUB_REPOSITORY });
		console.log(`Verified ${release.assets.length} release assets for ${release.tag}.`);
	} else throw new Error("Usage: release.mjs --metadata | --prepare <directory> | --publish <directory>");
}
