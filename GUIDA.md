# Guida rapida — Telegram File Sender

Guida passo per passo per chi installa l'APK e vuole che il backup automatico funzioni davvero.

---

## 1. Creare il bot e trovare il Chat ID

1. Su Telegram cerca **@BotFather** → `/newbot` → scegli un nome e un username.
2. BotFather risponde con una riga tipo:
   `1234567890:AAH-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   Questa è il **token del bot** (non condividerla con nessuno).
3. Apri la chat con il tuo nuovo bot e premi **Start** (o mandagli un "ciao").
   Senza questo passaggio Telegram non conosce ancora la chat e l'invio fallisce.
4. Per il **Chat ID**:
   - scrivi a **@userinfobot** (ti risponde subito con il tuo ID, es. `5212345678`), oppure
   - inoltra un tuo messaggio a **@RawDataBot** e leggi `chat.id`.
   - Per un canale/gruppo: aggiungi il bot come **amministratore** e usa l'ID del canale
     (inizia con `-100…`).

## 2. Configurare l'app

1. Apri **Telegram File Sender**.
2. Incolla **Token del bot** e **Chat ID** nella sezione *Destinazione*.
3. Tocca **Verifica bot e chat**: deve comparire
   *"Bot @tuo_bot collegato alla chat … Puoi inviare file"*.
   - Se dice **Token non valido** → token copiato male o revocato.
   - Se dice **Chat non trovata** → il Chat ID è sbagliato oppure non hai mai scritto al bot.
   - Se dice **Il bot non ha il permesso di scrivere** → per gruppi/canali serve l'admin.
4. (Consigliato) Tocca **Messaggio di prova**: arriva un messaggio in chat, quindi i permessi
   sono a posto.

## 3. Inviare un file singolo

1. **Scegli un file** → seleziona qualsiasi file dal telefono.
2. **Invia file** → vedi la percentuale di avanzamento.

Puoi anche usare **Condividi → Telegram File Sender** da un'altra app: il file arriva già
selezionato nella schermata principale.

> Limite: il Bot API di Telegram accetta file fino a **50 MB**. Oltre, l'app te lo dice subito.

## 4. Backup automatico di una cartella

1. **Scegli la cartella da controllare** e conferma il permesso di Android
   (appare la finestra "Consenti accesso a …"). Il permesso resta valido anche dopo il riavvio;
   se un giorno la cartella risulta *"permesso scaduto"*, basta riselezionarla.
2. Premi **Scan ora** per il primo invio: manda tutti i file presenti **una volta sola**.
3. Imposta l'ora del **Controllo giornaliero** (formato 24 ore, es. `03:00`).
4. Attiva l'interruttore **Controlla la cartella**.
5. Concedi i permessi che servono al backup puntuale (l'app te li chiede da sola, non sono
   tutti obbligatori):
   - se compare la scheda **«Consenti la sveglia esatta»**, toccala e attiva
     *Allarmi e promemoria* per l'app. Senza, Android può ritardare il backup di ore;
   - se compare la scheda **«Consenti i controlli in background»**, toccala e scegli
     **Non ottimizzare / Consenti**.
   Su Xiaomi, Huawei, Oppo, Vivo, Samsung: in *Impostazioni → Batteria* metti l'app su
   **Nessuna restrizione** e attiva l'**Avvio automatico**, altrimenti il sistema la blocca.

Da quel momento:

- ogni volta che nella cartella compare un **file nuovo o modificato** (nome, dimensione o data
  diversi), al controllo successivo viene inviato su Telegram;
- i file già inviati **non vengono rimandati**;
- i file sopra i 50 MB vengono segnalati e saltati;
- se un invio fallisce (rete assente, ecc.) il file resta "da inviare" e viene ritentato al
  controllo successivo.

## 5. Orari: come funziona davvero

All'orario scelto l'app imposta una **sveglia di sistema** Android (`AlarmManager`): il telefono
si sveglia anche in Doze e anche con l'app chiusa, e il controllo parte. La sveglia viene
riprogrammata per il giorno dopo *prima* di iniziare l'invio, e viene ricreata da sola dopo un
riavvio o un aggiornamento dell'app.

A questo si aggiungono due reti di sicurezza:

1. il controllo periodico di `expo-background-task` (WorkManager, circa ogni 15 minuti): se la
   sveglia è stata ritardata o bloccata dal produttore, il controllo parte appena possibile;
2. il **recupero all'apertura dell'app** (e al ritorno in primo piano): se il giorno non è ancora
   stato coperto, l'app controlla subito la cartella.

In pratica: il backup gira all'ora scelta; se Android non lo sveglia, recupera al primo momento
utile (sblocco del telefono o apertura dell'app) invece di perdere il giro.

## 6. Diagnostica (quando qualcosa non torna)

Nella scheda *Backup automatico* tocca **Diagnostica**:

| Voce | Cosa significa |
|---|---|
| Task in background registrato | `no` = il backup automatico non è attivo: riattiva l'interruttore |
| Sveglia di sistema | quando è previsto il prossimo risveglio e se è **esatta** o approssimativa |
| Allarmi esatti consentiti | `no` = manca il permesso *Allarmi e promemoria*: usa la scheda in alto |
| Ultimo risveglio della sveglia | quando Android ha svegliato l'app, e se per la sveglia o per un riavvio |
| Esito ultimo risveglio | cosa ha fatto il lavoro avviato dalla sveglia (o l'errore) |
| Giorno già coperto | il giorno del controllo automatico già eseguito |
| Esito ultimo tentativo | quanti file sono partiti nell'ultimo giro automatico |
| Ultimo errore | il messaggio dell'ultimo problema (rete, permessi, chat…) |
| File in memoria invii | quanti file l'app considera già inviati |
| **Azzera memoria invii** | dimentica tutto: al prossimo *Scan ora* rimanda ogni file della cartella |

Altre righe utili nella scheda: **permesso cartella attivo/scaduto**, quanti file ci sono nella
cartella, **ultimo controllo** (con la dicitura *manuale*, *automatico* o *all'apertura dell'app*)
e **prossimo controllo** previsto.

## 7. Domande frequenti

**Ho cambiato telefono: cosa devo rifare?**
Token, Chat ID e cartella sono salvati solo sul dispositivo: reinseriscili e riseleziona la
cartella.

**I file rimandati due volte?**
Succede solo se hai toccato *Azzera memoria invii* o se il permesso della cartella è cambiato e
Android assegna URI nuovi ai file. Altrimenti l'app tiene traccia di ogni invio.

**Non parte nulla di notte.**
Controlla in ordine: (1) la Diagnostica → *Sveglia di sistema* deve dire un orario, non
"non impostata"; (2) *Allarmi esatti consentiti* deve essere **sì** (altrimenti tocca la scheda
*Consenti la sveglia esatta*); (3) l'ottimizzazione batteria deve essere disattivata e, su
Xiaomi/Huawei/Oppo/Vivo/Samsung, va attivato anche l'avvio automatico dell'app.

**Ho aggiornato l'app e la sveglia è sparita.**
Non succede: dopo un aggiornamento Android cancella le sveglie, ma l'app le ricrea da sola
(receiver `MY_PACKAGE_REPLACED`). Se hai fatto un "arresto forzato" dalle impostazioni, torna
tutto alla prossima apertura dell'app o al riavvio del telefono.

**Posso usare un canale privato?**
Sì: aggiungi il bot come amministratore del canale e usa l'ID del canale (`-100…`) come Chat ID.

**Vengono controllate le sottocartelle?**
No, solo i file al primo livello della cartella scelta.

**L'app manda file se è chiusa del tutto?**
Android può eseguire il controllo anche ad app chiusa (WorkManager). Se il produttore la blocca
del tutto, il controllo viene recuperato alla prossima apertura.
