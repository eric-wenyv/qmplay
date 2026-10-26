import test from "node:test";
import assert from "node:assert/strict";
import artwork from "../electron/artwork.cjs";
test("artwork proxy accepts QQ images and rejects local, credentialed, alternate-port and lookalike hosts", () => {
  assert.equal(artwork.artworkTarget("https://y.gtimg.cn/music/photo.jpg").hostname, "y.gtimg.cn");
  for (const url of [
    "http://y.gtimg.cn/a.jpg",
    "https://127.0.0.1/private",
    "https://y.gtimg.cn.evil.com/a",
    "https://user:pass@y.gtimg.cn/a",
    "https://y.gtimg.cn:999/a",
    "file:///etc/passwd",
  ])
    assert.equal(artwork.artworkTarget(url), null);
});
