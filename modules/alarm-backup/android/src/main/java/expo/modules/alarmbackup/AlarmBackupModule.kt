package expo.modules.alarmbackup

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ponte JavaScript ↔ sveglia di Android.
 *
 * Tutto quello che serve all'interfaccia: impostare/spegnere la sveglia, sapere se
 * è stata concessa l'autorizzazione "Allarmi e promemoria" e aprire la schermata
 * giusta delle impostazioni quando manca.
 */
class AlarmBackupModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Contesto React non disponibile")

  override fun definition() = ModuleDefinition {
    Name("AlarmBackup")

    /** Programma la sveglia quotidiana e restituisce lo stato aggiornato. */
    Function("scheduleDaily") { hour: Int, minute: Int ->
      AlarmScheduler.schedule(context, hour, minute)
    }

    /** Spegne la sveglia. */
    Function("cancel") {
      AlarmScheduler.cancel(context)
    }

    /**
     * Sveglia di prova tra `minutes` minuti: serve a verificare subito che il
     * telefono svegli davvero l'app, senza aspettare l'orario impostato.
     */
    Function("scheduleTestAlarm") { minutes: Int ->
      AlarmScheduler.scheduleTest(context, minutes)
    }

    /** Apre la scheda dell'app nelle impostazioni (Su Samsung: batteria, sospensione). */
    Function("openAppSettings") {
      startFirstAvailable(context, listOf(appDetailsIntent(context)))
    }

    /** Stato completo: prossimo risveglio, permessi, ultimo esito. */
    Function("getAlarmInfo") {
      AlarmScheduler.info(context)
    }

    Function("canScheduleExactAlarms") {
      AlarmScheduler.canScheduleExact(context)
    }

    /** Apre Impostazioni → Allarmi e promemoria per questa app (Android 12+). */
    Function("openExactAlarmSettings") {
      openExactAlarmSettings(context)
    }
  }

  private fun openExactAlarmSettings(appContext: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
    return startFirstAvailable(
      appContext,
      listOf(
        Intent(
          Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:${appContext.packageName}"),
        ),
        appDetailsIntent(appContext),
      ),
    )
  }

  private fun appDetailsIntent(appContext: Context): Intent =
    Intent(
      Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
      Uri.parse("package:${appContext.packageName}"),
    )

  private fun startFirstAvailable(appContext: Context, intents: List<Intent>): Boolean {
    for (intent in intents) {
      try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.startActivity(intent)
        return true
      } catch (error: ActivityNotFoundException) {
        Log.w("AlarmBackup", "Schermata non disponibile: ${intent.action}")
      } catch (error: Throwable) {
        Log.w("AlarmBackup", "Impossibile aprire ${intent.action}", error)
      }
    }
    return false
  }
}
