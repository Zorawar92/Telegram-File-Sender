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
5. Metti l'app **fuori dall'ottimizzazione batteria**: se compare la scheda
   *"Consenti i controlli in background"* toccala e scegli **Non ottimizzare / Consenti**.
   Su Xiaomi, Huawei, Oppo, Vivo, Samsung: in *Impostazioni → Batteria* metti l'app su
   **Nessuna restrizione / Avvio automatico attivo**, altrimenti il sistema la blocca.

Da quel momento:

- ogni volta che nella cartella compare un **file nuovo o modificato** (nome, dimensione o data
  diversi), al controllo successivo viene inviato su Telegram;
- i file già inviati **non vengono rimandati**;
- i file sopra i 50 MB vengono segnalati e saltati;
- se un invio fallisce (rete assente, ecc.) il file resta "da inviare" e viene ritentato al
  controllo successivo.

## 5. Orari: come funziona davvero

Android **non garantisce** l'ora esatta: i controlli in background sono raggruppati per
risparmiare batteria. L'app quindi:

1. registra un controllo periodico (~ogni 15 minuti); quando l'orario scelto è passato e il
   giorno non è ancora stato coperto, invia i file nuovi;
2. **recupera il controllo mancato appena apri l'app** (o la riporti in primo piano);
3. se l'app è aperta all'orario scelto, parte comunque entro un minuto.

In pratica: il backup gira all'ora scelta oppure al primo momento utile in cui Android sveglia
l'app o tu la apri.

## 6. Diagnostica (quando qualcosa non torna)

Nella scheda *Backup automatico* tocca **Diagnostica**:

| Voce | Cosa significa |
|---|---|
| Task in background registrato | `no` = il backup automatico non è attivo: riattiva l'interruttore |
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
Quasi sempre è l'ottimizzazione batteria del produttore. Concedi "nessuna restrizione" e togli
l'app dalla lista delle app "messe in pausa" / "risparmio energetico adattivo".

**Posso usare un canale privato?**
Sì: aggiungi il bot come amministratore del canale e usa l'ID del canale (`-100…`) come Chat ID.

**Vengono controllate le sottocartelle?**
No, solo i file al primo livello della cartella scelta.

**L'app manda file se è chiusa del tutto?**
Android può eseguire il controllo anche ad app chiusa (WorkManager). Se il produttore la blocca
del tutto, il controllo viene recuperato alla prossima apertura.
