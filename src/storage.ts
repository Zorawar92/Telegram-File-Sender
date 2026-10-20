import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';

/**
 * Credenziali Telegram: restano nella secure storage del telefono.
 * Lo stato dell'automazione (elenco file già inviati, orari, errori) è un file
 * JSON nella cartella privata dell'app: è più grande di quanto sia sicuro
 * tenere in SecureStore e deve essere riscritto spesso.
 */

const TOKEN_KEY = 'telegram-file-sender.bot-token';
const CHAT_ID_KEY = 'telegram-file-sender.chat-id';

export const SENT_STATE_FILE = new File(Paths.document, 'folder-state.json');

export type ScanTrigger = 'manual' | 'background' | 'foreground';

export type FolderState = {
  enabled: boolean;
  directoryUri: string;
  directoryName: string;
  scheduleHour: number;
  scheduleMinute: number;
  /** fingerprint -> timestamp (ms) dell'invio riuscito */
  sent: Record<string, number>;
  lastScanAt?: string;
  lastScanTrigger?: ScanTrigger;
  lastUploadedCount?: number;
  lastError?: string;
  lastErrorAt?: string;
  /** giorno (YYYY-MM-DD) in cui il controllo giornaliero è già stato fatto */
  lastScheduledDateKey?: string;
  lastBackgroundRunAt?: string;
  lastBackgroundResult?: string;
};

export function emptyState(): FolderState {
  return {
    enabled: false,
    directoryUri: '',
    directoryName: '',
    scheduleHour: 3,
    scheduleMinute: 0,
    sent: {},
  };
}

export async function readSecret(key: string): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(key)) ?? null;
  } catch {
    return null;
  }
}

export async function writeSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function loadCredentials(): Promise<{ botToken: string; chatId: string }> {
  const [botToken, chatId] = await Promise.all([
    readSecret(TOKEN_KEY),
    readSecret(CHAT_ID_KEY),
  ]);
  return { botToken: (botToken ?? '').trim(), chatId: (chatId ?? '').trim() };
}

export async function saveCredentials(botToken: string, chatId: string): Promise<void> {
  await Promise.all([
    writeSecret(TOKEN_KEY, botToken.trim()),
    writeSecret(CHAT_ID_KEY, chatId.trim()),
  ]);
}

export function loadState(): FolderState {
  try {
    if (!SENT_STATE_FILE.exists) return emptyState();
    const raw = SENT_STATE_FILE.textSync();
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<FolderState>;
    return { ...emptyState(), ...parsed, sent: parsed.sent ?? {} };
  } catch {
    return emptyState();
  }
}

export function saveState(state: FolderState): void {
  try {
    if (!SENT_STATE_FILE.exists) {
      SENT_STATE_FILE.create({ intermediates: true });
    }
    SENT_STATE_FILE.write(JSON.stringify(state));
  } catch {
    // Se il file di stato non è scrivibile non blocchiamo l'invio dei file:
    // al massimo il prossimo controllo rimanda qualcosa.
  }
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function formatScheduleTime(hour = 3, minute = 0): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseScheduleTime(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** true se l'orario giornaliero è passato e il controllo di oggi non è ancora stato fatto */
export function isDailyRunDue(state: FolderState, now: Date = new Date()): boolean {
  if (!state.enabled || !state.directoryUri) return false;
  const scheduleMinutes = state.scheduleHour * 60 + state.scheduleMinute;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < scheduleMinutes) return false;
  return state.lastScheduledDateKey !== localDateKey(now);
}
