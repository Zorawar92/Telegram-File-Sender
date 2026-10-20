package expo.modules.alarmbackup

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.PowerManager
import android.util.Log
import java.util.Calendar

/**
 * Sveglia quotidiana con AlarmManager.
 *
 * WorkManager (usato da expo-background-task) è pensato per lavori "quando il sistema
 * ha voglia": può slittare di ore o non partire affatto finché il telefono non viene
 * sbloccato. Una sveglia `setExactAndAllowWhileIdle` invece sveglia il dispositivo
 * (anche in Doze) all'orario scelto: è quella che fa partire il backup automatico.
 *
 * Lo stato della sveglia sta in SharedPreferences perché deve essere leggibile senza
 * avviare JavaScript (receiver dell'allarme, receiver del riavvio).
 */
internal object AlarmScheduler {
  const val ACTION_ALARM = "expo.modules.alarmbackup.ALARM"

  private const val TAG = "AlarmBackup"
  private const val PREFS_NAME = "expo.modules.alarmbackup"
  private const val REQUEST_CODE = 4711
  private const val TOLERANCE_MS = 3 * 60 * 1000L

  private const val KEY_ENABLED = "enabled"
  private const val KEY_HOUR = "hour"
  private const val KEY_MINUTE = "minute"
  private const val KEY_NEXT = "nextTriggerAt"
  private const val KEY_EXACT = "exact"
  private const val KEY_LAST_FIRED = "lastFiredAt"
  private const val KEY_LAST_SOURCE = "lastSource"
  private const val KEY_LAST_RUN = "lastRunAt"
  private const val KEY_LAST_RESULT = "lastRunResult"

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  /** Programma (o riprogramma) la sveglia tutti i giorni alle ore/minuti indicati. */
  fun schedule(context: Context, hour: Int, minute: Int): Map<String, Any?> {
    val appContext = context.applicationContext
    val safeHour = hour.coerceIn(0, 23)
    val safeMinute = minute.coerceIn(0, 59)
    prefs(appContext)
      .edit()
      .putBoolean(KEY_ENABLED, true)
      .putInt(KEY_HOUR, safeHour)
      .putInt(KEY_MINUTE, safeMinute)
      .apply()
    return arm(appContext)
  }

  /** Spegne la sveglia (backup automatico disattivato). */
  fun cancel(context: Context): Map<String, Any?> {
    val appContext = context.applicationContext
    prefs(appContext).edit().putBoolean(KEY_ENABLED, false).remove(KEY_NEXT).apply()
    val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    val pendingIntent = existingPendingIntent(appContext)
    if (alarmManager != null && pendingIntent != null) {
      alarmManager.cancel(pendingIntent)
      pendingIntent.cancel()
    }
    return info(appContext)
  }

  /**
   * Imposta la prossima sveglia a partire dalle preferenze salvate.
   * Chiamata anche dal receiver dell'allarme (per la catena del giorno dopo) e
   * dal receiver del riavvio.
   */
  fun arm(context: Context): Map<String, Any?> {
    val appContext = context.applicationContext
    val preferences = prefs(appContext)

    if (!preferences.getBoolean(KEY_ENABLED, false)) {
      return info(appContext)
    }

    val hour = preferences.getInt(KEY_HOUR, 3)
    val minute = preferences.getInt(KEY_MINUTE, 0)
    val triggerAt = nextTriggerAt(hour, minute)

    val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    if (alarmManager == null) {
      Log.e(TAG, "AlarmManager non disponibile: impossibile impostare la sveglia")
      prefs(appContext).edit().putString(KEY_LAST_RESULT, "errore: AlarmManager non disponibile").apply()
      return info(appContext)
    }

    val pendingIntent = buildPendingIntent(appContext)
    var exact = canScheduleExact(appContext)

    try {
      if (exact) {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } else {
        // Senza il permesso "allarmi esatti" Android può spostare la sveglia di
        // qualche minuto: meglio un controllo in ritardo che nessun controllo.
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
    } catch (error: SecurityException) {
      // Il permesso può essere revocato mentre l'app è aperta.
      Log.w(TAG, "Sveglia esatta rifiutata da Android, uso quella approssimativa", error)
      exact = false
      try {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } catch (fallbackError: Throwable) {
        Log.e(TAG, "Impossibile impostare la sveglia", fallbackError)
        prefs(appContext)
          .edit()
          .putString(KEY_LAST_RESULT, "errore: ${fallbackError.message ?: fallbackError.javaClass.simpleName}")
          .apply()
        return info(appContext)
      }
    } catch (error: Throwable) {
      Log.e(TAG, "Impossibile impostare la sveglia", error)
      prefs(appContext)
        .edit()
        .putString(KEY_LAST_RESULT, "errore: ${error.message ?: error.javaClass.simpleName}")
        .apply()
      return info(appContext)
    }

    prefs(appContext)
      .edit()
      .putLong(KEY_NEXT, triggerAt)
      .putBoolean(KEY_EXACT, exact)
      .apply()

    Log.i(
      TAG,
      "Sveglia impostata per ${java.util.Date(triggerAt)} (${if (exact) "esatta" else "approssimativa"})",
    )
    return info(appContext)
  }

  /** true se Android permette le sveglie esatte (sempre true prima di Android 12). */
  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val alarmManager = context.applicationContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
      ?: return false
    return try {
      alarmManager.canScheduleExactAlarms()
    } catch (error: Throwable) {
      Log.w(TAG, "canScheduleExactAlarms non disponibile", error)
      false
    }
  }

  fun info(context: Context): Map<String, Any?> {
    val appContext = context.applicationContext
    val preferences = prefs(appContext)
    val enabled = preferences.getBoolean(KEY_ENABLED, false)
    val nextTriggerAt = if (preferences.contains(KEY_NEXT)) preferences.getLong(KEY_NEXT, 0L) else 0L
    val now = System.currentTimeMillis()

    return mapOf(
      "enabled" to enabled,
      "hour" to preferences.getInt(KEY_HOUR, 3),
      "minute" to preferences.getInt(KEY_MINUTE, 0),
      "scheduled" to (enabled && nextTriggerAt > now - TOLERANCE_MS),
      "nextTriggerAt" to if (nextTriggerAt > 0L) nextTriggerAt.toDouble() else null,
      "exact" to preferences.getBoolean(KEY_EXACT, false),
      "canScheduleExact" to canScheduleExact(appContext),
      "batteryOptimized" to isBatteryOptimized(appContext),
      "lastFiredAt" to readMillis(preferences, KEY_LAST_FIRED),
      "lastSource" to preferences.getString(KEY_LAST_SOURCE, null),
      "lastRunAt" to readMillis(preferences, KEY_LAST_RUN),
      "lastRunResult" to preferences.getString(KEY_LAST_RESULT, null),
    )
  }

  fun recordTrigger(context: Context, source: String) {
    prefs(context)
      .edit()
      .putLong(KEY_LAST_FIRED, System.currentTimeMillis())
      .putString(KEY_LAST_SOURCE, source)
      .apply()
  }

  fun recordRunStart(context: Context, source: String) {
    prefs(context)
      .edit()
      .putLong(KEY_LAST_RUN, System.currentTimeMillis())
      .putString(KEY_LAST_SOURCE, source)
      .putString(KEY_LAST_RESULT, "in corso…")
      .apply()
  }

  fun recordRunResult(context: Context, result: String) {
    prefs(context).edit().putString(KEY_LAST_RESULT, result).apply()
  }

  fun isBatteryOptimized(context: Context): Boolean {
    val appContext = context.applicationContext
    val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return try {
      !powerManager.isIgnoringBatteryOptimizations(appContext.packageName)
    } catch (error: Throwable) {
      false
    }
  }

  private fun readMillis(preferences: SharedPreferences, key: String): Double? {
    if (!preferences.contains(key)) return null
    val value = preferences.getLong(key, 0L)
    return if (value > 0L) value.toDouble() else null
  }

  private fun nextTriggerAt(hour: Int, minute: Int): Long {
    val target = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    // Se l'orario di oggi è già passato (o è adesso) la sveglia è per domani.
    if (target.timeInMillis <= System.currentTimeMillis() + 1000L) {
      target.add(Calendar.DAY_OF_YEAR, 1)
    }
    return target.timeInMillis
  }

  private fun buildPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, BackupAlarmReceiver::class.java).apply {
      action = ACTION_ALARM
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
  }

  private fun existingPendingIntent(context: Context): PendingIntent? {
    val intent = Intent(context, BackupAlarmReceiver::class.java).apply {
      action = ACTION_ALARM
    }
    val flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
    return try {
      PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
    } catch (error: Throwable) {
      null
    }
  }
}
