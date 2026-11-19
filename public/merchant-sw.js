// Intentionally do not cache authenticated screens, inventory, finances or API responses.
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.mode!=='navigate'||url.origin!==self.location.origin||url.pathname!=='/merchant')return;
 event.respondWith(fetch(req).catch(()=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SHUKCHIC Merchant</title><main style="font-family:sans-serif;padding:2rem"><h1>You are offline</h1><p>Connect to the internet to access your merchant account securely.</p><a href="/merchant">Try again</a></main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});