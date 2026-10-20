# Changelog

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
- **`npm run typecheck`** non si perde più nei progetti Replit inutilizzati (`artifacts/`,
  `lib/`, `scripts/` esclusi dal `tsconfig`).

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
