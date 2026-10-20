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
| Backup automatico che non parte | stato salvato solo a fine scansione, task definito dentro la schermata, nessun recupero se Android saltava il risveglio; e soprattutto WorkManager, che non garantisce l'ora | stato salvato **dopo ogni file**, task definito in `index.js`, **sveglia di sistema `AlarmManager`** all'orario scelto (parte anche a telefono fermo), riprogrammazione dopo il riavvio, recupero all'apertura e ogni minuto in primo piano |
| File singoli ok ma `getMe` inutile per capire l'errore | la verifica controllava solo il token | **Verifica bot e chat** (`getMe` + `getChat`) e **Messaggio di prova** |
| Nessuna visibilità su cosa succede | nessun log/errore salvato | scheda **Diagnostica** con esito, errori, file in memoria e reset |

Il repository contiene **solo l'app** (`App.tsx`, `src/`, `modules/alarm-backup`, `android/`,
`assets/`): lo scaffolding Replit (server Express, Drizzle, OpenAPI, mockup sandbox) e lo zip dei
sorgenti sono stati rimossi nella 1.3.0.

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

### Permessi

| Permesso | Perché |
|---|---|
| `USE_EXACT_ALARM` (13+) / `SCHEDULE_EXACT_ALARM` (12–12L) | sveglia all'ora esatta; è l'unico "speciale" e su Android 13+ è concesso all'installazione |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC` | eseguire il backup dal servizio avviato dalla sveglia |
| `RECEIVE_BOOT_COMPLETED` | ricreare la sveglia dopo un riavvio |
| `WAKE_LOCK` | tenere sveglio il telefono durante l'invio |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | aprire la schermata per togliere l'ottimizzazione (opzionale) |

> `USE_EXACT_ALARM` è un permesso "ristretto" per il Play Store (riservato a sveglie/calendari):
> qui va benissimo perché l'APK si installa a mano. Se un giorno pubblicassi l'app sul Play Store,
> tieni solo `SCHEDULE_EXACT_ALARM` e lascia che sia l'utente a concederlo.

### Build automatica con GitHub Actions

`.github/workflows/build-apk.yml`: parte a mano (*Actions → Run workflow*), a ogni push su `main`
o con un tag `v*` / `V*`, compila l'APK arm64-v8a e — se il push è un tag — lo allega alla
release. Le release finora usano la `V` maiuscola (`V1.0`, `V1.1`, `V1.2`, `V1.3`).

## Installare l'APK sul telefono

1. Copia `app-release.apk` sul telefono (cavo, Google Drive, Telegram stesso…).
2. Aprilo dal file manager → *Installa* → concedi "Installa app sconosciute" al file manager.
3. Al primo avvio: se compare la scheda **«Consenti la sveglia esatta»** toccala e attiva
   *Allarmi e promemoria* (serve al backup automatico puntuale); se compare la scheda
   **«Consenti i controlli in background»** concedi l'uso illimitato della batteria.

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
src/alarm.ts                 ponte JS della sveglia di sistema (stato, permessi, formattazione)
modules/alarm-backup/        modulo nativo: sveglia AlarmManager, foreground service, receiver
src/storage.ts               SecureStore (token, Chat ID) e file di stato JSON
src/IncomingShareBridge.tsx  ricezione file dal menu "Condividi" di Android
src/styles.ts                stili della schermata
src/colors.ts, useColors.ts  palette chiaro/scuro
assets/images/               icone dell'app
android/                     progetto nativo generato da `expo prebuild` (versionato)
```

> `package.json` contiene `expo.autolinking.buildFromSource: ["expo-background-task"]`:
> il modulo della sveglia riusa `BackgroundTaskScheduler` di `expo-background-task`, quindi quel
> pacchetto deve essere compilato dai sorgenti (non dall'AAR precompilato). Se un giorno cambi
> SDK, lascia quella voce.

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

### Perché una sveglia di sistema e non solo WorkManager

`expo-background-task` (e quindi WorkManager) è pensato per lavori *best effort*: il sistema
può rimandarli di ore e, con l'app chiusa, alcuni produttori (Samsung in primis) li bloccano
del tutto finché non usi il telefono. Per un backup "ogni giorno alle 21" servono invece tre
garanzie che solo `AlarmManager` offre:

- **ora precisa**: `setAlarmClock` (l'API delle sveglie della sveglia dell'orologio) non viene
  spostata dal sistema ed esce dal risparmio energetico per essere consegnata;
- **visibilità**: l'icona della sveglia nella barra di stato dice che è armata;
- **un foreground service avviabile da background**: l'allarme può avviare un servizio
  (`dataSync`) anche con l'app chiusa, cosa che un normale lavoro in background non può fare
  su Android 12+. Il servizio tiene un wakelock e resta vivo finché il controllo non è finito,
  invece di sperare che WorkManager decida di eseguirlo.

Il task periodico di `expo-background-task` resta come rete di sicurezza, ma non è più l'unica
speranza che il backup parta.

### Come funziona il backup automatico

1. **Sveglia di sistema** (`modules/alarm-backup`): all'orario scelto
   `AlarmManager.setAlarmClock` sveglia il telefono — anche in Doze, anche con l'app chiusa.
   Il permesso `USE_EXACT_ALARM` (Android 13+) è concesso all'installazione, quindi la sveglia
   non dipende da un'autorizzazione da attivare a mano; senza permesso l'app ripiega su una
   sveglia approssimativa e lo dice nella Diagnostica.
2. Il receiver dell'allarme avvia **direttamente** un foreground service `dataSync`
   (`BackupRunService`): prende un wakelock, avvia l'app in **headless** ed esegue il task JS
   registrato con `expo-background-task`. Così il lavoro parte subito, senza aspettare che
   WorkManager decida di eseguirlo. Se il servizio non è avviabile (o il controllo fallisce)
   subentra WorkManager come ripiego.
3. Subito dopo il risveglio la sveglia viene riprogrammata per il **giorno successivo**, e viene
   armato un **controllo di recupero due ore dopo** (se il primo risveglio è andato perso, il
   secondo recupera il giro; se il backup è già stato fatto non fa nulla). Dopo un riavvio, un
   aggiornamento o la concessione del permesso la sveglia viene ricreata da un receiver.
4. Il task esegue l'invio **solo se** il backup è attivo, l'orario giornaliero è passato e il
   giorno non è già stato coperto.
5. Restano attive due reti di sicurezza: `expo-background-task` (WorkManager, ~ogni 15 minuti) e
   il controllo **all'apertura dell'app**, al ritorno in primo piano e ogni minuto mentre l'app è
   aperta.
6. Ogni file inviato viene registrato subito (`uri|dimensione|data`), quindi i file nuovi partono
   una sola volta e i file già inviati non vengono rimandati.

## Limiti noti

- **50 MB per file**: limite del Bot API di Telegram (non aggirabile lato app).
- **Samsung (One UI)**: se l'app finisce tra quelle «in sospensione» o con batteria limitata,
  il telefono può spegnere le sveglie. Vanno tolte entrambe le limitazioni (la Diagnostica mostra
  il bucket di standby e l'app fa comparire una scheda con le istruzioni). Vale lo stesso per
  Xiaomi/Huawei/Oppo/Vivo con l'«avvio automatico».
- Con l'**ottimizzazione batteria** attiva il produttore può comunque ritardare il risveglio: per
  questo esistono il controllo di recupero due ore dopo, il task WorkManager e il recupero
  all'apertura dell'app.
- Un **arresto forzato** dalle impostazioni Android cancella le sveglie: tornano alla prossima
  apertura dell'app o al riavvio del telefono.
- Vengono controllati i file al **primo livello** della cartella scelta (non le sottocartelle).
- L'APK contiene solo la libreria **arm64-v8a** (tutti gli smartphone Android recenti). Per un
  dispositivo armv7/x86 aggiungi l'architettura con `-PreactNativeArchitectures=...`.

## Privacy

- Token e Chat ID stanno in `expo-secure-store` (Android Keystore), mai nel codice né su server.
- L'elenco dei file inviati è un JSON privato nella cartella dell'app.
- Nessuna analytics, nessun servizio di terze parti: solo `https://api.telegram.org`.
