import { readFile, access } from "node:fs/promises";
import { transform } from "esbuild";

const sourceRoot = new URL("../src/", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && specifier.startsWith(".") && specifier.endsWith(".js")) {
    const url = new URL(specifier, context.parentURL);
    if (url.href.startsWith(sourceRoot)) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(url.href.slice(0, -3) + extension);
        try {
          await access(candidate);
          return { url: candidate.href, shortCircuit: true };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(sourceRoot) && /\.tsx?$/.test(url)) {
    const { code } = await transform(await readFile(new URL(url), "utf8"), {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: "node22",
      jsx: "automatic",
      sourcemap: "inline",
      sourcefile: new URL(url).pathname,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
