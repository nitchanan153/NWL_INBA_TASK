/* Service worker ของ NWL Task — ทำให้เปิดแอปได้แม้ไม่มีอินเทอร์เน็ต
 * - ไฟล์ของแอป: ดึงจากเซิร์ฟเวอร์ก่อนเสมอ (deploy ใหม่แล้วเห็นทันทีเมื่อรีเฟรช) ถ้าออฟไลน์จึงใช้ของในแคช
 * - ฟอนต์ Google: ใช้ของในแคชก่อน (ไฟล์ฟอนต์ไม่เปลี่ยน)
 * - ข้อมูลงานอยู่ใน LocalStorage ไม่ได้ผ่านไฟล์นี้
 */
const CACHE = 'nwl-task-v3';
const SHELL = [
  './',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './favicon.ico',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./');
        return Response.error();
      })
  );
});
