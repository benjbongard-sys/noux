const CACHE = `noux-listener14-v4:${self.registration.scope}`;
const CORE = ['index.html','app.mjs','print-marks.mjs','game-state.mjs','bisous-wallet.mjs','crypto.mjs','style.css','fonts.css','mark.svg','manifest.webmanifest','fonts/le-murmure.woff2','fonts/basteleur-moonlight.woff2','fonts/karrik-regular.woff2','fonts/karrik-italic.woff2','fonts/director-regular.woff2','fonts/naskh.ttf'];
const urlFor = name => new URL(name,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(CORE.map(name=>new Request(urlFor(name),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='CACHE_INVITATION')return;
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE),url=urlFor('payload.json');
    try { const response=await fetch(url,{cache:'no-cache'});if(response.ok)await cache.put(url,response); } catch {}
    const ready=(await cache.match(url)) && (await Promise.all(CORE.map(name=>cache.match(urlFor(name))))).every(Boolean);
    if(ready)event.source?.postMessage({type:'CACHE_READY'});
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope))return;
  const path=url.pathname.slice(new URL(self.registration.scope).pathname.length);
  const name=event.request.mode==='navigate' && (path==='' || path==='index.html')?'index.html':path;
  if(!CORE.includes(name) && name!=='payload.json')return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),key=urlFor(name);
    try { const response=await fetch(event.request);if(response.ok){await cache.put(key,response.clone());return response;}const old=await cache.match(key);return old||response; }
    catch { const old=await cache.match(key);if(old)return old;return new Response('Le carnet a besoin d’une première connexion.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}); }
  })());
});
