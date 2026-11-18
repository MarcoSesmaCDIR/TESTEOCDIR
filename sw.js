/* Se incrementa APP_VERSION con cada nueva versión publicada. */
const APP_VERSION = 'testeo-cdir-v2.1.0';
const STATIC_FILES = ['./','./index.html','./app.js','./config.js','./manifest.webmanifest','./assets/logo-original.png','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(APP_VERSION).then(cache=>cache.addAll(STATIC_FILES)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('testeo-cdir-')&&k!==APP_VERSION).map(k=>caches.delete(k)))),self.clients.claim()]));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const u=new URL(req.url);if(u.origin!==self.location.origin)return;
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{
    if(response.ok) {const copy=response.clone();caches.open(APP_VERSION).then(cache=>cache.put(req,copy)).catch(()=>{});}return response;
  })));
});
