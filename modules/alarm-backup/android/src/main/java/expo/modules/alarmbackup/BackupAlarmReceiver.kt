package expo.modules.alarmbackup

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Scatta quando AlarmManager sveglia l'app all'orario scelto.
 *
 * Ordine delle operazioni (importante):
 * 1. registra il risveglio, così la Diagnostica dell'app mostra che la sveglia è arrivata;
 * 2. riprogramma subito la sveglia per il giorno successivo, così un errore nel
 *    controllo di oggi non spegne i controlli dei giorni futuri;
 * 3. accoda il lavoro che esegue davvero il backup (con WorkManager, che sopravvive
 *    alla chiusura di questo receiver).
 */
class BackupAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val appContext = context.applicationContext
    Log.i("AlarmBackup", "Sveglia ricevuta (action=${intent?.action})")

    AlarmScheduler.recordTrigger(appContext, AlarmBackupRunner.SOURCE_ALARM)

    try {
      AlarmScheduler.arm(appContext)
    } catch (error: Throwable) {
      Log.e("AlarmBackup", "Impossibile riprogrammare la sveglia di domani", error)
    }

    AlarmBackupRunner.enqueue(appContext, AlarmBackupRunner.SOURCE_ALARM)
  }
}
