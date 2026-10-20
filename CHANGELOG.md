# Changelog

## 1.3.1 — il backup automatico parte anche con l'app chiusa (Samsung)

Il backup continuava a partire solo con l'app aperta e «Scan ora». La causa non era il codice
della scansione ma **come** l'app veniva svegliata: la sveglia veniva delegata a WorkManager, che
su Android 12+ (e su Samsung One UI in particolare) può rimandare il lavoro di ore o non
eseguirlo affatto quando l'app è chiusa e il telefono è in tasca.

### Corretto

- **Sveglia «da orologio»**: al posto di `setExactAndAllowWhileIdle` ora usiamo
  `AlarmManager.setAlarmClock`, che il sistema non può spostare, esce dal risparmio energetico per
  essere consegnata e mostra l'icona della sveglia nella barra di stato (così si vede che è armata).
- **Il backup parte dal servizio, non da WorkManager**: il receiver della sveglia avvia
  direttamente un **foreground service** `dataSync` (`BackupRunService`) con wakelock, che esegue
  il task JS in headless. WorkManager resta solo come ripiego se il servizio non è avviabile.
- **Controllo di recupero**: due ore dopo il risveglio principale viene armato un secondo
  tentativo. Se il primo va perso (telefono spento, riavvio, risparmio energetico) il giro viene
  recuperato; se il backup è già stato fatto non fa nulla.
- **Permesso `USE_EXACT_ALARM`** (Android 13+): concesso all'installazione e non revocabile, quindi
  la sveglia non dipende più da «Allarmi e promemoria» attivato a mano. Su Android 12/12L resta
  `SCHEDULE_EXACT_ALARM` (concesso all'installazione) con `maxSdkVersion=32`.
- **Riarmo quando il permesso viene concesso** (`SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`).

### Aggiunto

- **«Prova la sveglia tra 1 minuto»** nella Diagnostica: arma una sveglia di prova, così si verifica
  subito che telefono → servizio → invio funzioni, senza aspettare l'orario impostato.
- **Diagnostica della sospensione**: bucket di standby di Android (`attiva` … `rara`, `limitata`,
  `mai`) e stato dell'ottimizzazione batteria, con una scheda **«Samsung: escludi l'app dalla
  sospensione»** e il pulsante per aprire le impostazioni dell'app.
- `setAlarmClock` e origine dell'ultimo risveglio (sveglia / recupero / prova / riavvio) nella
  Diagnostica.

### Note

- `USE_EXACT_ALARM` è un permesso ristretto per il Play Store (riservato a sveglie e calendari):
  qui è corretto perché l'APK si installa a mano. Per una pubblicazione sul Play Store va rimosso
  e sostituito da `SCHEDULE_EXACT_ALARM` con richiesta esplicita all'utente.
- Il servizio in primo piano mostra un avviso «Backup in corso»; su Android 13+ senza permesso
  notifiche l'avviso non compare, ma il servizio funziona lo stesso (non chiediamo permessi in più).
- Versione 1.3.1, `versionCode 5`.

## 1.3.0 — repository ridotto all'essenziale, release firmata

Nessuna modifica al comportamento dell'app: questa versione toglie tutto ciò che non serviva
al progetto Android e porta a casa il lavoro della 1.2.0 con un APK allegato alla release.

### Rimosso

- **Scaffolding Replit** mai usato dall'app: `artifacts/` (server Express, mockup sandbox, copia
  web del progetto), `lib/` (api-client, api-spec, api-zod, db/Drizzle), `scripts/`,
  `tsconfig.base.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.replit`,
  `.replitignore`, `replit.md`, `.agents/`, `attached_assets/`.
- **Archivio sorgenti** `telegram-file-sender-1.1.0-source.zip` (i sorgenti sono versionati) e
  `.sudo_as_admin_successful`, due residui dell'ambiente di sviluppo.
- **Codice morto**: `openBatterySettings` e il campo `batteryOptimized` del modulo nativo (la
  scheda batteria usa già `expo-battery` + `expo-intent-launcher`), `tryTriggerBackgroundTaskNow`.
- Commenti rimasti dallo scaffold web nei file dei colori.

Risultato: da 218 a ~50 file versionati, e il repository contiene solo l'app (`App.tsx`, `src/`,
`modules/alarm-backup`, `android/`, `assets/`) più documentazione e workflow.

### Note

- Tag e release seguono la convenzione già usata (`V1.0`, `V1.1`, `V1.2`): questa è **V1.3**;
  il workflow ora parte anche sui tag con la `V` maiuscola e allega l'APK alla release.
- Versione 1.3.0, `versionCode 4`: si installa sopra la 1.2.0 senza perdere token, Chat ID,
  cartella scelta e stato dei file già inviati.

## 1.2.0 — sveglia di sistema per il backup automatico

Il backup automatico non partiva da solo: WorkManager (usato da `expo-background-task`) è un
meccanismo "best effort", può slittare di ore o restare fermo finché il telefono non viene
sbloccato, e diversi produttori lo bloccano del tutto quando l'app è chiusa. Ora a svegliare
l'app è una **sveglia di sistema** di Android, all'orario scelto.

### Aggiunto

- **Modulo nativo `modules/alarm-backup`**: sveglia quotidiana con
  `AlarmManager.setExactAndAllowWhileIdle` (funziona anche in Doze / a telefono fermo), con
  riprogrammazione automatica del giorno successivo **prima** di eseguire il backup, così un
  errore non spegne i controlli futuri.
- **Receiver del riavvio**: dopo un riavvio, un aggiornamento dell'app o un cambio di ora/fuso
  la sveglia viene rimessa in piedi da sola (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`,
  `TIMEZONE_CHANGED`).
- **Esecuzione del task in headless**: la sveglia accoda un lavoro `WorkManager` che avvia l'app
  in background ed esegue il task già registrato con `expo-background-task` (stessa strada usata
  da Expo, quindi nessun doppio task JavaScript da mantenere).
- **Permesso «Allarmi e promemoria»** (`SCHEDULE_EXACT_ALARM`, Android 12+): l'app mostra una
  scheda con il pulsante che apre la schermata giusta delle impostazioni. Senza permesso il
  backup usa una sveglia approssimativa invece di non partire affatto.
- **Diagnostica della sveglia**: prossimo risveglio (esatto/approssimativo), ultimo risveglio
  (sveglia o riavvio), esito dell'ultimo tentativo, stato del permesso.
- Il cambio dell'orario nell'app riprogramma subito la sveglia; spegnere l'interruttore la
  cancella.

### Corretto

- **Sorgenti mancanti nel repository**: `src/`, `android/` e `assets/` c'erano solo nello zip
  `telegram-file-sender-1.1.0-source.zip`, quindi il repo non si poteva compilare. Ora sono
  versionati.
- **Workflow GitHub** unico e funzionante (`build-apk.yml`): il precedente `release.yml`
  eseguiva `./gradlew` dalla radice, dove non c'è `gradlew`, e non poteva produrre l'APK.
- **Doppio controllo ravvicinato**: se sveglia e task periodico partono insieme, il secondo non
  segna più il giorno come coperto né registra un finto errore («controllo già in corso»).
- **`npm run typecheck`** non si perde più nei progetti Replit inutilizzati (esclusi dal
  `tsconfig`; nella 1.3.0 sono stati rimossi del tutto).

### Note

- `package.json` → `expo.autolinking.buildFromSource: ["expo-background-task"]`: la sveglia
  riusa lo scheduler di `expo-background-task`, che quindi viene compilato dai sorgenti invece
  di usare l'AAR precompilato.
- WorkManager resta attivo come rete di sicurezza (~ogni 15 minuti) insieme al recupero
  all'apertura dell'app: se la sveglia viene bloccata dal produttore, il controllo slitta ma non
  si perde.
- Un "arresto forzato" da Impostazioni cancella le sveglie di Android: si ripristinano alla
  prossima apertura dell'app o al riavvio. È un limite del sistema, non dell'app.

## 1.1.0 — correzione invii e backup automatico

Questa versione riparte dal progetto originale (`Zorawar92/Telegram-File-Sender`) e corregge i
problemi segnalati: il backup automatico non partiva, lo "Scan ora" diceva di non riuscire a
collegarsi al bot, i file nuovi della cartella non venivano mai inviati.

### Corretto

- **Invio dei file riscritto sull'upload nativo** (`expo-file-system` `File.upload`, multipart).
  Prima il `File` nativo veniva passato a `FormData` come se fosse un blob: React Native si aspetta
  solo `{ uri, name, type }`, quindi il file partiva senza corpo/allegato e la richiesta falliva con
  un errore di rete — il classico "non connette al bot" nonostante `getMe` rispondesse.
  Ora funziona sia con i file scelti dal picker (`file://`) sia con quelli delle cartelle
  autorizzate (`content://`).
- **Errori Telegram tradotti** in messaggi comprensibili (token non valido, chat non trovata,
  bot senza permessi, file > 50 MB) e retry automatico sui 429 con `retry_after`.
- **Stato di sincronizzazione salvato dopo ogni file**: se un invio si interrompe non si perde il
  lavoro fatto e non si rimanda nulla al giro successivo.
- **Stato spostato in un file JSON** nella cartella privata dell'app (prima era un JSON grande in
  `SecureStore`, che non è pensato per dati riscritti di continuo).
- **Task in background definito all'avvio** (`src/backgroundTasks.ts`, importato da `index.js`),
  così esiste anche quando Android avvia l'app solo per il backup.
- **Recupero del controllo mancato**: se l'orario è passato e Android non ha svegliato l'app, il
  controllo parte all'apertura o al ritorno in primo piano (e ogni minuto se l'app è aperta).
- **Nessun doppio invio**: un solo controllo per volta, con lock in `folderSync.ts`.
- **Cartella non più accessibile** segnalata in chiaro ("permesso scaduto: riselezionala") invece
  di un errore generico.
- **File vuoti o ancora in scrittura** saltati e ritentati, **file oltre 50 MB** segnalati.
- **Batch limitato** (20 file / 8 minuti per risveglio) così il task termina sempre.

### Aggiunto

- **"made by zorawar"** in fondo alla schermata.
- Scheda **Diagnostica**: task registrato, giorno coperto, esito ed errore dell'ultimo tentativo,
  file in memoria, pulsante per azzerare la memoria degli invii.
- **Verifica bot e chat** (ora chiama `getMe` *e* `getChat`, così distingue token da Chat ID) e
  **Messaggio di prova**.
- Riga di stato della cartella: permesso, numero di file, ultimo controllo (manuale/automatico/
  all'apertura), prossimo controllo previsto.
- Permesso `RECEIVE_BOOT_COMPLETED` per far ripartire i controlli dopo il riavvio.

### Rimosso

- `expo-router` (app a schermata singola), `@tanstack/react-query`,
  `react-native-gesture-handler`, `react-native-keyboard-controller`, `expo-location`,
  `expo-image`, `expo-image-picker`, `expo-symbols`, `expo-web-browser`, `expo-blur`,
  `expo-glass-effect`, `expo-linear-gradient`, `@react-native-async-storage/async-storage`.
  Meno dipendenze native = build più rapida e meno punti di rottura.
- Tutto lo scaffolding Replit inutilizzato (server Express, Drizzle, OpenAPI/Orval, mockup sandbox).
- Workflow GitHub che non poteva funzionare (`./gradlew assembleDebug` senza cartella `android/`).
