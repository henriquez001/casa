# CASA — Assistente Domestico Vocale

Assistente domestico intelligente progettato per girare sempre acceso su un vecchio telefono Android. Risponde a comandi vocali, gestisce l'archivio di manutenzione della casa, monitora il meteo e invia notifiche per le scadenze.

---

## Stack tecnico

| Componente | Tecnologia |
|---|---|
| Frontend | HTML5 + CSS3 + JavaScript vanilla (zero dipendenze) |
| AI | Claude Sonnet 4.6 via Anthropic API (browser-direct) |
| Voce input | Web Speech API — `SpeechRecognition` (Chrome Android) |
| Voce output | ElevenLabs TTS (`eleven_multilingual_v2`) con fallback browser |
| Meteo | Open-Meteo API (gratuita, no key) |
| Database | Supabase (PostgreSQL) — archivio interventi |
| Hosting | GitHub Pages (HTTPS obbligatorio per mic e notifiche) |
| Notifiche | Web Push via Service Worker |
| Schermo attivo | Screen Wake Lock API |

---

## Architettura

CASA è un **single-page application** contenuta in un singolo file `index.html` (~160KB) senza framework, bundler o dipendenze npm. Tutto il codice — HTML, CSS e JS — è inline.

```
index.html          ← app completa
sw.js               ← service worker per notifiche background
```

### Flusso principale

```
Avvio
  └─ boot()
      ├─ startClock()          → orologio HH:MM aggiornato ogni secondo
      ├─ loadWeather()         → meteo da Open-Meteo, aggiornato ogni 10min
      ├─ loadArch()            → carica archivio da localStorage
      ├─ syncFromCloud()       → sincronizza archivio da Supabase
      ├─ startWakeWord()       → avvia ascolto microfono continuo
      ├─ controlloProattivo()  → analisi Claude ogni 2 ore
      ├─ registerSW()          → registra Service Worker
      └─ requestWakeLock()     → mantiene schermo acceso
```

### Wake Word Engine

Usa `SpeechRecognition` con `continuous: true`. Il browser Chrome su Android chiude la sessione dopo ~60 secondi di silenzio; `onend` la riapre automaticamente dopo 800ms.

```
openRecognition()
  ├─ onresult → rileva "Claude" (+ varianti: clod, klaud, klod, cloud)
  │   ├─ comando inline ("Claude che tempo fa") → handleVoiceCommand()
  │   └─ solo wake word → attende frase successiva
  ├─ onerror
  │   ├─ no-speech  → ignorato (continuous lo gestisce)
  │   ├─ aborted    → ignorato (stop intenzionale)
  │   └─ not-allowed → ferma tutto, avvisa utente
  └─ onend → riapre dopo 800ms
```

### TTS Pipeline

```
speakText(text)
  ├─ Ferma SpeechRecognition (evita feedback voce→mic)
  ├─ await chime()              → tre note Do-Mi-Sol (AES oscillatori)
  ├─ if elKey && elVoice
  │   └─ ElevenLabs API → audio/mpeg → Audio.play()
  └─ else
      └─ SpeechSynthesis browser (fallback)
  └─ onend → riavvia openRecognition() dopo 600ms
```

### Archivio vocale

Claude può creare e eliminare voci dell'archivio via voce. La risposta contiene tag strutturati che vengono intercettati da `handleArchivioCmd()`:

```
ARCHIVIO_ADD:{"titolo":"...","cat":"...","data":"...","note":"...","scad":"..."}
ARCHIVIO_DEL:{"titolo":"..."}
```

Il tag viene rimosso dalla risposta mostrata all'utente; viene eseguita l'operazione sull'archivio e sincronizzata su Supabase.

---

## Funzionalità

### Home — due pannelli

**Pannello giallo (sinistra, 2/3)**
- Ora HH:MM con font Hubot Sans
- Data posizionata a 30px dal bordo superiore
- Microfono centrato a 40px dal bordo inferiore
- Sfondo giallo `#FFD60A`, testo nero

**Pannello destro (1/3)**
- Meteo: icona + descrizione a 30px dall'alto, temperatura centrata
- Se ci sono scadenze entro 7 giorni → pannello diventa rosso `#FF3B30` con lista attività in nero

### Archivio interventi

Ogni voce ha: titolo, categoria, data ultimo intervento, note, scadenza. Le categorie supportate sono: manutenzione, pulizia, impianto, riparazione, acquisto, altro.

Il **dettaglio intervento** apre una schermata dove Claude riformula le note esistenti in due sezioni (Quando / Come) senza aggiungere informazioni non presenti nelle note originali.

### Controllo proattivo

Ogni 2 ore (e 4 secondi dopo l'avvio) Claude analizza archivio + meteo + stagione e parla se rileva qualcosa di rilevante. Condizioni tipiche rilevate automaticamente: scadenze imminenti, condizioni meteo citate nelle note ("fare dopo il temporale", "controllare in estate", ecc.).

### Notifiche background

Il Service Worker (`sw.js`) controlla ogni ora:

- **Scadenze programmate**: notifica 7 giorni prima + sabato e domenica della settimana della scadenza
- **Condizioni meteo**: se nelle note di un intervento è presente una condizione meteo (pioggia, bel tempo, freddo, caldo, vento) e quella condizione è attiva, viene inviata una notifica

Il pulsante "Controlla attività ora" in Impostazioni forza il controllo immediato.

---

## Sicurezza e storage

Le chiavi API (Claude, ElevenLabs, Supabase) sono salvate **solo in localStorage** sul dispositivo. Non vengono mai trasmesse al cloud. Su un nuovo dispositivo vanno inserite una volta sola tramite il form di setup.

Su Supabase è sincronizzato **solo l'archivio** (dati non sensibili). Row Level Security (RLS) abilitato con policy `anon ALL true`.

```
localStorage keys:
  casa_key    ← API Key Claude (sk-ant-...)
  el_key      ← API Key ElevenLabs
  el_voice    ← Voice ID ElevenLabs
  sb_key      ← Supabase Anon Key
```

---

## Tipografia

| Uso | Font | Weight |
|---|---|---|
| UI generale | Roboto Mono | 300–900 |
| Numeri (ora, temperatura) | Hubot Sans | 700–900 |
| Separatori orologio | Hubot Sans / Share Tech Mono | 400 |

---

## Limitazioni note

**SpeechRecognition su Android Chrome** — L'API nativa ha un timeout di silenzio hardcoded (~5 secondi) non configurabile. Con `continuous: true` il browser chiude la sessione dopo 60 secondi circa; il sistema la riapre automaticamente. Non è possibile avere ascolto continuo stabile senza interruzioni su Chrome mobile — è un limite del browser, non del codice.

**Soluzione futura** — Migrazione su Raspberry Pi 5 con Python nativo, microfono ReSpeaker con echo cancellation hardware (AEC), e Whisper locale per trascrizione. Questo eliminerà tutti i limiti del browser e permetterà ascolto continuo vero, anche mentre Claude parla.

---

## Setup Supabase

```sql
-- Tabella archivio
create table public.Archivio (
  id          text primary key,
  titolo      text not null,
  cat         text,
  data        date,
  note        text,
  scad        date,
  creato_il   timestamptz default now()
);

-- RLS
alter table public.Archivio enable row level security;
create policy "anon all" on public.Archivio for all using (true);
```

---

## Localizzazione

Il sistema è configurato per **Contrada Cervare, Macerata** (lat 43.2832, lon 13.4534). Per cambiare posizione modificare le costanti `LAT`, `LON`, `CITY` in cima al blocco JavaScript.

---

## File

| File | Descrizione |
|---|---|
| `index.html` | App completa (HTML + CSS + JS inline) |
| `sw.js` | Service Worker per notifiche background |
| `README.md` | Questo file |