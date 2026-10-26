import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = (await readdir(path.join(root, "tests")))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join("tests", name));
if (!files.length) throw new Error("No test files found");
const args = ["--import", "./scripts/register-typescript.mjs", "--test"];
if (process.argv.includes("--ci") || process.env.CI === "true") {
  await mkdir(path.join(root, "output"), { recursive: true });
  args.push(
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=junit",
    "--test-reporter-destination=output/test-results.xml",
  );
}
const child = spawn(process.execPath, [...args, ...files], { cwd: root, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
