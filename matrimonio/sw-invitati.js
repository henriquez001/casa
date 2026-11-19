// App invitati: tiene una copia della pagina per aprirla anche senza rete.
// Prima prova sempre la rete (così gli aggiornamenti arrivano subito), la copia serve solo se la rete manca.
// Non tocca sposi.html né le richieste alla cassetta.
var CACHE = 'invitati-v1';
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  var pagina = r.mode === 'navigate' && /\/matrimonio\/(index\.html)?$/.test(u.pathname);
  if (!pagina) return;
  e.respondWith(fetch(r).then(function(res){
    if (res.ok) { var c = res.clone(); caches.open(CACHE).then(function(k){ k.put('index.html', c); }); }
    return res;
  }).catch(function(){ return caches.open(CACHE).then(function(k){ return k.match('index.html'); }).then(function(m){ return m || Response.error(); }); }));
});
