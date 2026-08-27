# Brief per Claude Code — Importer spese da screenshot notifiche

## Come usare questo file

Incollalo come primo messaggio in Claude Code (o salvalo come `BRIEF.md` nella
root del repo e dì "leggi BRIEF.md").

**Non partire a scrivere codice.** La Fase 0 è una decisione di architettura che
voglio prendere io. Rispetta lo stop.

---

## Contesto

Pago quasi tutto con Apple Pay da iPhone. Ogni transazione genera una notifica
push di Poste Italiane con esercente, città e importo. Voglio trasformare
quelle notifiche in un registro spese senza inserire nulla a mano.

L'iPhone non permette a nessuna app di leggere le notifiche di altre app
(niente equivalente di `NotificationListenerService`). Quindi:

- **Ora (v1):** faccio io uno screenshot del Centro Notifiche e lo do in pasto
  a un tool che fa OCR, parsing e append su un registro.
- **Dopo (v2):** un ESP32 bonded via ANCS/BLE leggerà le stesse notifiche in
  tempo reale e produrrà lo **stesso payload**. Non è in scope adesso, ma
  l'architettura di v1 non deve rendere v2 un rewrite.

Sono uno sviluppatore (TypeScript/React lato frontend, uso GitLab, sono a mio
agio con Docker e CI). Non ho tempo da perdere in manutenzione.

---

## Dati reali di input

Screenshot del Centro Notifiche iOS, dark mode. Ogni card ha tre righe:

```
Poste Italiane                    08:06
Gocce Di Caffe. Bari, Puglia
4,00 €
```

Altri campioni veri, così tari il parser:

| Riga 1 (app + tempo)             | Riga 2 (esercente)              | Riga 3 (importo) |
| -------------------------------- | ------------------------------- | ---------------- |
| `Poste Italiane` / `08:06`       | `Gocce Di Caffe. Bari, Puglia`  | `4,00 €`         |
| `Poste Italiane` / `ieri, 18:51` | `Famila Bistro'. Bari, Puglia`  | `63,03 €`        |
| `Poste Italiane` / `ieri, 08:32` | `Gocce Di Caffe. Bari, Puglia`  | `3,50 €`         |
| `Poste Italiane` / `lun 20:03`   | `Crucotto Snc. Bari, Puglia`    | `19,00 €`        |

Osservazioni sul formato:

- L'esercente è tutto ciò che precede il primo `". "`. La parte dopo è
  `Città, Regione`.
- L'esercente può contenere apostrofi (`Bistro'`) e punti (`Snc.` a fine
  stringa, `S.r.l.` in mezzo). Attenzione a non spezzare male.
- Importo in formato italiano: virgola decimale, punto per le migliaia
  (`1.234,56 €`). Il simbolo € può finire attaccato o staccato, e l'OCR a
  volte lo perde o lo scambia con `C`/`e`.
- **Il timestamp è relativo e non ha data**: `08:06` (oggi), `ieri, HH:MM`,
  `lun HH:MM` (giorno della settimana, entro l'ultima settimana). Va risolto
  in datetime assoluto usando l'istante di cattura dello screenshot come
  riferimento, con i nomi dei giorni in italiano abbreviati
  (`lun mar mer gio ven sab dom`).
- Uno screenshot contiene N transazioni; le card ai bordi possono essere
  **tagliate a metà** e vanno scartate, non indovinate.

---

## Fase 0 — Decisione di architettura (fermati qui)

Analizza e presentami **2 o 3 opzioni concrete**, poi **aspetta la mia scelta
prima di scrivere qualsiasi codice**.

Le direzioni che ho in mente (contestale pure se ne vedi di migliori):

1. **iOS Shortcut puro** — OCR con l'azione nativa "Estrai testo
   dall'immagine" (Vision, on-device), parsing in JavaScript dentro lo
   Shortcut, append su Google Sheet o CSV su iCloud Drive. Zero repo, zero
   hosting. Massima fragilità di manutenzione, nessun test possibile.
2. **PWA statica su GitLab Pages** — upload/share dello screenshot, OCR in
   browser (`tesseract.js`), parsing e storage locale, export CSV. Nessun
   backend, nessun segreto, nessun costo, si installa sulla home dell'iPhone.
   Da verificare: qualità dell'OCR di tesseract.js su testo di sistema in
   dark mode, e peso del bundle wasm su mobile.
3. **Ibrido** — lo Shortcut fa solo l'OCR (Vision è nettamente migliore) e
   passa il **testo grezzo** alla PWA o a un endpoint. Il parsing sta in un
   pacchetto testato, non dentro lo Shortcut.

Per ognuna dimmi: sforzo iniziale, manutenzione a 6 mesi, qualità dell'OCR
attesa, e — punto chiave — **quanto codice si riusa quando arriva la sorgente
ANCS**.

Nella tua raccomandazione pesa esplicitamente il fatto che ho poco tempo:
preferisco una cosa noiosa che regge a una elegante da accudire.

---

## Requisiti (validi qualunque opzione si scelga)

### Il parser è il cuore

Deve essere una **funzione pura, isolata e sorgente-agnostica**:

```
parseNotifications(rawText: string, capturedAt: Date) => Transaction[]
```

E un secondo ingresso già pronto per v2, dove i campi arrivano già separati
dall'ANCS (che restituisce `title` / `subtitle` / `message` distinti):

```
parseStructured({ subtitle, message, receivedAt }) => Transaction
```

Modello dati:

```ts
type Transaction = {
  id: string;          // hash stabile per dedup
  merchant: string;
  city: string | null;
  region: string | null;
  amount: number;      // positivo, EUR
  occurredAt: string;  // ISO 8601, timezone Europe/Rome
  source: "screenshot" | "ancs";
  confidence: "high" | "low";  // low se l'OCR era ambiguo
  rawText: string;     // sempre conservato per il debug
};
```

### Dedup

Chiave: `merchant + amount + occurredAt` (al minuto). È quasi univoca — due
caffè identici allo stesso minuto sono improbabili. Il dedup deve reggere il
caso normale: **rifaccio lo screenshot senza aver svuotato il Centro
Notifiche**, quindi rivedo le stesse transazioni. Deve essere idempotente.

### Gestione degli errori dell'OCR

Non inventare dati. Se una riga non matcha con sicurezza, la transazione va
marcata `confidence: "low"` e mostrata per conferma manuale, non scartata in
silenzio e non "aggiustata" con euristiche creative. Preferisco correggere
tre voci che fidarmi di un numero sbagliato.

### Timezone

`Europe/Rome`, con DST. Non usare l'ora UTC del device come se fosse locale.

### Test

Il parser va testato sui campioni della tabella qui sopra, più i casi
patologici: card tagliata, importo con migliaia, esercente con punto interno,
`ieri` che scavalca la mezzanotte, `lun` risolto da un martedì vs da una
domenica.

### Output

Export CSV con colonne compatibili con l'import di Actual Budget
(`date, payee, amount, notes`). Metti l'export dietro un'interfaccia, così se
domani cambio destinazione (Google Sheet, Firefly III) tocco un solo file.

---

## Vincoli

- **Nessun servizio OCR di terze parti.** Sono i miei movimenti bancari: l'OCR
  sta on-device o in browser, punto. Niente upload a API cloud.
- **Nessuna credenziale bancaria** è coinvolta, ma i dati sono personali:
  niente telemetria, niente analytics.
- Repo su **GitLab**. Proponi tu la struttura, il `.gitlab-ci.yml` (lint +
  test, e deploy su Pages se scegliamo quella strada) e la strategia di
  branching.
- Deve funzionare comodamente **da iPhone**, non solo da desktop.
- Se serve un `CLAUDE.md`, scrivilo.

---

## Cosa mi aspetto da te adesso

Solo la Fase 0: le opzioni, i trade-off, la tua raccomandazione motivata e le
domande che ti servono per decidere. Poi ti dico quale prendiamo.
