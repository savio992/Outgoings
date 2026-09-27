// Le uscite che tornano da sole, e quali devono ancora passare questo mese.
//
// Il tetto le lascia fuori apposta - non si decidono ogni giorno - ma il conto
// no: il mutuo che esce il 28 toglie dal saldo come un caffe', solo tutto
// insieme. Sapere il 20 che mancano ancora 630 euro di mutuo e' la differenza
// fra un saldo che sembra alto e un saldo che lo e'.
//
// Nessuna previsione inventata. Una ricorrenza si riconosce solo guardandola
// ripetersi: vista in due mesi diversi e' una ricorrenza, vista una volta e'
// un'uscita fissa di cui non sappiamo ancora il ritmo, e lo dice.

import { giornoDi, meseDi, impronta, meseSpostato } from './registro.js';

const centesimi = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
const due = (n) => String(n).padStart(2, '0');

function giorniDelMese(mese) {
  const [anno, m] = String(mese).split('-').map(Number);
  return new Date(Date.UTC(anno, m, 0)).getUTCDate();
}

/**
 * La chiave di una ricorrenza: beneficiario e causale, come per le fisse
 * marcate a mano. Allo stesso nome vanno sia il mutuo sia la rata del
 * condominio, e fonderli farebbe una ricorrenza sola con due importi.
 */
const chiave = (t) => [impronta(t.merchant), impronta(t.causale ?? '')].filter(Boolean).join(' | ');

/**
 * Le uscite fisse del registro, raggruppate, con lo stato del mese di `oggi`.
 *
 * `stato`:
 * - `pagata`   : c'e' gia' un'uscita questo mese;
 * - `in arrivo`: l'ultima volta e' passata in un giorno che quest'anno deve
 *                ancora venire;
 * - `attesa`   : quel giorno e' gia' passato e qui non si vede. Non vuol dire
 *                saltata: la banca contabilizza con giorni di ritardo, e le
 *                notifiche delle domiciliazioni spesso non arrivano.
 *
 * `prevista` e' il giorno del mese dell'ultima volta, portato in questo mese
 * (il 31 diventa il 30 dove il 31 non c'e'). `importo` e' quello dell'ultima
 * volta: e' il numero che la banca ha scritto, non una media che non esiste.
 */
export function ricorrenti(registro, oggi) {
  const meseOggi = String(oggi).slice(0, 7);
  const gruppi = new Map();
  for (const t of registro ?? []) {
    if (!t.fissa || t.entrata) continue;
    if (giornoDi(t) > oggi) continue;
    const k = chiave(t);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(t);
  }

  // Una fissa che non si vede da piu' di un mese non e' "in arrivo": e' un
  // mandato chiuso, o una quota annuale. Tenerla in lista ogni mese vorrebbe
  // dire annunciare per sempre un'uscita che non tornera'.
  const recente = meseSpostato(meseOggi, -1);

  const voci = [...gruppi.entries()].filter(([, righe]) => righe.some((t) => meseDi(t) >= recente)).map(([k, righe]) => {
    const ordinate = righe.slice().sort((a, b) => (giornoDi(a) < giornoDi(b) ? -1 : giornoDi(a) > giornoDi(b) ? 1 : 0));
    const ultima = ordinate[ordinate.length - 1];
    const mesi = new Set(ordinate.map(meseDi));
    const pagata = ordinate.filter((t) => meseDi(t) === meseOggi);
    const giornoTipico = Number(giornoDi(ultima).slice(8, 10));
    const prevista = `${meseOggi}-${due(Math.min(giornoTipico, giorniDelMese(meseOggi)))}`;

    let stato;
    if (pagata.length) stato = 'pagata';
    else if (prevista >= oggi) stato = 'in arrivo';
    else stato = 'attesa';

    return {
      chiave: k,
      nome: ultima.merchant,
      causale: ultima.causale ?? null,
      importo: centesimi(ultima.amount),
      pagatoQuestoMese: centesimi(pagata.reduce((s, t) => s + t.amount, 0)),
      ultimo: giornoDi(ultima),
      prevista: stato === 'pagata' ? giornoDi(pagata[pagata.length - 1]) : prevista,
      mesi: mesi.size,
      // Una volta sola non e' un ritmo: e' una fissa di cui si sa il giorno
      // di un mese solo.
      certa: mesi.size >= 2,
      stato,
    };
  });

  // Prima quelle ancora da pagare, nell'ordine in cui arriveranno; in fondo le
  // pagate. E' l'ordine in cui interessano: cosa manca, poi cosa e' gia' fatto.
  const peso = { attesa: 0, 'in arrivo': 1, pagata: 2 };
  voci.sort((a, b) => peso[a.stato] - peso[b.stato]
    || (a.prevista < b.prevista ? -1 : a.prevista > b.prevista ? 1 : 0)
    || (a.nome < b.nome ? -1 : 1));

  // Solo le ricorrenze vere pesano sul "manca ancora": una fissa vista una
  // volta potrebbe essere stata l'ultima rata, e contarla vorrebbe dire
  // togliere dal saldo soldi che non usciranno.
  const daPagare = voci.filter((v) => v.stato !== 'pagata' && v.certa);
  return {
    voci,
    daPagare: centesimi(daPagare.reduce((s, v) => s + v.importo, 0)),
    pagate: centesimi(voci.reduce((s, v) => s + v.pagatoQuestoMese, 0)),
  };
}
