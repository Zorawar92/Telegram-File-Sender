package expo.modules.alarmbackup

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * Accoda il controllo della cartella come lavoro di WorkManager.
 *
 * Il receiver della sveglia non può eseguire direttamente JavaScript: la sveglia
 * sveglia il dispositivo, poi questo lavoro avvia l'app in modalità headless e
 * esegue il task registrato con expo-background-task (lo stesso che userebbe
 * WorkManager da solo, ma qui parte all'ora scelta).
 *
 * WorkManager tiene vivo il processo per tutta la durata del lavoro e, se la rete
 * manca in quel momento, aspetta che torni invece di perdere il giro.
 */
internal object AlarmBackupRunner {
  const val SOURCE_ALARM = "alarm"

  private const val TAG = "AlarmBackup"
  private const val UNIQUE_WORK_NAME = "telegram-file-sender-alarm-backup"

  fun enqueue(context: Context, source: String): Boolean {
    val appContext = context.applicationContext

    val request = OneTimeWorkRequestBuilder<AlarmBackupWorker>()
      .setInputData(workDataOf(AlarmBackupWorker.KEY_SOURCE to source))
      .setConstraints(
        Constraints.Builder()
          .setRequiredNetworkType(NetworkType.CONNECTED)
          .build(),
      )
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
      .addTag(UNIQUE_WORK_NAME)
      .build()

    return try {
      WorkManager.getInstance(appContext)
        .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
      Log.i(TAG, "Controllo accodato (origine: $source)")
      true
    } catch (error: Throwable) {
      Log.e(TAG, "Impossibile accodare il controllo automatico", error)
      AlarmScheduler.recordRunResult(
        appContext,
        "errore: ${error.message ?: error.javaClass.simpleName}",
      )
      false
    }
  }
}
