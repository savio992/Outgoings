import test from 'node:test';
import assert from 'node:assert/strict';

import { daRivedere, lasciaSenzaCategoria } from '../src/domain/revisione.js';
import { impostaCategoriaGruppo } from '../src/domain/statistiche.js';

const riga = (id, merchant, amount, giorno, extra = {}) => ({
  id, merchant, amount, occurredAt: `${giorno}T00:00:00+02:00`, source: 'banca', confidence: 'high', ...extra,
});
const AUTO = { id: 'f1', nome: 'Assicurazione auto', importo: 480, ogniMesi: 12, scadenza: '2026-09', inizio: '2026-07' };

test('la coda mette prima cio' + "'" + ' che sposta i numeri, poi le categorie', () => {
  const registro = [
    riga('a', 'Coop', 60, '2026-09-10'),
    riga('b', 'Bar', 4, '2026-09-11', { confidence: 'low' }),
    riga('c', 'Vecchio fondo', 90, '2026-09-12', { fondo: 'f7' }),
  ];
  const r = daRivedere(registro, { fondi: [AUTO] }, '2026-09-27');
  assert.deepEqual(r.voci.map((v) => v.tipo), ['lettura', 'orfano', 'scadenza', 'categoria', 'categoria']);
  assert.equal(r.quante, 5);
  assert.equal(r.letture, 1);
  assert.equal(r.categorie, 2);
  // Fra le categorie, prima quella che pesa di piu'.
  assert.equal(r.voci[3].gruppo.nome, 'Coop');
});

test('un fondo pagato questo mese esce dalla coda', () => {
  const registro = [riga('p', 'Assicurazioni', 480, '2026-09-05', { fondo: 'f1' })];
  const r = daRivedere(registro, { fondi: [AUTO] }, '2026-09-27');
  assert.equal(r.scadenze, 0);
});

test('un fondo scaduto resta in coda anche il mese dopo', () => {
  const r = daRivedere([], { fondi: [AUTO] }, '2026-10-03');
  assert.equal(r.scadenze, 1);
  assert.equal(r.voci[0].fondo.scaduta, true);
});

test('le categorie guardano questo mese e quello prima, sommati per esercente', () => {
  const registro = [
    riga('a', 'Coop', 60, '2026-09-10'),
    riga('b', 'COOP', 40, '2026-08-20'),
    riga('c', 'Bar', 4, '2026-07-10'),
  ];
  const r = daRivedere(registro, {}, '2026-09-27');
  assert.equal(r.categorie, 1);
  assert.equal(r.voci[0].gruppo.totale, 100);
  assert.equal(r.voci[0].gruppo.quante, 2);
});

test('un esercente con la categoria, o lasciato senza apposta, non torna in coda', () => {
  const registro = [riga('a', 'Coop', 60, '2026-09-10'), riga('b', 'Bar', 4, '2026-09-11')];
  let config = impostaCategoriaGruppo({}, 'coop', 'Spesa');
  config = lasciaSenzaCategoria(config, 'bar');
  assert.equal(daRivedere(registro, config, '2026-09-27').quante, 0);
  assert.equal(lasciaSenzaCategoria(config, 'bar'), config);
});

test('entrate e uscite fisse non chiedono una categoria', () => {
  const registro = [
    riga('a', 'Stipendio', 1800, '2026-09-01', { entrata: true }),
    riga('b', 'Mutuo', 600, '2026-09-02', { fissa: true }),
  ];
  assert.equal(daRivedere(registro, {}, '2026-09-27').quante, 0);
});
