import { File, UploadType } from 'expo-file-system';

/** Limite del Bot API di Telegram per sendDocument (50 MB). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export class TelegramError extends Error {
  code?: number;
  description: string;
  retryAfter?: number;

  constructor(message: string, code?: number, description?: string, retryAfter?: number) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
    this.description = description ?? message;
    this.retryAfter = retryAfter;
  }
}

type TelegramApiResponse = {
  ok?: boolean;
  result?: any;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

function humanMessage(code: number | undefined, description: string): string {
  const d = description.toLowerCase();

  if (code === 401 || d.includes('unauthorized')) {
    return 'Token del bot non valido. Ricontrolla il token di @BotFather.';
  }
  if (d.includes('chat not found')) {
    return 'Chat non trovata: il Chat ID non esiste o il bot non ha mai ricevuto un messaggio in quella chat. Apri il bot, premi Start e riprova.';
  }
  if (d.includes('not enough rights') || d.includes('have no rights') || d.includes('chat_write_forbidden')) {
    return 'Il bot non ha il permesso di scrivere in quella chat. Se è un canale/gruppo, aggiungilo come amministratore.';
  }
  if (d.includes('bot was blocked')) {
    return 'Il bot è stato bloccato da questo account: sbloccalo da Telegram e riprova.';
  }
  if (d.includes('bot was kicked')) {
    return 'Il bot è stato rimosso da quella chat.';
  }
  if (d.includes('user is deactivated')) {
    return 'Questo account Telegram risulta disattivato.';
  }
  if (code === 413 || d.includes('too large') || d.includes('entity too large')) {
    return 'File troppo grande: il Bot API di Telegram accetta al massimo 50 MB per file.';
  }
  if (code === 429) {
    return 'Telegram sta limitando le richieste (troppi invii ravvicinati). Riprova tra poco.';
  }
  if (code === 400 && d.includes('wrong file identifier')) {
    return 'Telegram ha rifiutato il file: il contenuto non è più leggibile dalla cartella scelta.';
  }
  if (code && code >= 500) {
    return `Telegram ha risposto con un errore temporaneo (${code}). Riprova tra poco.`;
  }
  return description || `Errore Telegram${code ? ` (${code})` : ''}.`;
}

export function buildErrorFrom(
  status: number | undefined,
  payload: TelegramApiResponse | null,
  fallback: string,
): TelegramError {
  const code = payload?.error_code ?? status;
  const description = payload?.description ?? fallback;
  return new TelegramError(
    humanMessage(code, description),
    code,
    description,
    payload?.parameters?.retry_after,
  );
}

type ApiParams = Record<string, string | number | boolean>;

async function callApi(
  botToken: string,
  method: string,
  params: ApiParams = {},
): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken.trim()}/${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new TelegramError(
      'Impossibile raggiungere Telegram: controlla la connessione a internet.',
    );
  }

  let payload: TelegramApiResponse | null = null;
  try {
    payload = (await response.json()) as TelegramApiResponse;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    throw buildErrorFrom(response.status, payload, `HTTP ${response.status}`);
  }
  return payload.result;
}

export type BotInfo = { username?: string; first_name?: string; id?: number };
export type ChatInfo = { id?: number; title?: string; username?: string; type?: string; first_name?: string };

export function getMe(botToken: string): Promise<BotInfo> {
  return callApi(botToken, 'getMe');
}

export function getChat(botToken: string, chatId: string): Promise<ChatInfo> {
  return callApi(botToken, 'getChat', { chat_id: chatId });
}

export function sendTestMessage(botToken: string, chatId: string): Promise<any> {
  return callApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: '✅ Telegram File Sender è collegato correttamente a questa chat.',
    disable_notification: true,
  });
}

async function getFileSize(uri: string, fallback?: number): Promise<number> {
  if (typeof fallback === 'number' && fallback > 0) return fallback;
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

export type SendDocumentOptions = {
  botToken: string;
  chatId: string;
  uri: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  onProgress?: (progress: number) => void;
};

/**
 * Invia un file a Telegram usando l'upload nativo di expo-file-system.
 * Funziona con uri `file://` (file scelti dal picker) e `content://`
 * (file delle cartelle scelte con il selettore Android / SAF).
 */
export async function sendDocument(options: SendDocumentOptions): Promise<void> {
  const { botToken, chatId, uri, fileName, mimeType } = options;
  const token = botToken.trim();

  if (!token || !chatId.trim()) {
    throw new TelegramError('Inserisci prima il token del bot e il Chat ID.');
  }

  const size = await getFileSize(uri, options.size);
  if (size > MAX_DOCUMENT_BYTES) {
    throw new TelegramError(
      `"${fileName}" pesa ${(size / (1024 * 1024)).toFixed(1)} MB: il limite del Bot API di Telegram è 50 MB.`,
    );
  }

  // Ogni tentativo ricrea la sessione di upload: dopo un 429 o un timeout
  // il file va riaperto da zero.
  const maxAttempts = 3;
  let lastError: TelegramError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let status = 0;
    let body = '';

    try {
      const file = new File(uri);
      if (!file.exists) {
        throw new TelegramError(
          `"${fileName}" non è più accessibile. Controlla che esista ancora nella cartella scelta.`,
        );
      }

      const result = await file.upload(`https://api.telegram.org/bot${token}/sendDocument`, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'document',
        mimeType: mimeType || file.type || 'application/octet-stream',
        parameters: { chat_id: chatId.trim() },
        onProgress: ({ bytesSent, totalBytes }) => {
          if (options.onProgress && totalBytes > 0) {
            options.onProgress(Math.min(1, bytesSent / totalBytes));
          }
        },
      });

      status = result.status;
      body = result.body;
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      lastError = new TelegramError(
        `Impossibile inviare "${fileName}": ${error instanceof Error ? error.message : 'errore di rete'}`,
      );
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        continue;
      }
      throw lastError;
    }

    let payload: TelegramApiResponse | null = null;
    try {
      payload = JSON.parse(body) as TelegramApiResponse;
    } catch {
      payload = null;
    }

    if (status >= 200 && status < 300 && payload?.ok) {
      options.onProgress?.(1);
      return;
    }

    const error = buildErrorFrom(status, payload, `Telegram ha risposto HTTP ${status}`);
    lastError = error;

    const retryable = error.code === 429 || (error.code ?? 0) >= 500;
    if (retryable && attempt < maxAttempts) {
      const waitSeconds = Math.min(30, error.retryAfter ?? attempt * 3);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }
    throw error;
  }

  throw lastError ?? new TelegramError('Invio non riuscito.');
}
