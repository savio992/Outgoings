// Quello che aspetta un tocco, in un posto solo.
//
// E' la coda "da rivedere" di Monarch, ma qui non si rivede ogni spesa: la
// maggior parte arriva dall'estratto conto ed e' gia' giusta, e chiedere di
// confermarle una per una insegnerebbe solo a toccare "ok" senza guardare. In
// coda finisce cio' che rende sbagliati o incompleti i numeri, dal piu' grave:
//
// 1. le letture incerte - un importo forse sbagliato sposta il tetto;
// 2. le spese pagate da un fondo che non esiste piu' - stanno fuori dal tetto
//    e fuori da ogni fondo, cioe' da nessuna parte;
// 3. i fondi in scadenza o scaduti senza un pagamento segnato - se la spesa e'
//    arrivata e nessuno l'ha segnata, il tetto se la sta prendendo tutta;
// 4. gli esercenti di questo mese e del mese scorso ancora senza categoria.
//
// L'ultima e' l'unica che si puo' anche lasciare cosi': "Senza categoria" e'
// un posto legittimo, e un esercente che l'utente ha deciso di non etichettare
// non deve tornare in coda ogni volta. Lo si ricorda in `config.restaSenza`.
// Per le altre non c'e' un "va bene cosi'": si sistemano, o restano.

import { meseSpostato } from './registro.js';
import { raggruppa } from './statistiche.js';
import { fondiDelMese, pagamentiOrfani } from './fondi.js';

/**
 * La coda, gia' in ordine. Ogni voce ha un `tipo` e una `chiave` stabile, che
 * serve alla UI per ricordare quale ha aperto.
 */
export function daRivedere(registro, config, oggi) {
  const mese = String(oggi).slice(0, 7);
  const voci = [];

  for (const t of registro ?? []) {
    if (t.confidence === 'low') voci.push({ tipo: 'lettura', chiave: `l:${t.id}`, transazione: t });
  }

  for (const t of pagamentiOrfani(registro, config)) {
    voci.push({ tipo: 'orfano', chiave: `o:${t.id}`, transazione: t });
  }

  for (const f of fondiDelMese(config, registro, mese)) {
    // In scadenza questo mese e non ancora pagato, o gia' passato. Un fondo
    // pagato questo mese ha la scadenza spostata avanti, e qui non entra.
    if (f.scaduta || (f.scadenza === mese && f.pagatoMese === 0)) {
      voci.push({ tipo: 'scadenza', chiave: `s:${f.id}`, fondo: f });
    }
  }

  // Due mesi e non uno: il primo del mese la coda sarebbe vuota proprio quando
  // si guarda com'e' andato quello appena finito.
  const lasciati = new Set(config?.restaSenza ?? []);
  const gruppi = new Map();
  for (const m of [mese, meseSpostato(mese, -1)]) {
    for (const g of raggruppa(registro, m, config)) {
      if (g.categoria || lasciati.has(g.chiave)) continue;
      const visto = gruppi.get(g.chiave);
      gruppi.set(g.chiave, visto
        ? { ...visto, quante: visto.quante + g.quante, totale: Math.round((visto.totale + g.totale) * 100) / 100 }
        : g);
    }
  }
  // Prima quelli che pesano di piu': etichettare il supermercato sistema la
  // classifica, etichettare un caffe' visto una volta quasi niente.
  const senza = [...gruppi.values()]
    .sort((a, b) => b.totale - a.totale || (a.nome < b.nome ? -1 : 1));
  for (const g of senza) voci.push({ tipo: 'categoria', chiave: `c:${g.chiave}`, gruppo: g });

  const conta = (tipo) => voci.filter((v) => v.tipo === tipo).length;
  return {
    voci,
    quante: voci.length,
    letture: conta('lettura'),
    orfani: conta('orfano'),
    scadenze: conta('scadenza'),
    categorie: conta('categoria'),
  };
}

/** Ricorda che un esercente puo' restare senza categoria. */
export function lasciaSenzaCategoria(config, chiave) {
  const attuali = config?.restaSenza ?? [];
  return attuali.includes(chiave) ? config : { ...config, restaSenza: [...attuali, chiave] };
}
