// App invitati: tiene una copia della pagina per aprirla anche senza rete.
// Prima prova la rete (così gli aggiornamenti arrivano subito); la copia serve se la rete manca o tarda più di 4 secondi.
// Non tocca sposi.html né le richieste alla cassetta.
var CACHE = 'invitati-v1';
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  var pagina = r.mode === 'navigate' && /\/matrimonio\/(index\.html)?$/.test(u.pathname);
  if (!pagina) return;
  // Se la rete non risponde entro 4 secondi e c'è una copia, apro la copia; la rete intanto aggiorna la copia per la prossima volta.
  var copia = function(){ return caches.open(CACHE).then(function(k){ return k.match('index.html'); }); };
  var rete = fetch(r).then(function(res){
    if (res.ok) { var c = res.clone(); caches.open(CACHE).then(function(k){ k.put('index.html', c); }); }
    return res;
  });
  e.respondWith(new Promise(function(ok, ko){
    var fatto = false, fine = function(x){ if (!fatto) { fatto = true; ok(x); } };
    var t = setTimeout(function(){ copia().then(function(m){ if (m) fine(m); }); }, 4000);
    rete.then(function(res){ clearTimeout(t); fine(res); }, function(){ clearTimeout(t); copia().then(function(m){ fine(m || Response.error()); }); });
  }));
  e.waitUntil(rete.catch(function(){}));
});
