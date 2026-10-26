import { build } from "esbuild";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function packageFor(filename) {
  let directory = path.dirname(await realpath(filename));
  while (directory !== path.dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      if (manifest.name && manifest.version) return { directory, manifest };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot locate the package for ${filename}`);
}

export async function bundledNotices(
  metafile,
  outdir,
  { title = "Bundled backend dependency notices" } = {},
) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    // esbuild metafile paths use forward slashes, including on Windows.
    if (!input.split(/[\\/]/).includes("node_modules")) continue;
    const pkg = await packageFor(path.resolve(root, input));
    packages.set(`${pkg.manifest.name}@${pkg.manifest.version}`, pkg);
  }
  const sections = [
    `# ${title}`,
    "Generated from the actual esbuild input graph. These notices apply to the bundled third-party components, not to all qmplay source code.",
    await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ];
  const inventory = [];
  for (const [identity, { directory, manifest }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const names = await readdir(directory);
    const licenseNames = names.filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const texts = [];
    for (const name of licenseNames.sort()) {
      try {
        texts.push(await readFile(path.join(directory, name), "utf8"));
      } catch (error) {
        if (error.code !== "EISDIR") throw error;
      }
    }
    if (!texts.length) {
      const readme = names.find((name) => /^readme(\.|$)/i.test(name));
      if (readme) {
        const text = await readFile(path.join(directory, readme), "utf8");
        const heading = text.search(/^#{1,3}\s+licen[cs]e\s*$/im);
        if (heading >= 0) texts.push(text.slice(heading));
      }
    }
    if (!texts.length) {
      try {
        texts.push(
          await readFile(
            path.join(root, "licenses/dependencies", `${identity.replaceAll("/", "__")}.LICENSE`),
            "utf8",
          ),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!texts.length) throw new Error(`No license text found for bundled dependency ${identity}`);
    const license = manifest.license || "See license text";
    inventory.push({ name: manifest.name, version: manifest.version, license });
    sections.push(
      `## ${identity}\n\nDeclared license: ${typeof license === "string" ? license : JSON.stringify(license)}\n\n${texts.join("\n\n")}`,
    );
  }
  await writeFile(path.join(outdir, "THIRD_PARTY_NOTICES.txt"), sections.join("\n\n") + "\n");
  await writeFile(
    path.join(outdir, "dependencies.json"),
    JSON.stringify(inventory, null, 2) + "\n",
  );
}

export async function buildBackend({
  outdir = path.join(root, "dist/backend"),
  entry = "backend/src/server.ts",
  target = "node22",
} = {}) {
  await mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: path.join(outdir, "server.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target,
    metafile: true,
    legalComments: "eof",
    logLevel: "warning",
  });
  await bundledNotices(result.metafile, outdir);
  return path.join(outdir, "server.cjs");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Built ${await buildBackend()}`);
}
