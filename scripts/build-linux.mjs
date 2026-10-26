import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const env = {
	...process.env,
	ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || pkg.config.electron_mirror,
	ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || pkg.config.electron_builder_binaries_mirror,
};

function run(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(args[0])} failed (${signal || code})`)));
	});
}

if (process.platform !== "linux") throw new Error("Linux packages must be built on Linux.");
await run(["scripts/check.mjs"]);
await run(["scripts/test.mjs"]);
await run(["scripts/build.mjs"]);
const cli = require.resolve("electron-builder/out/cli/cli.js");
await run([cli, "--linux", "deb", "rpm", "AppImage", ...process.argv.slice(2), "--publish", "never"]);

const release = path.join(root, "release");
const names = (await readdir(release)).filter((name) => name.startsWith(`${pkg.name}-${pkg.version}-`) && /\.(deb|rpm|AppImage)$/.test(name)).sort();
for (const extension of ["deb", "rpm", "AppImage"])
	if (!names.some((name) => name.endsWith(`.${extension}`))) throw new Error(`Missing .${extension} output in ./release`);
const checksums = [];
for (const name of names) {
	if (!(await stat(path.join(release, name))).size) throw new Error(`Empty release artifact: ${name}`);
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path.join(release, name))) hash.update(chunk);
	checksums.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(path.join(release, "SHA256SUMS"), checksums.join("\n") + "\n");
console.log(`Linux packages are ready in ${release}:\n${names.join("\n")}`);
