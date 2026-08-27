// Dal reddito alla soglia di oggi.
//
// La soglia non e' un numero che si sceglie: si ricava. Quello che resta dopo le
// uscite fisse, diviso i giorni che mancano alla fine del mese. E si ricalcola
// ogni giorno sul residuo vero, quindi sforare ieri abbassa il tetto di oggi
// invece di lasciare che il buco si accumuli senza dirlo.
//
// Il risparmio entra qui e non a fine mese, insieme alle uscite fisse: e' l'unico
// punto in cui mettere da parte cambia davvero qualcosa.

import { giornoDi, eSpesaVariabile, meseDi } from './registro.js';

const due = (n) => String(n).padStart(2, '0');
const centesimi = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

export const CONFIG_VUOTA = {
  stipendio: 0,
  usciteFisse: [],
  // Beneficiari che l'utente ha marcato come uscita fissa: il mutuo pagato con
  // un bonifico non e' distinguibile dai pannolini se non lo dice lui.
  fisse: [],
  // Quanto si vuole mettere da parte ogni mese.
  //
  // Non e' un traguardo da controllare a fine mese: si toglie dal disponibile
  // *prima* del tetto, insieme alle uscite fisse. Trattarlo come l'avanzo -
  // spendi, e quel che resta e' risparmio - vuol dire non risparmiare, perche'
  // il tetto si prenderebbe comunque tutto: e' il motivo per cui l'estratto
  // conto dice che il mese e' andato bene e sul conto non resta niente.
  risparmio: 0,
};

/** Quanti giorni ha il mese. Il giorno 0 del mese dopo e' l'ultimo di questo. */
export function giorniDelMese(anno, mese) {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

/** La somma delle uscite ricorrenti: affitto, rate, abbonamenti. */
export function totaleUsciteFisse(config) {
  return centesimi((config?.usciteFisse ?? []).reduce((s, u) => s + (Number(u.importo) || 0), 0));
}

/** L'obiettivo di risparmio del mese, mai negativo. */
export function obiettivoRisparmio(config) {
  return centesimi(Math.max(0, Number(config?.risparmio) || 0));
}

/** Lo stipendio meno le sole uscite fisse: quanto passa davvero dalle mani. */
export function dopoLeFisse(config) {
  return centesimi((Number(config?.stipendio) || 0) - totaleUsciteFisse(config));
}

/** Quanto resta ogni mese per le spese variabili, cioe' quelle che il registro vede. */
export function disponibileDelMese(config) {
  return centesimi(dopoLeFisse(config) - obiettivoRisparmio(config));
}

function sommaTra(registro, da, a) {
  return centesimi((registro ?? [])
    .filter((t) => {
      const g = giornoDi(t);
      return g >= da && g <= a && eSpesaVariabile(t);
    })
    .reduce((s, t) => s + t.amount, 0));
}

/**
 * Lo stato di un giorno: quanto puoi ancora spendere, e come ci si e' arrivati.
 *
 * `soglia` e' il tetto di oggi, non la media del mese: si ottiene dividendo cio'
 * che resta del mese per i giorni che restano, oggi incluso. E' questo che fa il
 * recupero - se ieri hai speso troppo, oggi il numeratore e' piu' piccolo e il
 * tetto scende da solo; se hai speso poco, sale.
 *
 * Funzione pura: il giorno arriva come argomento, non dall'orologio.
 */
export function statoGiorno(config, registro, giorno) {
  const [anno, mese, gg] = String(giorno).split('-').map(Number);
  const nelMese = giorniDelMese(anno, mese);
  const primo = `${anno}-${due(mese)}-01`;
  const ultimo = `${anno}-${due(mese)}-${due(nelMese)}`;

  // Il tetto divide per i giorni che restano cio' che il registro dice essere
  // avanzato. Se il registro comincia a mese gia' iniziato, quello che hai speso
  // prima non lo sa nessuno, e il tetto esce troppo alto. Non e' un errore di
  // calcolo ed e' inevitabile - ma va detto, non lasciato passare per un numero
  // buono.
  const giorni = (registro ?? []).filter(eSpesaVariabile).map(giornoDi).sort();
  const daQuando = giorni[0] ?? null;
  const parziale = daQuando !== null && daQuando > primo;

  const disponibile = disponibileDelMese(config);
  const obiettivo = obiettivoRisparmio(config);
  const spesoPrima = gg > 1 ? sommaTra(registro, primo, `${anno}-${due(mese)}-${due(gg - 1)}`) : 0;
  const spesoOggi = sommaTra(registro, giorno, giorno);
  const restanti = Math.max(1, nelMese - gg + 1);

  // Il tetto non scende sotto zero: quando il mese e' gia' finito il messaggio e'
  // "niente", non un numero negativo da interpretare.
  const soglia = centesimi(Math.max(0, (disponibile - spesoPrima) / restanti));

  return {
    giorno,
    disponibile,
    usciteFisse: totaleUsciteFisse(config),
    spesoPrima,
    spesoOggi,
    spesoMese: centesimi(spesoPrima + spesoOggi),
    restoMese: centesimi(disponibile - spesoPrima - spesoOggi),
    giorniRestanti: restanti,
    soglia,
    residuo: centesimi(soglia - spesoOggi),
    superata: spesoOggi > soglia && soglia > 0,
    risparmio: obiettivo,
    // Quanto sarebbe messo da parte se il mese finisse adesso: e' l'obiettivo
    // piu' cio' che del tetto e' avanzato. Sopra l'obiettivo si e' risparmiato
    // di piu'; sotto zero non e' un risparmio piccolo, e' il gruzzolo che si
    // sta consumando - e va scritto cosi', non nascosto dietro uno zero.
    messoDaParte: centesimi(obiettivo + disponibile - spesoPrima - spesoOggi),
    // Senza stipendio non c'e' niente da calcolare: la UI mostra il registro e
    // basta, invece di inventare una soglia a zero e dichiararla sforata.
    attiva: disponibile > 0,
    // Lo stipendio c'e' ma se ne va tutto in uscite fisse e risparmio. E' un
    // caso diverso dal budget spento, e merita un'altra frase: qui non manca un
    // dato, e' l'obiettivo a non lasciare niente per i giorni.
    troppoRisparmio: disponibile <= 0 && dopoLeFisse(config) > 0,
    parziale,
    daQuando,
    finestra: { primo, ultimo },
  };
}

/**
 * La media giornaliera davvero spesa nel mese fino a un giorno, oggi incluso.
 * Serve a confrontare il ritmo reale con il tetto teorico.
 */
export function mediaGiornaliera(registro, giorno) {
  const [anno, mese, gg] = String(giorno).split('-').map(Number);
  const primo = `${anno}-${due(mese)}-01`;
  return centesimi(sommaTra(registro, primo, giorno) / Math.max(1, gg));
}

/**
 * I totali degli ultimi N giorni, dal piu' vecchio al piu' recente.
 *
 * Serve alla striscia settimanale: un numero solo dice quanto hai speso oggi,
 * sette dicono se oggi e' un'eccezione o l'ennesimo giorno uguale.
 */
export function ultimiGiorni(registro, giorno, quanti = 7) {
  const fine = Date.parse(String(giorno) + 'T12:00:00Z');
  const fuori = [];
  for (let i = quanti - 1; i >= 0; i--) {
    const g = new Date(fine - i * 86400000).toISOString().slice(0, 10);
    fuori.push({ giorno: g, totale: sommaTra(registro, g, g) });
  }
  return fuori;
}

/**
 * Mese per mese, quanto e' finito da parte.
 *
 * A fine mese la domanda non e' se il tetto ha retto, ma se sul conto e'
 * rimasto qualcosa: e' l'unico numero che a fine anno si vede. Si calcola con lo
 * stipendio e le uscite fisse di *adesso*, che sui mesi passati e' un'ipotesi -
 * la UI lo dice, invece di far passare per storia quella che e' una proiezione.
 *
 * Un mese che il registro copre solo in parte non entra nel totale: il risparmio
 * calcolato sulle spese di mezzo mese sarebbe alto e falso, ed e' meglio non
 * dare un numero che darne uno gonfiato.
 */
export function risparmioDeiMesi(config, registro, oggi) {
  const spese = (registro ?? []).filter(eSpesaVariabile);
  const primoGiorno = spese.map(giornoDi).sort()[0] ?? null;
  if (!primoGiorno) return { mesi: [], totale: 0 };

  const meseOggi = String(oggi).slice(0, 7);
  const disponibile = disponibileDelMese(config);
  const obiettivo = obiettivoRisparmio(config);

  const perMese = new Map();
  for (const t of spese) {
    const m = meseDi(t);
    if (m > meseOggi) continue;
    perMese.set(m, centesimi((perMese.get(m) ?? 0) + t.amount));
  }

  const mesi = [...perMese.keys()].sort().map((mese) => {
    const speso = perMese.get(mese);
    const inCorso = mese === meseOggi;
    // Il registro parte a mese gia' iniziato: le spese dei primi giorni non le
    // ha viste nessuno, e quello che sembra risparmio e' solo assenza di dati.
    const parziale = primoGiorno > `${mese}-01`;
    return {
      mese,
      speso,
      obiettivo,
      messoDaParte: centesimi(obiettivo + disponibile - speso),
      inCorso,
      parziale,
      // Solo un mese chiuso e coperto per intero e' un risultato.
      contabile: !inCorso && !parziale,
    };
  });

  return {
    mesi,
    totale: centesimi(mesi.filter((m) => m.contabile).reduce((s, m) => s + m.messoDaParte, 0)),
  };
}

/**
 * Quanti soldi ci sono adesso, per quel che se ne puo' sapere.
 *
 * Il saldo lo dice la banca, e lo dice a una data: e' vero quel giorno e
 * comincia a invecchiare il giorno dopo. Ma le spese fatte da allora il registro
 * le ha - sono quelle lette dalle notifiche, che la banca contabilizzera' fra
 * giorni - e sottrarle e' l'unica cosa che questa app puo' fare e l'app della
 * banca no.
 *
 * `dichiarato` resta separato da `stimato` apposta: il primo e' un fatto, il
 * secondo un conto fatto da noi, e confonderli vorrebbe dire spacciare per
 * saldo un numero che nessuna banca ha mai scritto.
 *
 * Si contano *tutte* le uscite dopo quella data, fisse comprese: dal conto esce
 * anche il mutuo, che al tetto giornaliero non interessa ma al saldo si'.
 */
export function saldoStimato(config, registro, oggi) {
  const salvato = config?.saldo;
  const importo = Number(salvato?.importo);
  if (!salvato?.al || !Number.isFinite(importo)) return null;

  // Il giorno stesso del saldo e' il caso ambiguo: la banca ha fotografato il
  // conto a un'ora che non sappiamo. Quello che l'estratto conto contiene e'
  // dentro il saldo per definizione; quello che invece ha visto solo l'app -
  // una notifica, domani l'ANCS - e' arrivato dopo, perche' l'estratto conto lo
  // scarichi e poi vivi la giornata. Contare quest'ultimo e non il primo e' la
  // sola lettura che non sbaglia in nessuna delle due direzioni.
  const dopo = (registro ?? []).filter((t) => {
    const g = giornoDi(t);
    return g > salvato.al || (g === salvato.al && t.source !== 'banca');
  });
  const uscite = dopo.filter((t) => !t.entrata).reduce((s, t) => s + t.amount, 0);
  const entrate = dopo.filter((t) => t.entrata).reduce((s, t) => s + t.amount, 0);

  return {
    dichiarato: centesimi(importo),
    al: salvato.al,
    stimato: centesimi(importo - uscite + entrate),
    movimentiDopo: dopo.length,
    // Quanto e' vecchio il dato. Un saldo di tre settimane fa non e' sbagliato,
    // e' scaduto: va detto invece di lasciarlo passare per il saldo di adesso.
    giorni: Math.max(0, Math.round(
      (Date.parse(`${oggi}T12:00:00Z`) - Date.parse(`${salvato.al}T12:00:00Z`)) / 86400000,
    )),
  };
}
