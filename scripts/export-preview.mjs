import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Script } from "node:vm";

// Export the same UI as one offline HTML file for design review without Node.
const root = new URL("../", import.meta.url);
const read = (filename) => readFile(new URL(filename, root), "utf8");
const cover = `data:image/jpeg;base64,${(await readFile(new URL("assets/coast.jpg", root))).toString("base64")}`;
const favicon = `data:image/svg+xml;base64,${(await readFile(new URL("assets/icon.svg", root))).toString("base64")}`;
const modules = await Promise.all(
	["src/icons.js", "src/data.js", "src/player.js", "src/app.js"].map(read),
);
const code = modules
	.map((source) =>
		source.replace(/^import .+;\s*$/gm, "").replace(/^export /gm, ""),
	)
	.join("\n");
const script =
	`document.addEventListener('DOMContentLoaded', async () => {\n${code}\n});`.replaceAll(
		"./assets/coast.jpg",
		cover,
	);
const hash = createHash("sha256").update(script).digest("base64");
new Script(script, { filename: "preview-inline.js" });
const css = await read("src/styles.css");
let html = await read("index.html");
html = html
	.replace("script-src 'self'", `script-src 'sha256-${hash}'`)
	.replace(
		'<link rel="stylesheet" href="./src/styles.css" />',
		() => `<style>${css}</style>`,
	);

// Keep the generated file self-contained; no asset requests or module loader.
html = html
	.replace(
		'<script type="module" src="./src/app.js"></script>',
		() => `<script>${script}</script>`,
	)
	.replaceAll("./assets/coast.jpg", cover)
	.replace("./assets/icon.svg", favicon);
await mkdir(new URL("output/", root), { recursive: true });
await writeFile(new URL("output/preview.html", root), html);
console.log("Exported output/preview.html");
