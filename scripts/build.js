// Compone `dist/` con i soli file che servono all'app: niente test, niente
// script, niente README. Non e' un bundler e non vuole diventarlo — i moduli
// ES li serve il browser da solo, e GitHub Pages li serve senza fare storie.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// I file di `web/` finiscono nella radice del sito: il manifest e il service
// worker devono stare accanto a index.html perche' il loro scope sia l'app
// intera.
const COPIE = [
  ['index.html', 'index.html'],
  ['src', 'src'],
  ['web', '.'],
];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const [da, a] of COPIE) {
  fs.cpSync(path.join(root, da), path.join(dist, a), { recursive: true });
}

// Il service worker elenca i file da mettere in cache: se uno non c'e', l'app
// non si installa offline e nessuno se ne accorge finche' non manca la rete.
const swPath = path.join(dist, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const elencati = [...sw.matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]).filter((f) => f !== '.');

const mancanti = elencati.filter((f) => !fs.existsSync(path.join(dist, f)));
if (mancanti.length) {
  console.error('Il service worker elenca file che in dist non esistono:');
  for (const f of mancanti) console.error('  ' + f);
  process.exit(1);
}

// Il nome della cache porta l'impronta dei file. Senza, una versione fissa
// scritta a mano prima o poi non viene aggiornata, il vecchio service worker
// continua a servire i file vecchi e la correzione appena pubblicata non arriva
// a nessuno: sembra che il deploy non abbia funzionato, e invece e' la cache.
const impronta = crypto.createHash('sha256');
for (const f of elencati.sort()) impronta.update(f).update(fs.readFileSync(path.join(dist, f)));
const versione = impronta.digest('hex').slice(0, 12);

sw = sw.replace(/const VERSIONE = '[^']*';/, `const VERSIONE = 'briciole-${versione}';`);
fs.writeFileSync(swPath, sw);

// La stessa impronta finisce dove l'app puo' mostrarla. Un numero visibile e'
// l'unico modo per distinguere "il bug c'e' ancora" da "l'aggiornamento non e'
// arrivato", che a schermo si somigliano moltissimo.
const versionePath = path.join(dist, 'src/versione.js');
fs.writeFileSync(
  versionePath,
  fs.readFileSync(versionePath, 'utf8').replace(/export const VERSIONE = '[^']*';/, `export const VERSIONE = '${versione}';`),
);

const quanti = fs.readdirSync(dist, { recursive: true }).length;
console.log(`dist pronta: ${quanti} voci, cache coerente, versione ${versione}`);
