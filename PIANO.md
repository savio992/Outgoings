# Fase 0 — Decisione di architettura

Stato: **deciso.** Opzione **C**, repo su **GitHub**, registro come **file JSONL
su iCloud Drive** con il `localStorage` a fare da cache.

Restano aperte due domande che non bloccano il dominio ma lo tarano: il dump
grezzo di un OCR vero, e se esistano notifiche di accredito. Vedi in fondo.

---

## Da dove parto

Prima di rispondere ho guardato `AstaHelper`, che e' il precedente piu' utile
che hai: PWA vanilla senza una sola dipendenza, ESM, `node --test`, build
artigianale in un HTML autosufficiente, service worker, GitHub Pages, commenti
in italiano che spiegano il *perche'*. Funziona, si installa sulla Home, e non
l'hai dovuta accudire.

Quel repo e' la risposta alla frase "preferisco una cosa noiosa che regge".
L'hai gia' scritta una volta. Il piano qui sotto la ricalca.

---

## Tre cose del brief che contesto

### 1. Il repo non e' su GitLab

Il brief dice GitLab, ma `Outgoings` sta su GitHub (`savio992/Outgoings`) e
`AstaHelper` gira gia' con GitHub Actions su GitHub Pages, con il workflow
scritto e i suoi due passi manuali gia' documentati. Proporti un
`.gitlab-ci.yml` significherebbe farti mantenere due CI diverse per due
progetti identici.

Salvo tua indicazione contraria, riuso il workflow di `AstaHelper`.

### 2. Gli Shortcut non hanno un vero linguaggio

L'opzione 1 del brief dice "parsing in JavaScript dentro lo Shortcut". Quel
JavaScript non esiste: l'azione "Esegui JavaScript su pagina web" gira solo nel
contesto di una pagina aperta in Safari, non su dati arbitrari. Dentro uno
Shortcut hai *Abbina testo* (regex), *Dividi*, *Sostituisci*, *Dizionario*,
*Ripeti*, *Calcola*.

Con quelle azioni devi risolvere `lun 20:03` in un datetime assoluto con il DST
di Roma, raggruppare righe in card di tre, e scartare le card tagliate. E' un
programma vero, scritto in un editor a blocchi, non versionabile, non
diffabile, non testabile. E' il punto in cui l'opzione 1 smette di essere
"un'oretta" e diventa il tuo prossimo debito.

### 3. Il rischio d'architettura non e' l'OCR — e' dove vive il registro

Il brief tratta la Fase 0 come una scelta sul motore OCR. Ma l'OCR e' lo strato
piu' facile da sostituire: e' una funzione `immagine -> testo`, e in v2 sparisce
del tutto.

Quello che v2 puo' davvero costringerti a riscrivere e' **il registro**. Se in
v1 le transazioni vivono solo nel `localStorage` di una PWA, l'ESP32 non ha modo
di scriverci dentro: un secondo produttore su un archivio raggiungibile solo dal
browser di quel telefono e' un rewrite del livello dati.

La decisione che rende v2 innestabile invece che riscrivibile e' un'altra, ed e'
gratis se la prendi ora:

- il registro canonico e' un **file append-only** (JSONL), esportabile e
  reimportabile, di cui il `localStorage` e' solo una cache;
- l'ingresso e' **una sola funzione di merge** — `merge(registro, nuove)` —
  attraverso cui passano sia lo screenshot che, domani, l'ANCS;
- l'`id` di dedup **non include `source`**. Se la stessa transazione arriva
  prima dallo screenshot e poi dall'ESP32, deve collidere e non duplicarsi.
  Mettere `source` nell'hash e' l'errore che scopri sei mesi dopo, a registro
  gia' sporco.

Su questo le tre opzioni qui sotto non si distinguono: vale per tutte. Ma va
deciso adesso.

---

## Le opzioni

### A — Shortcut puro

Vision fa l'OCR, le azioni Shortcuts fanno parsing e append su Sheet/CSV.
Niente repo.

| | |
|---|---|
| **Sforzo iniziale** | Una serata per il caso felice. Poi due o tre serate a rincorrere `lun`, il DST, le card tagliate — a blocchi, senza test. |
| **Manutenzione a 6 mesi** | Cattiva. Non versionabile, non diffabile, zero test. Quando Poste cambia il testo della notifica te ne accorgi da un importo sbagliato nel registro, non da una CI rossa. |
| **Qualita' OCR** | Ottima. Vision on-device e' il meglio disponibile. |
| **Riuso con ANCS** | **~0%.** Le azioni Shortcuts non girano su un ESP32. Si butta tutto e si riscrive il parser. |

Sconsigliata: l'unica cosa che fa bene e' l'OCR, ed e' l'unica cosa che le altre
due opzioni possono prendersi comunque.

### B — PWA statica con `tesseract.js`

Upload dello screenshot, OCR in browser via wasm, parsing e storage locali,
export CSV.

| | |
|---|---|
| **Sforzo iniziale** | Due o tre serate per guscio, parser, storage ed export — piu' uno **spike a durata ignota** sulla taratura di Tesseract. E' l'unica voce che non so stimare. |
| **Manutenzione a 6 mesi** | Buona sul codice tuo (e' il modello `AstaHelper`), ma introduce l'unica dipendenza pesante del progetto: un blob wasm e un modello linguistico. E' la parte che marcisce. |
| **Qualita' OCR** | **Il rischio.** Tesseract e' addestrato su documenti scansionati, nero su bianco. Qui hai testo chiaro su fondo quasi nero, font di sistema stretto, corpo piccolo. Serve preprocessing (inversione, upscale, soglia) e anche cosi' cifre e `€` restano il punto debole. |
| **Riuso con ANCS** | Alto: parser, modello dati, dedup ed export restano interi. Si butta solo lo strato OCR, che e' l'intento. |

Il problema non e' che Tesseract sbaglia: e' *dove* sbaglia. Una cifra storta in
`63,03 €` e' esattamente il numero sbagliato di cui hai scritto che non ti vuoi
fidare. Il flag `confidence: "low"` e' la rete giusta, ma se meta' delle righe
finiscono in revisione manuale il tool non ti sta risparmiando niente.

### C — Ibrido, con il testo come confine (la variante che proporrei)

E' l'opzione 3 del brief, con una correzione: **l'ingresso dell'app non e'
un'immagine, e' testo.** Da li' in giu' e' tutto codice testato nel repo. Sopra,
tre sorgenti intercambiabili:

1. **Incolla a mano.** Screenshot, Foto, tieni premuto, *Copia testo* (e' Live
   Text, cioe' Vision), apri la PWA, incolli in una textarea. **Costo di
   sviluppo: zero.** Funziona il giorno uno, e resta la via di scampo se
   qualsiasi altra cosa si rompe.
2. **Shortcut da tre azioni.** Dal foglio di condivisione dello screenshot:
   *Estrai testo* → *Copia negli appunti* → *Apri URL* della PWA. Nessuna
   logica dentro, quindi niente da mantenere. Lo Shortcut fa solo l'OCR, che e'
   la cosa che sa fare.
3. **Immagine + `tesseract.js`, se mai servira'.** Rimane un'opzione futura,
   fuori dal percorso critico, non un prerequisito.

| | |
|---|---|
| **Sforzo iniziale** | Due serate. **Meno** dell'opzione B, perche' salta lo spike su Tesseract. |
| **Manutenzione a 6 mesi** | La migliore. Zero dipendenze, come `AstaHelper`. La CI puo' davvero dire se il progetto e' sano, perche' tutto cio' che conta e' testabile. |
| **Qualita' OCR** | Vision, la stessa dell'opzione A. |
| **Riuso con ANCS** | **Massimo.** Il confine e' gia' "testo/campi in → `Transaction[]` → merge". L'ANCS non e' una porta nuova: e' un secondo chiamante di una porta che esiste gia'. |

Il costo onesto: se usi lo Shortcut, un pezzo della catena vive fuori dal repo e
la CI non lo vede. Lo accetto perche' quel pezzo e' lungo tre azioni e non
contiene logica — e perche' se sparisce, la via 1 continua a funzionare senza
che tu tocchi niente.

---

## Raccomandazione: C

Con questo ordine di costruzione:

**Prima il parser, senza interfaccia.** E' il cuore, e' puro, ed e' l'unica cosa
che sopravvive certamente a v2. Lo scrivo contro i campioni della tua tabella
piu' i casi patologici, e lo verifico con `node --test` prima che esista una
pagina.

**Poi la PWA piu' scema possibile:** una textarea, un elenco di transazioni
lette con le `low` in cima da confermare, un bottone di export. Nient'altro.

**Lo Shortcut per ultimo**, come ottimizzazione di due tap — non come
prerequisito.

Il criterio che pesa piu' di tutti e' il tuo: poco tempo, roba noiosa che regge.
C e' l'unica opzione in cui, se a sei mesi ti si rompe qualcosa, il tempo che
spendi lo spendi in un file `.js` con una CI che ti dice cosa hai rotto — e non
in un editor a blocchi su un telefono, o a tarare la soglia di un wasm.

---

## Cosa costruirei, se scegli C

### Struttura

```
src/
  domain/
    parser.js      parseNotifications, parseStructured
    tempo.js       tempo relativo -> ISO, Europe/Rome con DST
    importo.js     "1.234,56 €" -> 1234.56, tolleranza OCR
    registro.js    merge, dedup, id stabile
    export.js      interfaccia Destinazione + destinazione Actual Budget
  ui/
    incolla.js     textarea + esiti
    lista.js       transazioni, conferma delle `low`
  app.js
  store.js         localStorage come cache del registro
test/
  parser.test.js  tempo.test.js  importo.test.js  registro.test.js
scripts/build.js  (dal modello AstaHelper)
web/              manifest, service worker, icone
```

`domain/` non importa niente da `ui/` e non tocca `window`: gira in Node, quindi
e' testabile davvero, e domani gira ovunque arrivi il payload ANCS.

### I due ingressi, come da brief

```
parseNotifications(rawText, capturedAt) -> Transaction[]
parseStructured({ subtitle, message, receivedAt }) -> Transaction
```

Il secondo e' gia' la porta ANCS. Nota che l'ANCS espone anche un attributo
*Date* assoluto: in v2 la risoluzione del tempo relativo — la parte piu' delicata
di v1 — semplicemente non serve. E' un modulo che nasce gia' destinato a
diventare morto, e va isolato per questo.

### Dettagli che decido ora e non dopo

- **`id` = hash(merchant + amount + minuto), senza `source`.** Vedi sopra: e'
  cio' che rende idempotente il caso "rifaccio lo screenshot senza aver svuotato
  il Centro Notifiche", e domani il caso "la stessa spesa arriva da due
  sorgenti". Hash sincrono tipo FNV-1a: serve determinismo, non crittografia.
- **`Europe/Rome` senza librerie.** Costruire un istante da un orario locale con
  DST si fa con `Intl.DateTimeFormat` e una correzione dell'offset in due
  passaggi. Sono circa trenta righe testabili — non vale una dipendenza.
- **`. ` come separatore esercente/citta' solo sulla *prima* occorrenza**, cosi'
  `Snc.` a fine stringa e `S.r.l.` in mezzo non spezzano niente. `Bistro'` non e'
  un caso speciale: e' solo un apostrofo.
- **Card incompleta = scartata.** Una card entra solo se ha tutte e tre le
  componenti nell'ordine giusto. Le card ai bordi non si indovinano.
- **Niente euristiche creative sugli importi.** Se il `€` manca o l'OCR lo ha
  reso `C`/`e` accetto la riga come importo ma la marco `low`. Se il numero e'
  ambiguo, `low` e revisione. Mai un aggiustamento silenzioso.

### Casi di test, dal giorno uno

I quattro campioni della tabella, piu':

- card tagliata in cima e in fondo allo screenshot;
- `1.234,56 €` (migliaia) e `€` staccato, attaccato, mancante;
- `Crucotto Snc. Bari, Puglia` e un `S.r.l.` interno;
- `ieri, 00:12` catturato alle `00:05` — scavalca la mezzanotte;
- `lun 20:03` risolto da un martedi' (1 giorno fa) e da una domenica (6);
- `08:06` catturato alle `07:00`: ora futura, quindi screenshot vecchio → `low`;
- reimport dello stesso testo due volte → zero aggiunte, registro identico;
- l'ultima domenica di ottobre e l'ultima di marzo, per il DST.

### CI

Il workflow di `AstaHelper`, tagliato: `node --test` su ogni push, build e
deploy su Pages solo da `main`. Branching: un ramo per lavoro, merge su `main`,
`main` sempre deployabile. Per un repo a un autore non serve altro.

`CLAUDE.md`: si', corto. Zero dipendenze, `domain/` puro e testato in Node,
commenti che spiegano il perche', mai inventare dati dall'OCR.

---

## Il cold start del budget

Difetto emerso provando l'app sui dati veri, e vale la pena conoscerlo: il tetto
divide per i giorni che restano cio' che il registro dice essere avanzato. Se il
registro comincia a mese gia' iniziato - e il primo mese comincia sempre cosi' -
quello che hai speso prima non lo sa nessuno, e il tetto esce troppo alto.

Non e' correggibile: quel dato non c'e'. Quello che si puo' fare, ed e' fatto, e'
dirlo invece di lasciarlo passare per un numero buono. `statoGiorno` torna
`parziale` e `daQuando`, e la schermata di oggi ci mette un avviso. Dal secondo
mese pieno sparisce da solo.

## La terza sorgente: l'estratto conto

Arrivata dopo, ed e' la migliore delle tre. Nella descrizione di ogni pagamento
con carta c'e' data **e ora** - `PAGAMENTO POS FAMILA MEGAGEST 25/08/2026 18.51
BARI Op.600000` - piu' un numero d'operazione univoco. Risolve in un colpo i due
limiti peggiori che avevamo: l'orario che la lista dell'app non da', e il buco
di inizio mese che gonfia il tetto.

Non sostituisce gli screenshot, pero'. Fra l'acquisto e la riga in estratto
conto passano giorni, quindi le spese di oggi si vedono solo dalle notifiche.
Le tre sorgenti convivono, con ruoli diversi: la banca e' la verita' sul
passato, gli screenshot sono il presente.

**Dentro il periodo coperto vince la banca e riscrive.** Chiama gli esercenti in
un altro modo - "FAMILA MEGAGEST" dove la notifica dice "Famila Bistro'" - e le
due letture della stessa spesa non si riconoscono fra loro. Abbinarle a naso
vorrebbe dire sbagliare in silenzio, che e' l'unica cosa che questo progetto non
si permette. Fuori dall'intervallo non si tocca niente.

### Il file .xlsx si legge, non si incolla

Prima versione: "copia le righe da Excel e incollale". Con cento movimenti da un
iPhone non e' una soluzione, e' una scusa. Un .xlsx e' uno ZIP di XML, e leggerlo
senza dipendenze si puo': directory centrale dell'archivio, `DecompressionStream`
per il deflate (c'e' in Safari dalla 16.4), stringhe condivise, celle.

La parte che si dimentica sono gli **stili**. Excel salva le date come numeri
seriali, e senza il formato della cella un 46259 puo' essere tanto il 25 agosto
quanto quarantaseimila euro. E le celle vuote non le scrive affatto: bisogna
leggere il riferimento ("D6"), non contare le celle presenti, o un accredito
scivola nella colonna degli addebiti e lo stipendio diventa la spesa piu' grossa
del mese.

## Due dispositivi

Il `localStorage` e' per dispositivo, per browser e per origine. iCloud
sincronizza segnalibri, schede e password di Safari, non l'archivio locale dei
siti: iPhone e iPad hanno due depositi separati anche con lo stesso Apple ID.
Aprire l'app sull'iPad la trova quindi vuota.

Il passaggio si fa a mano, col file: "Salva tutto su iCloud Drive" produce un
backup che contiene registro **e** impostazioni, e "Riprendi da un file salvato"
lo rilegge - riconoscendo da solo se gli stai dando un backup o il JSONL
semplice. Il merge e' idempotente, quindi importare due volte non fa danni.

Resta un limite, e va conosciuto: **le cancellazioni non si propagano**. Il
merge somma, non sincronizza. Se cancelli una spesa sull'iPhone e poi importi un
file dell'iPad che la contiene ancora, quella spesa torna. Le correzioni invece
reggono, perche' si portano dietro l'id di prima.

Sistemarlo vorrebbe dire scrivere anche le cancellazioni nel registro invece di
togliere le righe - una lapide per ogni spesa cancellata, che il merge sa
rispettare. Ha senso solo se i due dispositivi si usano davvero tutti e due per
importare; se l'iPhone resta il primario e l'iPad e' un visore, non serve.

## Avviso di soglia giornaliera

Richiesta arrivata dopo la scelta dell'architettura, e va scomposta in due casi
che sembrano uno solo.

**Al momento dell'import** l'app e' gia' aperta. Una push che annuncia una cosa
che stai guardando non serve a niente: serve un banner nella pagina. Costo
zero, copre il caso piu' frequente, e non richiede nessuna infrastruttura.

**Senza aprire l'app** e' il caso vero, ed e' quello che si scontra con i
vincoli. Web Push su iOS funziona (dalla 16.4) ma a due condizioni: la PWA deve
essere installata sulla Home — e lo sara' — e serve **un server che spedisca la
push**, con le sue chiavi VAPID. Il punto che chiude la strada non e' il server
in se': e' che perche' un server sappia che hai superato la soglia, il tuo
totale giornaliero deve uscire dal telefono. E' esattamente cio' che il brief
vieta.

La via che resta e' locale, e la apre la scelta del registro su iCloud Drive:
un'**automazione Shortcuts a orario fisso** legge un file di stato che l'app
tiene aggiornato — `{ giorno, totale, soglia }`, tre campi — confronta due
numeri e notifica. Nessun backend, nessun segreto, niente che esca dal
telefono. Lo Shortcut resta stupido come l'altro: confronta, non calcola.

Il dominio non cambia in nessuno dei due casi. `totaleDelGiorno` e
`statoSoglia` sono funzioni pure, gia' scritte e testate: dove finisca l'avviso
e' una decisione della consegna, non del calcolo.

Da decidere quando ci arriviamo: la soglia e' fissa o per giorno della
settimana, e l'avviso lo vuoi quando la superi o a orario fisso la sera.

## Tempi

| | |
|---|---|
| ~~Parser + tempo + importo, con i test~~ | **fatto** |
| ~~Registro, dedup, export CSV~~ | **fatto** |
| ~~PWA (textarea, lista, tetto giornaliero) + build + Pages~~ | **fatto** |
| Avviso di soglia fuori dall'app (automazione Shortcuts) | mezz'ora |
| Shortcut e istruzioni | 20 minuti, quando ti va |

---

## Cosa mi serve da te

Le prime tre sono decise: opzione C, GitHub, JSONL su iCloud Drive. Restano:

1. **Un dump vero dell'OCR.** Questa e' la richiesta piu' utile di tutte. Ho la
   tua tabella, che descrive il *layout visivo*; il parser lavora invece sul
   *testo che Vision restituisce*, e non e' la stessa cosa — non so se ora e
   nome app finiscono sulla stessa riga, in che ordine escono le righe, se le
   card sono separate da righe vuote. Fai un *Copia testo* su uno screenshot
   vero, incollalo qui grezzo (anche con importi alterati, se preferisci) e il
   parser nasce tarato invece che indovinato.
2. **Arrivano anche notifiche di accredito** (rimborsi, bonifici in entrata)?
   Il modello dice `amount` positivo in EUR: devo sapere se serve un segno o un
   tipo, o se filtro e scarto.
