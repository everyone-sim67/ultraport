const HOST = self.location.hostname;
const SEGMENTS = self.location.pathname.split("/").filter(Boolean);
const ACCOUNT = HOST.endsWith(".github.io") ? HOST.slice(0, -".github.io".length) : HOST;
const REPO = SEGMENTS.length > 1 ? SEGMENTS[0] : "";
const RAW_ROOT = "https://raw.githubusercontent.com/" + ACCOUNT + "/" + REPO + "/asset-host/";
const PROXY_PATH = new URL(self.registration.scope).pathname + "asset-proxy/";

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

let manifestPromise;
function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(RAW_ROOT + "manifest.json")
      .then(response => {
        if (!response.ok) throw new Error("Asset manifest HTTP " + response.status);
        return response.json();
      });
  }
  return manifestPromise;
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PROXY_PATH)) return;

  event.respondWith((async () => {
    const filename = decodeURIComponent(url.pathname.slice(PROXY_PATH.length));
    if (!filename || filename.includes("/") || filename.includes("..")) {
      return new Response("Invalid asset name", { status: 400 });
    }

    const manifest = await getManifest();
    const file = manifest.files[filename];
    if (!file) return new Response("Asset not found: " + filename, { status: 404 });

    const parts = [];
    for (const chunk of file.chunks) {
      const response = await fetch(RAW_ROOT + chunk);
      if (!response.ok) throw new Error("Chunk fetch failed (" + response.status + "): " + chunk);
      parts.push(await response.arrayBuffer());
    }

    const type = filename.endsWith(".loader.js") || filename.includes("framework.js") ? "application/javascript" :
      filename.endsWith(".wasm.unityweb") ? "application/wasm" : "application/octet-stream";
    return new Response(new Blob(parts, { type }), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(file.size),
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  })().catch(error => new Response("Asset proxy error: " + error.message, {
    status: 502,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  })));
});
