import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => !["--x64", "--arm64"].includes(arg)))
  throw new Error("Usage: pnpm build:windows [--x64 | --arm64]");
const arch = args[0]?.slice(2) || "x64";
const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || pkg.config.electron_mirror,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || pkg.config.electron_builder_binaries_mirror,
  ...(process.platform === "win32" ? {} : { USE_SYSTEM_WINE: "true" }),
};

if (process.platform !== "win32" && !env.ELECTRON_BUILDER_WINE_TOOLSET_DIR) {
  const wine = spawnSync("wine", ["--version"], { env, encoding: "utf8" });
  if (wine.status !== 0)
    throw new Error(
      "Windows installer builds on Linux/macOS require Wine on PATH. Install Wine or build on Windows (the Windows packages GitHub Actions workflow is also available).",
    );
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(args[0])} failed (${signal || code})`)),
    );
  });
}

await run(["scripts/check.mjs"]);
await run(["scripts/test.mjs"]);
await run(["scripts/build.mjs"]);
await run([
  require.resolve("electron-builder/out/cli/cli.js"),
  "--win",
  "nsis",
  "portable",
  `--${arch}`,
  "--publish",
  "never",
]);

const release = path.join(root, "release");
const names = ["setup", "portable"].map(
  (kind) => `${pkg.name}-${pkg.version}-win-${arch}-${kind}.exe`,
);
const checksums = [];
for (const name of names) {
  if (!(await stat(path.join(release, name))).size)
    throw new Error(`Empty release artifact: ${name}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(release, name))) hash.update(chunk);
  checksums.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(path.join(release, `SHA256SUMS-windows-${arch}`), checksums.join("\n") + "\n");
console.log(`Windows ${arch} packages are ready in ${release}:\n${names.join("\n")}`);
