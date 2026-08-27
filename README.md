# Outgoings

Le notifiche di spesa dell'iPhone diventano un registro, senza inserire nulla a
mano.

Pago con Apple Pay, ogni transazione genera una notifica di Poste Italiane con
esercente, citta' e importo. iOS non lascia leggere a un'app le notifiche di
un'altra, quindi il testo entra da fuori: oggi da uno screenshot passato per
l'OCR di sistema, domani dallo stesso payload letto in tempo reale da un ESP32
via ANCS/BLE. Il codice che sta in mezzo e' lo stesso.

Le decisioni e il perche' stanno in [`PIANO.md`](PIANO.md). Le regole per
lavorarci in [`CLAUDE.md`](CLAUDE.md).

L'app si chiama **Briciole**: le piccole spese che si sommano.

## Stato

Funzionante. Dominio testato (parser delle due schermate, tempo relativo col DST
italiano, importi con la tolleranza dell'OCR, dedup idempotente, registro JSONL,
budget con tetto giornaliero) e PWA installabile sulla Home.

    npm test       79 test
    npm run build  compone dist/

## Come funziona

1. Screenshot della lista movimenti dell'app Poste, o del Centro Notifiche.
2. *Copia testo* da Foto - e' Live Text, cioe' Vision, l'OCR di sistema.
3. Incolla nell'app. Capisce da sola quale delle due schermate le hai dato,
   scarta le voci tagliate ai bordi e segna col pallino quelle di cui non e'
   sicura.
4. La schermata di apertura risponde a una domanda sola: quanto puoi ancora
   spendere oggi. Il tetto e' quello che resta del mese diviso i giorni che
   restano, ricalcolato ogni mattina.
5. Il registro si salva come file JSONL su iCloud Drive; l'export per Actual
   Budget e' un bottone.

Reimportare la stessa schermata non duplica niente: lo stesso testo letto due
volte lascia il registro identico.

## Le due schermate

La **lista movimenti** e' la sorgente principale: e' lo storico completo e
scorrevole, e consegna esercente e citta' gia' separati. Non ha pero' l'orario,
e non si ricostruisce - l'app tronca le distanze, quindi "14 ore fa" alle 23:02
non sono le 08:06 vere ma le 09:02.

Il **Centro Notifiche** ha l'orario esatto ma si perde quando lo svuoti. Serve
per la precisione, ed e' la stessa forma che avra' l'ANCS quando arrivera'
l'ESP32.

## Vincoli

Nessun servizio OCR di terze parti, nessun upload, nessuna telemetria: sono
movimenti bancari e restano sul telefono. Zero dipendenze.
