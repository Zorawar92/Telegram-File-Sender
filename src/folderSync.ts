import { Directory, File } from 'expo-file-system';

import {
  FolderState,
  ScanTrigger,
  loadCredentials,
  loadState,
  localDateKey,
  saveState,
} from './storage';
import { MAX_DOCUMENT_BYTES, TelegramError, sendDocument } from './telegram';

export type SyncProgress = {
  current: number;
  total: number;
  fileName?: string;
  sent: number;
};

export type SyncResult = {
  uploaded: number;
  skipped: number;
  total: number;
  failures: { fileName: string; message: string }[];
  stoppedEarly: boolean;
  fatalError?: string;
};

export type SyncOptions = {
  trigger: ScanTrigger;
  maxFiles?: number;
  maxDurationMs?: number;
  onProgress?: (info: SyncProgress) => void;
  /** Segna il controllo giornaliero come eseguito (usato dal task in background) */
  markScheduledDay?: boolean;
};

const SENT_HISTORY_LIMIT = 1500;

/**
 * Un solo controllo per volta: il task in background, il recupero all'apertura
 * e il pulsante "Scan ora" non devono mai girare in parallelo, altrimenti lo
 * stesso file potrebbe partire due volte.
 */
let syncInProgress = false;

function fingerprint(file: File): string {
  return `${file.uri}|${file.size ?? 0}|${file.lastModified ?? 0}`;
}

/** Gli errori che non ha senso ripetere per ogni file: fermano subito il ciclo. */
function isFatal(error: unknown): boolean {
  if (!(error instanceof TelegramError)) return false;
  return error.code === 401 || error.code === 403 || error.code === 400;
}

function pruneSent(sent: Record<string, number>): Record<string, number> {
  const entries = Object.entries(sent);
  if (entries.length <= SENT_HISTORY_LIMIT) return sent;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, SENT_HISTORY_LIMIT));
}

export function readFolderFiles(directoryUri: string): { files: File[]; folders: number } {
  if (!directoryUri) {
    throw new Error('Scegli prima una cartella da controllare.');
  }
  const directory = new Directory(directoryUri);

  if (!directory.exists) {
    throw new Error(
      'La cartella non è più accessibile: il permesso Android è scaduto. Tocca «Scegli cartella» e selezionala di nuovo.',
    );
  }

  let entries;
  try {
    entries = directory.list();
  } catch {
    throw new Error(
      'Android non permette di leggere la cartella. Selezionala di nuovo con «Scegli cartella».',
    );
  }

  const files: File[] = [];
  let folders = 0;
  for (const entry of entries) {
    if (entry instanceof File) {
      files.push(entry);
    } else {
      folders += 1;
    }
  }

  files.sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0));
  return { files, folders };
}

/**
 * Controlla la cartella e invia solo i file che non sono mai stati inviati
 * (impronta = uri + dimensione + data di modifica).
 * Lo stato viene salvato DOPO OGNI file: se l'invio si interrompe, i file già
 * arrivati non vengono rimandati al controllo successivo.
 */
export async function runFolderSync(options: SyncOptions): Promise<SyncResult> {
  if (syncInProgress) {
    throw new Error('Un controllo della cartella è già in corso: attendi che finisca.');
  }
  syncInProgress = true;
  try {
    return await runFolderSyncInternal(options);
  } finally {
    syncInProgress = false;
  }
}

async function runFolderSyncInternal(options: SyncOptions): Promise<SyncResult> {
  const { trigger } = options;
  const maxFiles = options.maxFiles ?? 20;
  const maxDurationMs = options.maxDurationMs ?? 8 * 60 * 1000;
  const startedAt = Date.now();

  const state = loadState();
  const { botToken, chatId } = await loadCredentials();

  if (!state.directoryUri) {
    throw new Error('Scegli prima una cartella da controllare.');
  }
  if (!botToken || !chatId) {
    throw new Error('Inserisci il token del bot e il Chat ID prima di controllare la cartella.');
  }

  const { files } = readFolderFiles(state.directoryUri);

  const result: SyncResult = {
    uploaded: 0,
    skipped: 0,
    total: files.length,
    failures: [],
    stoppedEarly: false,
  };

  const sent = { ...state.sent };
  let processed = 0;

  const persist = (extra: Partial<FolderState> = {}) => {
    saveState({
      ...state,
      sent: pruneSent(sent),
      lastScanAt: new Date().toISOString(),
      lastScanTrigger: trigger,
      lastUploadedCount: result.uploaded,
      ...extra,
    });
  };

  for (const file of files) {
    if (processed >= maxFiles || Date.now() - startedAt > maxDurationMs) {
      result.stoppedEarly = true;
      break;
    }

    const key = fingerprint(file);
    if (sent[key]) {
      result.skipped += 1;
      continue;
    }

    const name = file.name || 'file';
    const size = file.size ?? 0;

    // File ancora in scrittura (o non leggibile): lo riproveremo al prossimo giro.
    if (size <= 0) {
      result.failures.push({ fileName: name, message: 'File vuoto o ancora in scrittura: riprovo al prossimo controllo.' });
      continue;
    }

    if (size > MAX_DOCUMENT_BYTES) {
      // Lo marchiamo come gestito per non riprovare all'infinito lo stesso file.
      sent[key] = Date.now();
      result.failures.push({
        fileName: name,
        message: `Troppo grande (${(size / (1024 * 1024)).toFixed(1)} MB): il Bot API di Telegram accetta max 50 MB.`,
      });
      persist();
      continue;
    }

    processed += 1;
    options.onProgress?.({ current: processed, total: files.length, fileName: name, sent: result.uploaded });

    try {
      await sendDocument({
        botToken,
        chatId,
        uri: file.uri,
        fileName: name,
        mimeType: file.type || undefined,
        size,
      });
      sent[key] = Date.now();
      result.uploaded += 1;
      persist();
      options.onProgress?.({ current: processed, total: files.length, fileName: name, sent: result.uploaded });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore sconosciuto';
      result.failures.push({ fileName: name, message });
      if (isFatal(error)) {
        result.fatalError = message;
        result.stoppedEarly = true;
        persist({ lastError: message, lastErrorAt: new Date().toISOString() });
        break;
      }
    }
  }

  if (options.markScheduledDay) {
    persist({
      lastScheduledDateKey: localDateKey(new Date()),
      lastBackgroundRunAt: new Date().toISOString(),
      lastBackgroundResult: result.failures.length
        ? `${result.uploaded} inviati, ${result.failures.length} errori`
        : `${result.uploaded} inviati`,
    });
  } else {
    persist({
      lastError: result.failures.length ? result.failures[0].message : undefined,
      lastErrorAt: result.failures.length ? new Date().toISOString() : undefined,
    });
  }

  return result;
}
