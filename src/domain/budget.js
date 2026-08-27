// Dal reddito alla soglia di oggi.
//
// La soglia non e' un numero che si sceglie: si ricava. Quello che resta dopo le
// uscite fisse, diviso i giorni che mancano alla fine del mese. E si ricalcola
// ogni giorno sul residuo vero, quindi sforare ieri abbassa il tetto di oggi
// invece di lasciare che il buco si accumuli senza dirlo.

import { giornoDi, eSpesaVariabile } from './registro.js';

const due = (n) => String(n).padStart(2, '0');
const centesimi = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

export const CONFIG_VUOTA = {
  stipendio: 0,
  usciteFisse: [],
  // Beneficiari che l'utente ha marcato come uscita fissa: il mutuo pagato con
  // un bonifico non e' distinguibile dai pannolini se non lo dice lui.
  fisse: [],
};

/** Quanti giorni ha il mese. Il giorno 0 del mese dopo e' l'ultimo di questo. */
export function giorniDelMese(anno, mese) {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

/** La somma delle uscite ricorrenti: affitto, rate, abbonamenti. */
export function totaleUsciteFisse(config) {
  return centesimi((config?.usciteFisse ?? []).reduce((s, u) => s + (Number(u.importo) || 0), 0));
}

/** Quanto resta ogni mese per le spese variabili, cioe' quelle che il registro vede. */
export function disponibileDelMese(config) {
  return centesimi((Number(config?.stipendio) || 0) - totaleUsciteFisse(config));
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
    // Senza stipendio non c'e' niente da calcolare: la UI mostra il registro e
    // basta, invece di inventare una soglia a zero e dichiararla sforata.
    attiva: disponibile > 0,
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
