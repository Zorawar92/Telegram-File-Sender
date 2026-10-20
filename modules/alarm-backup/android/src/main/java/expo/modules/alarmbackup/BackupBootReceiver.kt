package expo.modules.alarmbackup

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Android cancella tutte le sveglie quando il telefono si riavvia (e anche quando
 * l'app viene aggiornata o cambia l'ora/il fuso orario). Senza questo receiver il
 * backup automatico smetterebbe di partire dopo il primo riavvio, senza che
 * l'utente se ne accorga: qui la sveglia viene rimessa in piedi da sola.
 */
class BackupBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    val appContext = context.applicationContext

    val shouldReschedule = when (action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      "android.intent.action.QUICKBOOT_POWERON" -> true

      else -> false
    }

    if (!shouldReschedule) return

    Log.i("AlarmBackup", "Ricevuto $action: riprogrammo la sveglia del backup")
    try {
      AlarmScheduler.arm(appContext)
    } catch (error: Throwable) {
      Log.e("AlarmBackup", "Impossibile riprogrammare la sveglia dopo $action", error)
    }
  }
}
