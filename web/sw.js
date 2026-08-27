// Service worker: l'app deve aprirsi in metropolitana come sul divano.
//
// Strategia: **rete per prima, cache come rete di scarpa**. La cache-first
// sarebbe piu' veloce, ma su una PWA installata sulla Home iOS e' anche
// ostinata: si pubblica una correzione e sul telefono resta la versione di
// prima, senza che si capisca se il bug e' ancora li' o se e' solo
// l'aggiornamento a non essere arrivato. Con questi file - poche decine di
// kilobyte in tutto - il costo di chiedere alla rete e' trascurabile, e in
// cambio si e' sempre sull'ultima versione.
//
// Offline la cache risponde comunque, che era il punto di avere un service
// worker.

// Sostituita a ogni build con l'impronta dei file: e' cio' che fa buttare la
// cache vecchia quando arriva una versione nuova.
const VERSIONE = 'briciole-sviluppo';

const FILE = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'icona.svg',
  'src/styles.css',
  'src/app.js',
  'src/store.js',
  'src/versione.js',
  'src/ui/comune.js',
  'src/ui/oggi.js',
  'src/ui/registro.js',
  'src/ui/budget.js',
  'src/ui/incolla.js',
  'src/ui/modifica.js',
  'src/domain/parser.js',
  'src/domain/banca.js',
  'src/domain/xlsx.js',
  'src/domain/tempo.js',
  'src/domain/importo.js',
  'src/domain/registro.js',
  'src/domain/budget.js',
  'src/domain/export.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      .then((c) => c.addAll(FILE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((risposta) => {
        // Quello che arriva dalla rete diventa la copia offline, cosi' la cache
        // non invecchia mai rispetto a cio' che si sta usando.
        if (risposta.ok) {
          const copia = risposta.clone();
          caches.open(VERSIONE).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return risposta;
      })
      .catch(() => caches.match(e.request).then((trovato) => trovato || Promise.reject(new Error('offline')))),
  );
});
