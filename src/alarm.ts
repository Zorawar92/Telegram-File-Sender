import {
  AlarmInfo,
  cancelDailyAlarm,
  getAlarmInfo,
  scheduleDailyAlarm,
} from '../modules/alarm-backup';
import { FolderState } from './storage';

export type { AlarmInfo } from '../modules/alarm-backup';
export {
  canScheduleExactAlarms,
  cancelDailyAlarm,
  getAlarmInfo,
  isAlarmBackupAvailable,
  openAppSettings,
  openExactAlarmSettings,
  runBackupNow,
  scheduleDailyAlarm,
  scheduleTestAlarm,
} from '../modules/alarm-backup';

/**
 * Allinea la sveglia di sistema allo stato del backup: se il backup automatico è
 * attivo la sveglia viene (ri)programmata all'orario salvato, altrimenti spenta.
 * È idempotente: chiamarla più volte non crea doppioni.
 */
export function syncAlarmWithState(state: FolderState): AlarmInfo | null {
  if (!state.enabled) {
    return cancelDailyAlarm();
  }
  return scheduleDailyAlarm(state.scheduleHour, state.scheduleMinute);
}

export function formatAlarmMoment(timestamp: number | null): string {
  if (!timestamp) return 'non programmata';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'non programmata';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();

  const time = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `oggi alle ${time}`;
  if (isTomorrow) return `domani alle ${time}`;
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAlarmTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'mai';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'mai';
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Riga pronta per la schermata: "domani alle 03:00 (esatta)". */
export function describeAlarm(info: AlarmInfo | null, enabled: boolean, available: boolean): string {
  if (!enabled) return 'backup automatico spento';
  if (!available) return 'sveglia non disponibile in questa build (serve l’APK Android)';
  if (!info) return 'stato sveglia non leggibile';
  if (!info.scheduled) return 'sveglia non impostata: riattiva l’interruttore';
  return `${formatAlarmMoment(info.nextTriggerAt)} (${info.exact ? 'esatta' : 'approssimativa'})`;
}

/**
 * Bucket di standby di Android: da `rara` in giù il sistema (e Samsung) rimanda
 * i lavori in background, quindi il backup può slittare anche con la sveglia armata.
 */
/** true se Android (o Samsung) sta limitando l'app in background. */
export function isBackgroundLimited(info: AlarmInfo | null): boolean {
  if (!info) return false;
  return info.batteryOptimized || ['rara', 'limitata', 'mai'].includes(info.standbyBucket);
}

export function describeStandbyBucket(bucket: string | null | undefined): string {
  switch (bucket) {
    case 'attiva':
    case 'in uso':
      return `${bucket} (ok)`;
    case 'frequente':
      return 'frequente (ok)';
    case 'rara':
      return 'rara — Android rimanda i lavori: togli l’app dalla sospensione';
    case 'limitata':
      return 'limitata — l’app è bloccata dal sistema: escludila dalla sospensione';
    case 'mai':
      return 'mai — l’app è in sospensione profonda: escludila subito';
    case undefined:
    case null:
      return 'non disponibile';
    default:
      return bucket;
  }
}

/** Da dove è arrivato l'ultimo risveglio, in italiano. */
export function describeAlarmSource(source: string | null | undefined): string {
  switch (source) {
    case 'alarm':
      return 'sveglia';
    case 'retry':
      return 'controllo di recupero';
    case 'test':
      return 'sveglia di prova';
    case 'boot':
      return 'riavvio';
    default:
      return source ? source : 'sconosciuta';
  }
}
