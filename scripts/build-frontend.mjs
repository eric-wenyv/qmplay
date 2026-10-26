import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledNotices } from "./build-backend.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Desktop, Android and browser development all consume this same renderer. */
export async function buildFrontend({ outdir = path.join(root, "dist"), watch = false } = {}) {
  await mkdir(outdir, { recursive: true });
  // Upgrading an older copied renderer must not retain its obsolete JS modules.
  await rm(path.join(outdir, "src"), { recursive: true, force: true });
  for (const name of ["index.html", "assets"])
    await cp(path.join(root, name), path.join(outdir, name), { recursive: true });
  const notices = path.join(outdir, "assets/frontend");
  await mkdir(notices, { recursive: true });
  const options = {
    absWorkingDir: root,
    entryPoints: ["src/main.tsx"],
    outfile: path.join(outdir, "src/app.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["chrome100"],
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.frontend.json"),
    define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
    minify: !watch,
    sourcemap: watch ? "inline" : false,
    metafile: true,
    legalComments: "eof",
    logLevel: "warning",
    plugins: [
      {
        name: "frontend-notices",
        setup(builder) {
          builder.onEnd(async (result) => {
            if (!result.errors.length && result.metafile)
              await bundledNotices(result.metafile, notices, {
                title: "Bundled frontend dependency notices",
              });
          });
        },
      },
    ],
  };
  if (watch) {
    const renderer = await context(options);
    try {
      await renderer.rebuild();
      await renderer.watch();
      return renderer;
    } catch (error) {
      await renderer.dispose();
      throw error;
    }
  }
  await build(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildFrontend();
  console.log("Built shared React renderer in dist/.");
}
