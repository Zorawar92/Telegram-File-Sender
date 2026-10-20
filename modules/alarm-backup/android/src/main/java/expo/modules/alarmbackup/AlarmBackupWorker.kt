package expo.modules.alarmbackup

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import expo.modules.backgroundtask.BackgroundTaskScheduler

/**
 * Esegue il task JS registrato con expo-background-task ("Controlla la cartella").
 *
 * Riusa `BackgroundTaskScheduler.runTasks`, cioè la stessa strada che usa
 * WorkManager quando Expo pianifica il task da solo: avvia l'app in headless
 * (se non è già aperta), esegue il task registrato e aspetta che finisca.
 * La differenza è che qui siamo noi a decidere *quando*: all'orario della sveglia.
 */
class AlarmBackupWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  companion object {
    const val KEY_SOURCE = "source"
    private const val TAG = "AlarmBackup"
  }

  override suspend fun doWork(): Result {
    val source = inputData.getString(KEY_SOURCE) ?: AlarmBackupRunner.SOURCE_ALARM
    AlarmScheduler.recordRunStart(applicationContext, source)

    // Con l'app in primo piano il task in background non deve girare: il
    // controllo lo fa già la schermata (recupero automatico ogni minuto).
    if (BackgroundTaskScheduler.inForeground) {
      AlarmScheduler.recordRunResult(
        applicationContext,
        "app aperta: il controllo lo esegue la schermata",
      )
      return Result.success()
    }

    return try {
      BackgroundTaskScheduler.runTasks(applicationContext, applicationContext.packageName)
      AlarmScheduler.recordRunResult(applicationContext, "controllo eseguito")
      Result.success()
    } catch (error: Throwable) {
      val message = error.message ?: error.javaClass.simpleName
      AlarmScheduler.recordRunResult(applicationContext, "errore: $message")
      Log.e(TAG, "Controllo automatico non riuscito", error)
      if (runAttemptCount < 2) Result.retry() else Result.failure()
    }
  }
}
