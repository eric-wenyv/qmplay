import { readdirSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { spawnSync } from "node:child_process";

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? walk(resolve(directory, entry.name))
			: [resolve(directory, entry.name)],
	);
}
const files = ["src", "electron", "scripts", "tests"]
	.flatMap(walk)
	.filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file)));
for (const file of files) {
	const result = spawnSync(process.execPath, ["--check", file], {
		stdio: "inherit",
	});
	if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
if (existsSync("backend/tsconfig.json")) {
	const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "backend/tsconfig.json", "--noEmit"], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status || 1);
}
if (existsSync("android/tsconfig.json")) {
	const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "android/tsconfig.json", "--noEmit"], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status || 1);
}
