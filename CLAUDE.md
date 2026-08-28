# Outgoings

Le notifiche di spesa di Poste Italiane sull'iPhone diventano un registro, senza
inserire nulla a mano. Oggi il testo arriva da uno screenshot passato per l'OCR
di Vision; domani dallo stesso payload letto in tempo reale da un ESP32 via
ANCS/BLE.

Le decisioni di architettura e il perche' stanno in `PIANO.md`. Leggilo prima di
cambiare la forma delle cose.

## Regole

**Zero dipendenze.** Solo Node e le API del browser. Vale anche per i test
(`node --test`) e per il futuro build. Se una libreria sembra necessaria,
probabilmente il problema e' mal posto: la risoluzione del fuso con DST, l'hash
di dedup e il CSV sono tutti scritti a mano qui dentro, in poche decine di righe.

**`src/domain/` e' puro.** Non importa da `src/ui/`, non tocca `window`, non
legge l'orologio da solo (l'istante di riferimento arriva sempre come argomento).
Gira in Node, quindi si testa davvero — ed e' anche cio' che gli permettera' di
girare invariato quando la sorgente sara' l'ANCS.

**Non inventare dati.** Se una riga non e' inequivocabile, la transazione si
legge lo stesso ma esce con `confidence: 'low'` e finisce in revisione manuale.
Mai aggiustare in silenzio un numero che rappresenta soldi, mai completare una
card tagliata a meta'. Correggere tre voci a mano costa meno che fidarsi di un
importo sbagliato.

Ma "tagliata a meta'" vuol dire che manca un pezzo dell'identita' - l'esercente
o l'importo - non che manca l'ora. Una card intera senza orario si legge col
giorno dell'incollata, senza ora e in revisione: la data si sistema con un tocco,
una spesa che non c'e' non si sistema affatto. A dire quale dei due casi sia e' il
nome dell'app sopra l'esercente: se c'e', la card comincia li' ed e' tutta li'.

**Niente rete, niente telemetria.** Sono movimenti bancari. L'OCR sta
on-device, i dati restano sul telefono e su iCloud Drive. Nessun servizio terzo,
nessuna analytics, nessuna chiave da custodire.

**`source` non entra mai nell'id.** Vedi `registro.js`: la stessa spesa vista da
due sorgenti deve collidere. L'unica eccezione e' il numero d'operazione della
banca, che quando c'e' vale come identita' perche' e' piu' forte di qualsiasi
chiave ricostruita dai campi.

**Le tre sorgenti non sono pari.** L'estratto conto ha l'importo esatto, la data
*e l'ora* dentro la descrizione, il mese intero e gli accrediti: dentro il
periodo che copre vince lui e riscrive, perche' chiama gli esercenti in un altro
modo e abbinarli a naso vorrebbe dire sbagliare in silenzio. Gli screenshot
servono per le spese di oggi, che la banca contabilizzera' fra giorni.

**Vince dentro il suo periodo in tutti e due i versi.** Non basta che l'estratto
conto riscriva cio' che trova: una lettura da screenshot che *cade* nel periodo
gia' coperto non deve entrare. Sull'id non si puo' contare - la banca ha il
numero d'operazione e la notifica non l'avra' mai - e nemmeno sui campi, visto
che lo stesso posto ha due nomi diversi nelle due sorgenti. Scartarla si ripara
da solo: se era davvero una spesa non ancora contabilizzata, il prossimo
estratto conto la porta dentro.

**Il saldo e' un fatto con una data, la stima e' un conto nostro.** Il saldo lo
scrive la banca in cima all'estratto conto ed e' vero il giorno in cui l'ha
scritto. Le spese arrivate dopo il registro le ha - sono quelle delle notifiche,
che la banca contabilizzera' fra giorni - e sottrarle e' l'unica cosa che questa
app puo' fare e quella della banca no. Ma i due numeri restano separati e
etichettati: spacciare per saldo una cifra che nessuna banca ha mai scritto
sarebbe il modo piu' rapido di rendere inutile l'unico dato certo.

**Il risparmio si toglie prima, non dopo.** Quanto si vuole mettere da parte
esce dal disponibile insieme alle uscite fisse, e solo cio' che avanza diventa
il tetto giornaliero. Trattarlo come l'avanzo di fine mese vuol dire non
risparmiare: il tetto si prende comunque tutto, ed e' il motivo per cui a fine
mese i conti tornano e sul conto non resta niente.

**Uscita fissa e' solo cio' che si ripete da solo.** Domiciliazioni, addebiti
diretti, commissioni, canoni: mandati che non richiedono una decisione. Un
bonifico no - puo' essere l'affitto ma anche i pannolini per un'amica, ed e'
una spesa discrezionale che sul tetto del giorno deve pesare. La regola guarda
il tipo di operazione e non la ricorrenza: con un mese solo di estratto conto
una ricorrenza non e' osservabile. Quello che l'utente marca a mano si ricorda
per **beneficiario e causale**, non per il solo nome: allo stesso nome vanno sia
il mutuo sia i pannolini. Si sbaglia per difetto apposta - una fissa dimenticata
si vede e si sistema con un tocco, una spesa vera nascosta fra le fisse no.

**Lo stesso nome scritto in due modi e' un nome solo.** La banca scrive
"BIANCHI ANNA" nei bonifici ricevuti e "Anna Bianchi" in quelli inviati; il bar
si chiama "Gocce Di Caffe" nelle notifiche e "Gocce di caffe" via SumUp. Per
riconoscerli non serve sapere quale parola sia il cognome: basta confrontare
l'insieme delle parole, senza ordine. Fra le grafie viste si sceglie sempre
allo stesso modo, e mai una inventata. `impronta` e `grafiaMigliore` stanno in
`registro.js` perche' le usano sia l'estratto conto sia le classifiche: due
politiche diverse su cosa sia lo stesso nome vorrebbero dire due totali diversi
per la stessa spesa.

**Le categorie le attacca l'utente, l'app non le indovina.** Un dizionario di
esercenti sarebbe sbagliato il giorno stesso in cui lo si scrive: "COOP" e' la
spesa per uno e il bar dell'ufficio per un altro, e una categoria sbagliata non
si vede, perche' il totale torna lo stesso. Quindi non ce n'e' nessuna
precaricata: si sceglie a mano, una volta per esercente, e quello che resta
senza etichetta si chiama "Senza categoria" e sta in fondo, fuori dalla
classifica. Le proposte sono solo tasti comodi, non assegnazioni.

**Raggruppare non riscrive il registro.** Categorie e unioni di grafie stanno
nella configurazione e si applicano al momento del conto. Il registro tiene le
parole esatte della banca: un raggruppamento sbagliato si disfa con un tocco,
un registro riscritto no.

**Le due schermate dell'app non mostrano la stessa cosa.** "Ultime spese" ha
esercente, citta' e un giorno relativo, ma l'ora non ce l'ha; "movimenti" ha il
tipo d'operazione, il segno e - sotto il nome - la data *con il minuto*, ma la
citta' non la scrive. Le legge lo stesso `parseAppList`, perche' il lavoro e' lo
stesso, e la schermata si riconosce da cio' che solo i movimenti hanno: il segno
davanti all'importo e il tipo d'operazione in cima. Serve saperlo per la
fiducia: chiedere ai movimenti la citta' che non scrivono vorrebbe dire mandare
in revisione tutto quanto. Un tipo d'operazione che non conosciamo non porta via
la spesa - resta un nome, apre una voce che nessun importo completera' e sparisce,
mentre l'esercente sotto continua a leggersi. Si perde l'intestazione, non
l'acquisto.

**Il segno lo tiene la transazione, non la cifra.** Un importo negativo nel
registro si sommerebbe agli altri e il totale del giorno smetterebbe di essere un
totale. Dal `-14,27 €` si legge `amount: 14.27` e `entrata: false`, com'e' gia'
per l'estratto conto, e `eOperazioneFissa` sta in `banca.js` e la usano tutte e
due: due politiche diverse su cosa sia una fissa vorrebbero dire la stessa spesa
dentro il tetto giornaliero letta da una parte e fuori letta dall'altra.

**Il verso lo dicono il segno e il tipo, in quest'ordine.** Un accredito letto
per una spesa non si vede: il totale del giorno resta plausibile, solo piu' alto,
e il tetto se lo mangia tutto. Il segno accanto all'importo vale quanto la
colonna dell'estratto conto e vince quando c'e'; quando l'OCR se l'e' perso -
un "+" e' un segno sottile - resta il tipo d'operazione, che pero' lo dice solo
agli estremi: `eEntrata` sta in `banca.js` accanto a `eOperazioneFissa` e dentro
non ha "bonifico", perche' la banca scrive lo stesso "BONIFICO SEPA ISTANTANEO"
per quello ricevuto da Anna e per quello mandato ad Anna. Il suo "no" vuol dire
"il tipo non lo dice", non "e' un'uscita": in mezzo la voce si legge come spesa -
una spesa in piu' e' meno grave di una spesa sparita - ma esce in revisione. Se
segno e tipo si contraddicono uno dei due l'ha letto male l'OCR, e quale non si
sa. Nelle notifiche il verso non e' un segno ma una parola, e di notifiche di
accredito vere non ne abbiamo ancora vista una: finche' e' cosi' quella lettura
vale un controllo a mano.

**Il gateway non e' l'esercente.** "SumUp *Gocce di caffe" e' il bar sotto casa.
Senza togliere il prefisso lo stesso posto compare con due nomi a seconda del
terminale, e nel registro sembrano due esercenti.

## Struttura

    src/domain/    puro, testato, sorgente-agnostico
      tempo.js       tempo relativo -> ISO con Europe/Rome e DST (muore con la v2)
      importo.js     "1.234,56 €" -> 1234.56, con la tolleranza dell'OCR
      parser.js      notifiche, le due liste dell'app, il payload dell'ANCS
      registro.js    id, merge idempotente, JSONL, totale del giorno
      banca.js       estratto conto: la sorgente piu' precisa delle tre
      xlsx.js        legge il .xlsx della banca: ZIP, XML, seriali di Excel
      export.js      interfaccia Destinazione, oggi solo Actual Budget
      budget.js      stipendio, uscite fisse, risparmio, tetto a recupero
      statistiche.js gruppi per esercente, ricorrenze, giorni della settimana
    src/ui/        DOM: nessuna logica, solo come si mostra
    web/           manifest, service worker, icone
    test/          node --test

## Comandi

    npm test       i test del dominio
    npm run build  compone dist/ e ricalcola la versione della cache
    npm run check  tutti e due
    npm run fixture  rigenera test/dati/estratto-conto.xlsx

## Il nome

Il prodotto si chiama **Briciole**; il repository resta `Outgoings`. Il nome sta
in `src/app.js` (`NOME`), nel manifest e in `index.html`, e da nessun'altra
parte. "Outgoings" come marchio non reggerebbe: in inglese significa
letteralmente "spese", ed e' quindi descrittivo.

## Il service worker

`VERSIONE` in `web/sw.js` e `src/versione.js` vengono riscritte dal build con
l'impronta dei file. Non metterci un numero a mano: una versione che non cambia
lascia tutti sulla build precedente, e sembra che il deploy non abbia
funzionato.

La strategia e' **rete per prima, cache come rete di scarpa**. La cache-first e'
piu' veloce ma su una PWA installata sulla Home iOS resta indietro, e allora un
bug gia' corretto e un aggiornamento non arrivato diventano indistinguibili a
schermo. Per questo la versione si vede anche dentro l'app, in fondo a Budget:
serve a rispondere a "sto guardando davvero l'ultima?" senza indovinare.
