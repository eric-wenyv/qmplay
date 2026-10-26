// Use the same esbuild transform as the renderer; type checking runs separately.
import { register } from "node:module";
register("./typescript-loader.mjs", import.meta.url);
