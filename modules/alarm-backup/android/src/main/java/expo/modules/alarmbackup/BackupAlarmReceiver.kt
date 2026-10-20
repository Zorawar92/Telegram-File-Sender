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
 * 2. riprogramma la sveglia quotidiana per il giorno successivo e prepara un
 *    "controllo di recupero" due ore dopo, così un errore di oggi non spegne i
 *    controlli futuri e un risveglio perso viene recuperato;
 * 3. avvia direttamente il servizio che esegue il backup: un foreground service
 *    avviato da una sveglia esatta non viene rimandato (WorkManager invece sì).
 *    Se Android non lo permette, il controllo viene accodato a WorkManager.
 */
class BackupAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val appContext = context.applicationContext
    val source = intent?.getStringExtra(AlarmScheduler.EXTRA_SOURCE) ?: AlarmScheduler.SOURCE_ALARM
    Log.i("AlarmBackup", "Sveglia ricevuta (action=${intent?.action}, origine=$source)")

    AlarmScheduler.recordTrigger(appContext, source)

    try {
      if (source == AlarmScheduler.SOURCE_ALARM) {
        // Sveglia quotidiana: domani alla stessa ora + un secondo tentativo tra due ore.
        AlarmScheduler.arm(appContext)
        AlarmScheduler.armRetry(appContext)
      }
      // La sveglia di prova e il recupero non riprogrammano nulla: la quotidiana
      // è già impostata per domani.
    } catch (error: Throwable) {
      Log.e("AlarmBackup", "Impossibile riprogrammare la sveglia", error)
    }

    if (!BackupRunService.start(appContext, source)) {
      AlarmBackupRunner.enqueue(appContext, source)
    }
  }
}
