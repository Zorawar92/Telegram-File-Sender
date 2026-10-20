import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * Modulo nativo della sveglia del backup (solo Android).
 *
 * WorkManager da solo non garantisce l'ora: la sveglia di sistema
 * (`AlarmManager.setAlarmClock`) sveglia il telefono all'orario scelto, anche con
 * l'app chiusa e in risparmio energetico, e avvia un foreground service che esegue
 * il controllo della cartella.
 */

export type AlarmInfo = {
  /** backup automatico attivo (interruttore) */
  enabled: boolean;
  hour: number;
  minute: number;
  /** c'è una sveglia già armata per il futuro */
  scheduled: boolean;
  /** timestamp (ms) del prossimo risveglio, null se non programmata */
  nextTriggerAt: number | null;
  /** la sveglia è esatta (permesso concesso) o approssimativa */
  exact: boolean;
  /** è una sveglia "da orologio" (`setAlarmClock`): il sistema non la sposta */
  alarmClock: boolean;
  /** Android 12+: permesso "Allarmi e promemoria" concesso */
  canScheduleExact: boolean;
  /** l'app è ancora soggetta all'ottimizzazione batteria */
  batteryOptimized: boolean;
  /** bucket di standby dell'app: attiva / frequente / rara / limitata / mai … */
  standbyBucket: string;
  /** timestamp (ms) della sveglia di prova, se impostata */
  testScheduledAt: number | null;
  lastFiredAt: number | null;
  lastSource: string | null;
  lastRunAt: number | null;
  lastRunResult: string | null;
};

type AlarmBackupNativeModule = {
  scheduleDaily(hour: number, minute: number): AlarmInfo;
  cancel(): AlarmInfo;
  scheduleTestAlarm(minutes: number): AlarmInfo;
  runNow(): boolean;
  openAppSettings(): boolean;
  getAlarmInfo(): AlarmInfo;
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): boolean;
};

const nativeModule =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<AlarmBackupNativeModule>('AlarmBackup')
    : null;

/** false in Expo Go, sul web o se il modulo nativo non è nella build. */
export const isAlarmBackupAvailable = nativeModule != null;

function safely<T>(action: () => T): T | null {
  try {
    return action();
  } catch (error) {
    console.warn('[alarm-backup]', error);
    return null;
  }
}

/** Programma la sveglia tutti i giorni alle ore/minuti indicati. */
export function scheduleDailyAlarm(hour: number, minute: number): AlarmInfo | null {
  if (!nativeModule) return null;
  return safely(() => nativeModule.scheduleDaily(hour, minute));
}

/** Spegne la sveglia (backup automatico disattivato). */
export function cancelDailyAlarm(): AlarmInfo | null {
  if (!nativeModule) return null;
  return safely(() => nativeModule.cancel());
}

/**
 * Sveglia di prova tra `minutes` minuti: verifica subito che il telefono svegli
 * davvero l'app, senza aspettare l'orario impostato (utile dopo un riavvio o su
 * un telefono che rimanda i lavori in background).
 */
export function scheduleTestAlarm(minutes = 1): AlarmInfo | null {
  if (!nativeModule) return null;
  return safely(() => nativeModule.scheduleTestAlarm(minutes));
}

/** Apre la scheda dell'app nelle impostazioni di Android (batteria, sospensione). */
export function openAppSettings(): boolean {
  if (!nativeModule) return false;
  return safely(() => nativeModule.openAppSettings()) ?? false;
}

/** Esegue il backup adesso, passando dallo stesso servizio della sveglia. */
export function runBackupNow(): boolean {
  if (!nativeModule) return false;
  return safely(() => nativeModule.runNow()) ?? false;
}

/** Stato della sveglia, dei permessi e dell'ultimo risveglio. */
export function getAlarmInfo(): AlarmInfo | null {
  if (!nativeModule) return null;
  return safely(() => nativeModule.getAlarmInfo());
}

export function canScheduleExactAlarms(): boolean {
  if (!nativeModule) return false;
  return safely(() => nativeModule.canScheduleExactAlarms()) ?? false;
}

/** Apre Impostazioni → Allarmi e promemoria (Android 12+). */
export function openExactAlarmSettings(): boolean {
  if (!nativeModule) return false;
  return safely(() => nativeModule.openExactAlarmSettings()) ?? false;
}
