// Only public QQ image hosts may be fetched by the artwork proxy.
const hosts = new Set(["y.gtimg.cn", "y.qq.com", "qpic.y.qq.com", "p.qpic.cn"]);
function artworkTarget(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !hosts.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
async function fetchArtwork(value) {
  const url = artworkTarget(value);
  if (!url) return new Response("Invalid artwork URL", { status: 400 });
  try {
    const result = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!result.ok) return new Response("Artwork unavailable", { status: 404 });
    const type = result.headers.get("content-type") || "";
    if (!/^image\/(jpeg|png|webp|gif)(;|$)/i.test(type))
      return new Response("Invalid image", { status: 415 });
    // Read a bounded body, rather than trusting a missing/incorrect Content-Length.
    const reader = result.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        return new Response("Image too large", { status: 413 });
      }
      chunks.push(chunk);
    }
    return new Response(Buffer.concat(chunks), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Artwork unavailable", { status: 502 });
  }
}
module.exports = { artworkTarget, fetchArtwork };
