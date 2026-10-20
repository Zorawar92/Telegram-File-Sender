import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { cancelDailyAlarm, scheduleDailyAlarm } from './alarm';
import { runFolderSync } from './folderSync';
import { isDailyRunDue, loadState, localDateKey, saveState } from './storage';

export const FOLDER_TASK_NAME = 'telegram-file-sender.folder-sync';

/** WorkManager accetta come minimo 15 minuti tra un controllo e l'altro. */
export const BACKGROUND_INTERVAL_MINUTES = 15;

/**
 * Task in background: viene svegliato da Android ogni ~15 minuti.
 * Esegue davvero l'invio solo se l'orario giornaliero scelto è passato e il
 * controllo di oggi non è ancora stato fatto, così non consuma batteria.
 */
if (!TaskManager.isTaskDefined(FOLDER_TASK_NAME)) {
  TaskManager.defineTask(FOLDER_TASK_NAME, async () => {
    let state = loadState();

    if (!state.enabled || !state.directoryUri) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    if (!isDailyRunDue(state)) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    try {
      const result = await runFolderSync({
        trigger: 'background',
        markScheduledDay: true,
        maxFiles: 20,
        maxDurationMs: 8 * 60 * 1000,
      });
      if (result.failures.length && !result.uploaded) {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Controllo automatico non riuscito.';
      // Se un altro controllo (sveglia, "Scan ora", recupero all'apertura) è già
      // in corso, questo giro non deve segnare il giorno come coperto né
      // registrare un errore: il lavoro lo sta già facendo l'altro.
      if (message.includes('già in corso')) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      state = loadState();
      saveState({
        ...state,
        // Segna il giorno come coperto anche in caso di errore: evita di
        // riprovare in loop ogni 15 minuti e di bruciare la batteria.
        lastScheduledDateKey: localDateKey(new Date()),
        lastBackgroundRunAt: new Date().toISOString(),
        lastBackgroundResult: message,
        lastError: message,
        lastErrorAt: new Date().toISOString(),
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function isBackgroundTaskRegistered(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(FOLDER_TASK_NAME);
  } catch {
    return false;
  }
}

export async function registerBackgroundTask(): Promise<void> {
  const available = await TaskManager.isAvailableAsync();
  if (!available) {
    try {
      const status = await BackgroundTask.getStatusAsync();
      if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
        throw new Error(
          'Android ha disattivato i task in background per questa app: controlla le restrizioni batteria.',
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Android')) throw error;
    }
    throw new Error(
      'I controlli automatici non sono disponibili su questo dispositivo. Serve la build Android installata (non Expo Go).',
    );
  }

  if (await isBackgroundTaskRegistered()) {
    await BackgroundTask.unregisterTaskAsync(FOLDER_TASK_NAME);
  }

  await BackgroundTask.registerTaskAsync(FOLDER_TASK_NAME, {
    minimumInterval: BACKGROUND_INTERVAL_MINUTES,
  });

  // Oltre a WorkManager (che può slittare di ore) armiamo la sveglia di sistema:
  // è quella che fa partire il controllo all'orario scelto.
  const state = loadState();
  if (state.enabled) {
    scheduleDailyAlarm(state.scheduleHour, state.scheduleMinute);
  }
}

export async function unregisterBackgroundTask(): Promise<void> {
  if (await isBackgroundTaskRegistered()) {
    await BackgroundTask.unregisterTaskAsync(FOLDER_TASK_NAME);
  }
  cancelDailyAlarm();
}
