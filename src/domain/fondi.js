// Le spese che non arrivano ogni mese: l'assicurazione dell'auto, il bollo, la
// TARI, i regali di Natale.
//
// Senza un posto loro fanno sempre lo stesso danno. Undici mesi il tetto
// giornaliero se le dimentica e lascia spendere tutto; il dodicesimo arrivano
// 480 euro in un giorno solo, il tetto crolla, e sembra un mese andato male
// quando era solo un mese in cui e' arrivato un conto previsto da un anno.
//
// Qui ognuna diventa un fondo: una quota che esce dal disponibile ogni mese,
// prima del tetto, come il risparmio. Quando la spesa arriva la paghi dal fondo
// - la segni tu, sulla spesa - e il tetto di quel giorno non la vede.
//
// La quota non e' l'importo diviso dodici. E' quello che manca alla prossima
// scadenza, diviso i mesi che mancano: la stessa regola a recupero del tetto
// giornaliero, un piano piu' in alto. Un fondo aperto a settembre per una
// scadenza di novembre chiede tre quote grandi, non dodici piccole di cui nove
// gia' perse; un pagamento piu' caro del previsto lascia il fondo sotto, e i
// mesi dopo lo rimettono a posto da soli.

const centesimi = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

/** Il mese "YYYY-MM" come numero di mesi dall'anno zero, per contare. */
const indice = (mese) => {
  const [a, m] = String(mese).split('-').map(Number);
  return a * 12 + m - 1;
};
const daIndice = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const MESE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Le cadenze che il foglio propone. Il dominio ne accetta qualsiasi. */
export const CADENZE = [2, 3, 4, 6, 12, 24];

/**
 * Vero se il fondo si puo' contare. Uno scritto a meta' - senza importo,
 * senza scadenza - resta in configurazione ma non toglie niente al tetto: una
 * quota calcolata su un campo vuoto sarebbe un numero inventato.
 */
export function fondoValido(f) {
  return Boolean(f?.id)
    && Number(f.importo) > 0
    && Number.isInteger(Number(f.ogniMesi)) && Number(f.ogniMesi) >= 1
    && MESE.test(String(f.scadenza ?? ''))
    && MESE.test(String(f.inizio ?? ''));
}

/**
 * Un fondo nuovo, che comincia questo mese.
 *
 * L'id e' il primo numero libero fra quelli in configurazione *e* quelli
 * rimasti scritti sulle spese: riusarne uno che una spesa porta ancora addosso
 * farebbe finire un vecchio pagamento nel fondo sbagliato.
 */
export function nuovoFondo(config, registro, { nome, importo, ogniMesi, scadenza, giaDaParte = 0 }, oggi) {
  const usati = [
    ...(config?.fondi ?? []).map((f) => f.id),
    ...(registro ?? []).map((t) => t.fondo),
  ].map((id) => Number(String(id ?? '').replace(/^f/, ''))).filter(Number.isFinite);
  const id = `f${Math.max(0, ...usati) + 1}`;
  return {
    id,
    nome: String(nome ?? '').trim(),
    importo: centesimi(Math.max(0, Number(importo) || 0)),
    ogniMesi: Math.max(1, Math.round(Number(ogniMesi) || 12)),
    scadenza: String(scadenza ?? ''),
    inizio: String(oggi).slice(0, 7),
    giaDaParte: centesimi(Math.max(0, Number(giaDaParte) || 0)),
  };
}

/** I pagamenti segnati su un fondo, sommati per mese. Solo uscite. */
function pagatiPerMese(registro, id) {
  const perMese = new Map();
  for (const t of registro ?? []) {
    if (t.fondo !== id || t.entrata) continue;
    const m = String(t.occurredAt).slice(0, 7);
    perMese.set(m, (perMese.get(m) ?? 0) + t.amount);
  }
  return perMese;
}

/**
 * Il fondo mese per mese, dal primo fino a `mese` compreso.
 *
 * Le scadenze stanno su una griglia: la prima e' quella scritta dall'utente,
 * le altre ogni `ogniMesi`. Ognuna chiede l'importo intero, e i pagamenti le
 * saldano in ordine, dalla piu' vecchia. E' questo che regge i tre casi senza
 * indovinare niente:
 *
 * - pagata in anticipo: salda la scadenza che deve venire, e il mese della
 *   scadenza non chiede di riempire di nuovo il fondo appena svuotato;
 * - pagata in ritardo: la scadenza passata resta aperta finche' un pagamento
 *   non la chiude, e non viene scambiato per quello dell'anno dopo;
 * - pagata a pezzi (i regali, la vacanza): ogni pezzo salda una parte, e
 *   quello che supera l'importo passa alla scadenza dopo.
 *
 * La quota di un mese dipende solo dai mesi prima: pagare a meta' mese non
 * sposta il tetto dei giorni gia' passati.
 */
export function storiaFondo(fondo, registro, mese) {
  if (!fondoValido(fondo)) return { mesi: [], daParte: 0, saldate: new Map() };
  const importo = Number(fondo.importo);
  const passo = Number(fondo.ogniMesi);
  const pagati = pagatiPerMese(registro, fondo.id);

  // Si parte dal mese in cui il fondo e' nato. Un pagamento segnato prima -
  // il foglio non lo propone, ma un backup puo' portarlo - conta nel primo
  // mese invece di sparire: una spesa tolta dal tetto deve pur stare da
  // qualche parte.
  const inizio = indice(fondo.inizio);
  const fine = indice(mese);
  const prima = [...pagati.entries()].filter(([m]) => indice(m) < inizio)
    .reduce((s, [, v]) => s + v, 0);

  const s0 = indice(fondo.scadenza);
  const primaScadenza = s0 >= inizio ? s0 : s0 + Math.ceil((inizio - s0) / passo) * passo;
  const saldate = new Map();
  const aperta = () => {
    let d = primaScadenza;
    // Il tetto al giro c'e' solo per non girare all'infinito su un pagamento
    // enorme contro un importo minuscolo: cento cicli sono secoli.
    for (let k = 0; k < 100 && (saldate.get(d) ?? 0) >= importo - 0.005; k++) d += passo;
    return d;
  };
  const salda = (quanto) => {
    let resto = quanto;
    for (let k = 0; k < 100 && resto > 0.005; k++) {
      const d = aperta();
      const preso = Math.min(resto, importo - (saldate.get(d) ?? 0));
      saldate.set(d, centesimi((saldate.get(d) ?? 0) + preso));
      resto -= preso;
    }
  };

  let daParte = centesimi(Number(fondo.giaDaParte) || 0);
  const mesi = [];
  for (let i = inizio; i <= fine; i++) {
    const m = daIndice(i);
    const scadenza = aperta();
    const serve = centesimi(importo - (saldate.get(scadenza) ?? 0));
    // Una scadenza gia' passata e non pagata vale come questo mese: i soldi
    // dovevano esserci ieri, e dividere per i mesi fino a una data gia'
    // trascorsa darebbe un numero senza senso.
    const mancano = Math.max(1, scadenza - i + 1);
    const quota = centesimi(Math.max(0, (serve - daParte) / mancano));
    const pagato = centesimi((pagati.get(m) ?? 0) + (i === inizio ? prima : 0));
    mesi.push({ mese: m, scadenza: daIndice(scadenza), prima: daParte, quota, pagato });
    daParte = centesimi(daParte + quota - pagato);
    if (pagato > 0) salda(pagato);
  }
  return { mesi, daParte, saldate, prossima: daIndice(aperta()), serve: importo };
}

/**
 * Com'e' messo un fondo nel mese dato.
 *
 * `daParte` e' quello che c'e' dentro a fine mese, contata la quota di questo
 * mese e tolto quello che si e' gia' pagato: e' la cifra che serve sapere
 * quando la spesa arriva. `scadenza` e' la prossima ancora aperta, dopo i
 * pagamenti di questo mese.
 */
export function statoFondo(fondo, registro, mese) {
  const st = storiaFondo(fondo, registro, mese);
  const questo = st.mesi[st.mesi.length - 1] ?? null;
  if (!questo) {
    return {
      ...fondo, valido: fondoValido(fondo), quota: 0, daParte: 0, pagatoMese: 0,
      scadenza: fondo?.scadenza ?? null, mancano: null, pronto: false, scaduta: false, serve: 0,
    };
  }
  const importo = Number(fondo.importo);
  const scadenza = st.prossima;
  const serve = centesimi(importo - (st.saldate.get(indice(scadenza)) ?? 0));
  return {
    ...fondo,
    valido: true,
    quota: questo.quota,
    daParte: st.daParte,
    pagatoMese: questo.pagato,
    scadenza,
    serve,
    mancano: indice(scadenza) - indice(mese),
    pronto: st.daParte >= serve - 0.005,
    // Passata e non pagata. Non e' un errore del fondo: e' una spesa che il
    // registro non ha ancora visto, o che nessuno ha segnato.
    scaduta: indice(scadenza) < indice(mese),
  };
}

/** I fondi validi della configurazione, com'e' messo ognuno nel mese dato. */
export function fondiDelMese(config, registro, mese) {
  return (config?.fondi ?? []).filter(fondoValido).map((f) => statoFondo(f, registro, mese));
}

/** Quanto tolgono al disponibile, tutti insieme, nel mese dato. */
export function quoteFondi(config, registro, mese) {
  if (!(config?.fondi ?? []).length) return 0;
  return centesimi(fondiDelMese(config, registro, mese).reduce((s, f) => s + f.quota, 0));
}

/**
 * Toglie il segno di un fondo da tutte le spese che lo portano.
 *
 * Serve quando si cancella il fondo: una spesa segnata su un fondo che non
 * esiste piu' starebbe fuori dal tetto e fuori da ogni fondo, cioe' da
 * nessuna parte. Tornano spese di tutti i giorni, che e' quello che erano.
 */
export function staccaFondo(registro, id) {
  return (registro ?? []).map((t) => {
    if (t.fondo !== id) return t;
    const { fondo, ...resto } = t;
    return resto;
  });
}

/** Le spese che portano il segno di un fondo che la configurazione non ha. */
export function pagamentiOrfani(registro, config) {
  // Anche un fondo lasciato a meta' (senza importo o senza scadenza) conta come
  // assente: le sue spese stanno fuori dal tetto e nessuno le conta.
  const noti = new Set((config?.fondi ?? []).filter(fondoValido).map((f) => f.id));
  return (registro ?? []).filter((t) => t.fondo && !noti.has(t.fondo));
}
