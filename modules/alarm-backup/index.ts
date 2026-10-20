import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * Modulo nativo della sveglia del backup (solo Android).
 *
 * WorkManager da solo non garantisce l'ora: la sveglia di sistema
 * (`AlarmManager.setExactAndAllowWhileIdle`) sveglia il telefono all'orario scelto,
 * anche in Doze, e fa partire il controllo della cartella.
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
  /** Android 12+: permesso "Allarmi e promemoria" concesso */
  canScheduleExact: boolean;
  lastFiredAt: number | null;
  lastSource: string | null;
  lastRunAt: number | null;
  lastRunResult: string | null;
};

type AlarmBackupNativeModule = {
  scheduleDaily(hour: number, minute: number): AlarmInfo;
  cancel(): AlarmInfo;
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
