// The player now requires its live API and same-origin artwork proxy.
// Keep the old entry point useful without generating a stale offline demo.
await import("./build.mjs");
console.log("Use npm run dev and open http://127.0.0.1:4173 to preview the live application.");
