# Changelog

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
