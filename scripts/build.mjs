import { cp, mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
for (const filename of ["assets/coast.jpg", "assets/icon.png"])
	await access(new URL(filename, root));
await rm(new URL("dist/", root), { recursive: true, force: true });
await mkdir(new URL("dist/", root), { recursive: true });
for (const name of ["index.html", "src", "assets"])
	await cp(new URL(name, root), new URL(`dist/${name}`, root), {
		recursive: true,
	});
console.log(`Built ${fileURLToPath(new URL("dist/", root))}`);
await import("./export-preview.mjs");
