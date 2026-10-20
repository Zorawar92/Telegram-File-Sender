# Telegram File Sender — Android (arm64-v8a)

App Android **personale** (Expo / React Native, SDK 57) che invia qualsiasi file del telefono a un
bot di Telegram e che, ogni giorno all'orario scelto, controlla una cartella e manda **solo i file
nuovi**.

Nessun server in mezzo: i file vanno dal telefono direttamente a `api.telegram.org`, e token +
Chat ID restano nella memoria protetta del dispositivo.

> Questa versione riparte dal progetto originale [`Zorawar92/Telegram-File-Sender`](https://github.com/Zorawar92/Telegram-File-Sender)
> riscrivendo la parte di invio e il backup automatico, che non funzionavano.
> Dettaglio delle modifiche: **[CHANGELOG.md](CHANGELOG.md)** · Guida per l'uso: **[GUIDA.md](GUIDA.md)**

---

## Cosa è stato corretto (in breve)

| Problema segnalato | Causa | Soluzione |
|---|---|---|
| "Scan manuale" e file della cartella mai inviati, errore tipo *non si connette al bot* | il `File` di `expo-file-system` veniva passato a `FormData` come se fosse un blob: React Native accetta solo `{ uri, name, type }`, quindi la richiesta partiva senza allegato | invio riscritto con l'upload **nativo** `File.upload(...)` (multipart, `chat_id`, progresso, risposta JSON letta) |
| Backup automatico che non parte | stato salvato solo a fine scansione, task definito dentro la schermata, nessun recupero se Android saltava il risveglio | stato salvato **dopo ogni file**, task definito in `index.js`, recupero all'apertura dell'app e ogni minuto in primo piano |
| File singoli ok ma `getMe` inutile per capire l'errore | la verifica controllava solo il token | **Verifica bot e chat** (`getMe` + `getChat`) e **Messaggio di prova** |
| Nessuna visibilità su cosa succede | nessun log/errore salvato | scheda **Diagnostica** con esito, errori, file in memoria e reset |

Altre correzioni: limite 50 MB controllato prima dell'invio, retry sui `429` con `retry_after`,
un solo controllo per volta (niente doppi invii), messaggi d'errore in italiano, permesso cartella
scaduto segnalato chiaramente, `expo-router` e altre 12 dipendenze inutili rimosse, workflow GitHub
per l'APK riscritto (quello originale eseguiva `./gradlew` senza cartella `android/` e non poteva
funzionare).

---

## Requisiti

- **Telefono Android arm64** (qualsiasi Android 8+; l'APK contiene solo `arm64-v8a`)
- Per compilare: **Node 20+**, **JDK 17**, **Android SDK 36** (platform + build-tools)

## Compilare l'APK

```bash
npm install

# la cartella android/ è già nel repo; se modifichi app.json rigenerala con:
# npx expo prebuild --platform android --clean

cd android
chmod +x gradlew
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Risultato: `android/app/build/outputs/apk/release/app-release.apk` (≈ 32 MB, JS incluso: si installa
e funziona senza Metro).

> La cartella `node_modules/` **non** è nel repo (come sempre): dopo il clone serve `npm install`.
> Se Gradle non trova l'SDK, esporta `ANDROID_HOME` oppure crea `android/local.properties` con
> `sdk.dir=/percorso/Android/Sdk` (file ignorato da git).

Comandi di comodo:

```bash
npm run typecheck   # controllo dei tipi TypeScript
npm run build:apk   # build release arm64-v8a
```

L'APK è firmato con la **keystore di debug** generata da Expo: va benissimo per uso personale
(Android chiederà di autorizzare l'installazione da origini sconosciute). Per pubblicarla sul Play
Store serve una keystore di release propria.

### Build automatica con GitHub Actions

`.github/workflows/build-apk.yml`: parte a mano (*Actions → Run workflow*) o con un tag `v*`, compila
l'APK arm64-v8a e lo allega alla release.

## Installare l'APK sul telefono

1. Copia `app-release.apk` sul telefono (cavo, Google Drive, Telegram stesso…).
2. Aprilo dal file manager → *Installa* → concedi "Installa app sconosciute" al file manager.
3. Al primo avvio: **concedi l'uso illimitato della batteria** se compare l'avviso in app
   (serve al backup automatico).

## Come si usa

Guida completa passo per passo: **[GUIDA.md](GUIDA.md)**. In sintesi:

1. Crea un bot con **@BotFather**, prendi il token.
2. Manda un messaggio al bot, recupera il **Chat ID** (es. con @userinfobot).
3. Nell'app: incolla token e Chat ID → **Verifica bot e chat**.
4. **Scegli un file** → **Invia file**.
5. Per il backup automatico: **Scegli la cartella** → **Scan ora** → imposta l'ora → attiva
   l'interruttore.

---

## Struttura del progetto

```
index.js                     registra l'app e definisce il task in background (anche in headless)
App.tsx                      schermata unica: stato, azioni, diagnostica, footer "made by zorawar"
src/telegram.ts              Bot API: getMe/getChat/sendMessage + upload multipart con retry
src/folderSync.ts            scansione cartella, deduplica, salvataggio stato dopo ogni file
src/backgroundTasks.ts       task WorkManager + registrazione/rimozione
src/storage.ts               SecureStore (token, Chat ID) e file di stato JSON
src/IncomingShareBridge.tsx  ricezione file dal menu "Condividi" di Android
src/styles.ts                stili della schermata
src/colors.ts, useColors.ts  palette chiaro/scuro
assets/images/               icone dell'app
android/                     progetto nativo generato da `expo prebuild` (versionato)
```

### Come funziona l'invio

```ts
await new File(uri).upload(`https://api.telegram.org/bot${token}/sendDocument`, {
  uploadType: UploadType.MULTIPART,          // multipart/form-data
  fieldName: 'document',
  parameters: { chat_id: chatId },
  mimeType,
  onProgress: ({ bytesSent, totalBytes }) => …,   // barra di avanzamento reale
});
```

Funziona con `file://` (document picker) **e** `content://` (cartelle scelte con il selettore SAF),
cosa che `FormData` + `XMLHttpRequest` non garantiva. La risposta viene letta anche in caso di
errore HTTP, così l'app può dire *perché* Telegram ha rifiutato il file.

### Come funziona il backup automatico

1. `expo-background-task` (WorkManager) sveglia l'app circa ogni **15 minuti**.
2. Il task esegue l'invio **solo se** il backup è attivo, l'orario giornaliero è passato e il giorno
   non è già stato coperto.
3. Lo stesso controllo viene eseguito **all'apertura dell'app**, al ritorno in primo piano e ogni
   minuto mentre l'app è aperta: se Android ha saltato il risveglio, l'app recupera.
4. Ogni file inviato viene registrato subito (`uri|dimensione|data`), quindi i file nuovi partono
   una sola volta e i file già inviati non vengono rimandati.

## Limiti noti

- **50 MB per file**: limite del Bot API di Telegram (non aggirabile lato app).
- Android **non garantisce l'ora esatta** dei task in background: l'orario è un obiettivo, non una
  sveglia; per questo esiste il recupero all'apertura. Su Xiaomi/Huawei/Oppo/Vivo conviene togliere
  l'app dall'ottimizzazione batteria (vedi [GUIDA.md](GUIDA.md)).
- Vengono controllati i file al **primo livello** della cartella scelta (non le sottocartelle).
- L'APK contiene solo la libreria **arm64-v8a** (tutti gli smartphone Android recenti). Per un
  dispositivo armv7/x86 aggiungi l'architettura con `-PreactNativeArchitectures=...`.

## Privacy

- Token e Chat ID stanno in `expo-secure-store` (Android Keystore), mai nel codice né su server.
- L'elenco dei file inviati è un JSON privato nella cartella dell'app.
- Nessuna analytics, nessun servizio di terze parti: solo `https://api.telegram.org`.
