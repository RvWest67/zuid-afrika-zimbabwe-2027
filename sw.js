/* Service worker Kruger & Victoria Falls planner – offline gebruik (zelfde aanpak als Ieperboog-site). */
const VERSION = 'c48a839c8c';
const PAGES = 'safari-pages-' + VERSION;
const TILES = 'safari-tiles';
const MAX_TILES = 500;
const FILES = ["./", "index.html", "periode.html", "route.html", "kaart.html", "accommodatie.html", "activiteiten.html", "praktisch.html", "checklist.html", "manifest.webmanifest", "icon.svg", "icon-maskable.svg", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css"];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(PAGES).then(c => c.addAll(FILES.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('safari-pages-') && k !== PAGES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function tileSvg(base) {
  const s = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' + (base
    ? '<rect width="256" height="256" fill="#ece8e1"/><path d="M0 .5H256M.5 0V256" stroke="#d6d0c4"/><text x="128" y="132" font-family="sans-serif" font-size="13" fill="#a39b8c" text-anchor="middle">offline · niet bewaard</text>'
    : '') + '</svg>';
  return new Response(s, {headers: {'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store'}});
}
let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(TILES); const ks = await c.keys();
    for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); } finally { trimming = false; }
}
async function osmTile(ev) {
  const url = ev.request.url, c = await caches.open(TILES), hit = await c.match(url);
  const net = fetch(url, {mode: 'cors', credentials: 'omit'}).then(r => {
    if (r.ok) { const cp = r.clone(); ev.waitUntil(c.delete(url).then(() => c.put(url, cp)).then(trimTiles)); }
    return r; }).catch(() => null);
  if (hit) { ev.waitUntil(net); return hit; }        // stale-while-revalidate
  return (await net) || tileSvg(true);
}
function pageKey(url) { let p = url.pathname.split('/').pop(); return p ? p : './'; }
async function samePage(req) {
  const c = await caches.open(PAGES), url = new URL(req.url);
  try { const r = await fetch(req);
    if (r.ok && FILES.includes(pageKey(url))) c.put(pageKey(url), r.clone());
    return r;
  } catch (e) { return (await c.match(pageKey(url))) || (await c.match('index.html')) || Response.error(); }
}
async function sameAsset(req) {
  const url = new URL(req.url), c = await caches.open(PAGES);
  const hit = await c.match(pageKey(url)) || await c.match(req, {ignoreSearch: true});
  if (hit) return hit;
  try { return await fetch(req); } catch (e) { return Response.error(); }
}
self.addEventListener('fetch', ev => {
  const req = ev.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname.endsWith('/')) ev.respondWith(samePage(req));
    else ev.respondWith(sameAsset(req));
    return;
  }
  if (url.hostname === 'tile.openstreetmap.org') { ev.respondWith(osmTile(ev)); return; }
  // Luchtfoto's (Esri, WOI-foto's) en WMS-lagen: niet bewaren; offline een lege tegel i.p.v. een fout.
  if (req.destination === 'image') {
    const base = url.hostname === 'server.arcgisonline.com';
    ev.respondWith(fetch(req).catch(() => tileSvg(base)));
  }
});
self.addEventListener('message', ev => {
  const port = ev.ports[0]; if (!port) return;
  const d = ev.data || {};
  (async () => {
    const c = await caches.open(PAGES); let n = 0;
    if (d.type === 'precache') {
      for (const u of FILES) { try { const r = await fetch(new Request(u, {cache: 'reload'})); if (r.ok) { await c.put(u, r); n++; } } catch (e) {} }
    } else { for (const u of FILES) if (await c.match(u)) n++; }
    const tiles = (await (await caches.open(TILES)).keys()).length;
    port.postMessage({n, total: FILES.length, tiles, version: VERSION});
  })();
});
