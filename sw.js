// ══════════════════════════════════════════════
// CASA — Service Worker
// Controlla scadenze e meteo ogni ora.
// Mostra notifiche anche con l'app in background.
//
// LOGICA NOTIFICHE:
//   Scadenze programmate:
//     - 7 giorni prima
//     - Sabato e domenica della settimana della scadenza
//   Condizionali meteo:
//     - Confronta le note con il meteo attuale
//     - Notifica se le condizioni nelle note sono soddisfatte
// ══════════════════════════════════════════════

const CACHE_NAME  = 'casa-sw-v1';
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 ora in ms
const LAT = 43.2832;
const LON = 13.4534;

// ── Installazione ──
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
  // Avvia il loop di controllo
  scheduleCheck();
});

// ── Messaggi dall'app principale ──
self.addEventListener('message', e => {
  if(e.data?.type === 'SYNC_ARCHIVIO'){
    // L'app manda l'archivio aggiornato al SW
    saveArchivio(e.data.archivio);
  }
  if(e.data?.type === 'START_CHECK'){
    doCheck();
  }
});

// ── Loop periodico ──
let checkTimer = null;
function scheduleCheck(){
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    await doCheck();
    scheduleCheck(); // ripiega
  }, CHECK_INTERVAL);
}

// ── Controllo principale ──
async function doCheck(){
  const archivio = await loadArchivio();
  if(!archivio?.length) return;

  const oggi    = new Date();
  const meteo   = await fetchMeteo();
  const notificate = await loadNotificate();

  for(const e of archivio){
    await checkScadenza(e, oggi, notificate);
    await checkMeteo(e, meteo, oggi, notificate);
  }

  await saveNotificate(notificate);
}

// ── Controlla scadenze programmate ──
async function checkScadenza(e, oggi, notificate){
  if(!e.scad) return;

  const scad     = new Date(e.scad + 'T00:00:00');
  const diffDays = Math.ceil((scad - oggi) / (1000 * 60 * 60 * 24));
  const dayOfWeek = oggi.getDay(); // 0=dom, 6=sab

  // Chiavi univoche per evitare notifiche duplicate
  const key7g  = `${e.id}_7g_${scad.toISOString().slice(0,10)}`;
  const keyWe  = `${e.id}_we_${lunedi(oggi)}`;

  // 7 giorni prima
  if(diffDays === 7 && !notificate[key7g]){
    await mostraNotifica(
      `📅 ${e.titolo}`,
      `Scadenza tra 7 giorni (${formatData(scad)}). Organizzati per tempo.`,
      e.id
    );
    notificate[key7g] = true;
  }

  // Sabato o domenica della settimana della scadenza
  const scadLunedi  = lunedi(scad);
  const oggiLunedi  = lunedi(oggi);
  const stessaSettimana = scadLunedi === oggiLunedi;

  if(stessaSettimana && (dayOfWeek === 6 || dayOfWeek === 0) && !notificate[keyWe]){
    const urgenza = diffDays <= 0 ? '⚠️ Scaduto!' : `tra ${diffDays} giorn${diffDays===1?'o':'i'}`;
    await mostraNotifica(
      `🔧 ${e.titolo}`,
      `Intervento in scadenza ${urgenza} (${formatData(scad)}).`,
      e.id
    );
    notificate[keyWe] = true;
  }
}

// ── Controlla condizioni meteo nelle note ──
async function checkMeteo(e, meteo, oggi, notificate){
  if(!e.note || !meteo) return;

  const note     = e.note.toLowerCase();
  const keyMeteo = `${e.id}_meteo_${oggi.toISOString().slice(0,10)}`;
  if(notificate[keyMeteo]) return; // già notificato oggi

  const wc       = meteo.weather_code ?? meteo.weathercode ?? 0;
  const temp     = meteo.temperature_2m ?? meteo.temperature ?? null;
  const vento    = meteo.wind_speed_10m ?? meteo.windspeed ?? 0;
  const bel      = wc <= 3;   // sereno/poco nuvoloso
  const pioggia  = wc >= 51 && wc <= 67;
  const temporale= wc >= 95;
  const neve     = wc >= 71 && wc <= 77;
  const caldo    = temp !== null && temp >= 28;
  const freddo   = temp !== null && temp <= 5;
  const ventoso  = vento >= 40;

  let trigger = null;

  // Rileva condizioni citate nelle note
  if((note.includes('dopo la pioggia') || note.includes('dopo il temporale') || note.includes('dopo pioggia')) && bel && !pioggia && !temporale){
    trigger = 'Il tempo è migliorato — è il momento giusto per questo intervento.';
  } else if((note.includes('bel tempo') || note.includes('sole') || note.includes('giornata asciutta')) && bel){
    trigger = 'Bel tempo oggi — buona occasione per questo intervento.';
  } else if((note.includes('pioggia') || note.includes('quando piove')) && pioggia){
    trigger = 'Sta piovendo — controlla se è il momento per questo intervento.';
  } else if((note.includes('temporale')) && temporale){
    trigger = 'Temporale in corso — verifica se richiede attenzione.';
  } else if((note.includes('freddo') || note.includes('inverno') || note.includes('gelo')) && freddo){
    trigger = `Temperatura bassa (${Math.round(temp)}°C) — controlla questo intervento.`;
  } else if((note.includes('caldo') || note.includes('estate') || note.includes('afa')) && caldo){
    trigger = `Temperatura elevata (${Math.round(temp)}°C) — verifica questo intervento.`;
  } else if((note.includes('vento') || note.includes('ventoso')) && ventoso){
    trigger = `Vento forte (${Math.round(vento)} km/h) — controlla se necessario.`;
  }

  if(trigger){
    await mostraNotifica(`🌤 ${e.titolo}`, trigger, e.id);
    notificate[keyMeteo] = true;
  }
}

// ── Mostra notifica ──
async function mostraNotifica(titolo, corpo, id){
  if(Notification.permission !== 'granted') return;
  await self.registration.showNotification(titolo, {
    body:  corpo,
    tag:  id,
    data: { id },
    requireInteraction: false
  });
}

// Click sulla notifica → apre l'app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if(e.action === 'ignora') return;
  e.waitUntil(
    self.clients.matchAll({ type:'window' }).then(clients => {
      if(clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});

// ── Meteo da open-meteo ──
async function fetchMeteo(){
  try{
    const url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + LAT + '&longitude=' + LON +
      '&current=temperature_2m,weather_code,wind_speed_10m' +
      '&timezone=Europe%2FRome';
    const r = await fetch(url);
    if(!r.ok) return null;
    const d = await r.json();
    return d.current || d.current_weather || null;
  }catch(e){ return null; }
}

// ── Storage (IndexedDB semplificato via Cache API) ──
async function loadArchivio(){
  try{
    const cache = await caches.open(CACHE_NAME);
    const res   = await cache.match('/_sw_archivio');
    if(!res) return [];
    return await res.json();
  }catch(e){ return []; }
}

async function saveArchivio(data){
  try{
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/_sw_archivio', new Response(JSON.stringify(data)));
  }catch(e){}
}

async function loadNotificate(){
  try{
    const cache = await caches.open(CACHE_NAME);
    const res   = await cache.match('/_sw_notificate');
    if(!res) return {};
    return await res.json();
  }catch(e){ return {}; }
}

async function saveNotificate(data){
  try{
    // Pulisce le chiavi vecchie (> 30 giorni) per non accumulare
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    // semplice: salva tutto, la dimensione è minima
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/_sw_notificate', new Response(JSON.stringify(data)));
  }catch(e){}
}

// ── Helpers ──
function lunedi(d){
  const dt   = new Date(d);
  const day  = dt.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  dt.setDate(dt.getDate() + diff);
  return dt.toISOString().slice(0,10);
}

function formatData(d){
  return d.toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
}
