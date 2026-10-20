package expo.modules.alarmbackup

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.usage.UsageStatsManager
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
 * sbloccato. Una sveglia di sistema invece sveglia il dispositivo all'orario scelto.
 *
 * Usiamo `setAlarmClock`, l'API delle sveglie della sveglia dell'orologio:
 * - il sistema non può spostarla (a differenza di `setExactAndAllowWhileIdle`);
 * - esce dal risparmio energetico per consegnarla, anche con l'app chiusa;
 * - compare l'icona della sveglia nella barra di stato, quindi si vede che è armata;
 * - può avviare un foreground service anche da background (cosa che, su Android 12+,
 *   un normale lavoro in background non può fare).
 *
 * Lo stato della sveglia sta in SharedPreferences perché deve essere leggibile senza
 * avviare JavaScript (receiver dell'allarme, receiver del riavvio, servizio).
 */
internal object AlarmScheduler {
  const val ACTION_ALARM = "expo.modules.alarmbackup.ALARM"
  const val EXTRA_SOURCE = "expo.modules.alarmbackup.SOURCE"
  const val SOURCE_ALARM = "alarm"
  const val SOURCE_TEST = "test"
  const val SOURCE_RETRY = "retry"

  private const val TAG = "AlarmBackup"
  private const val PREFS_NAME = "expo.modules.alarmbackup"
  private const val REQUEST_CODE = 4711
  private const val REQUEST_CODE_TEST = 4712
  private const val REQUEST_CODE_RETRY = 4713
  /** Il "controllo di recupero" parte due ore dopo quello principale. */
  private const val RETRY_DELAY_MS = 2 * 60 * 60 * 1000L
  private const val TOLERANCE_MS = 3 * 60 * 1000L
  private const val MAX_TEST_MINUTES = 60

  private const val KEY_ENABLED = "enabled"
  private const val KEY_HOUR = "hour"
  private const val KEY_MINUTE = "minute"
  private const val KEY_NEXT = "nextTriggerAt"
  private const val KEY_EXACT = "exact"
  private const val KEY_ALARM_CLOCK = "alarmClock"
  private const val KEY_TEST_AT = "testScheduledAt"
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
    prefs(appContext).edit().putBoolean(KEY_ENABLED, false).remove(KEY_NEXT).remove(KEY_TEST_AT).apply()
    val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    if (alarmManager != null) {
      existingPendingIntent(appContext, REQUEST_CODE, null)?.let {
        alarmManager.cancel(it)
        it.cancel()
      }
      existingPendingIntent(appContext, REQUEST_CODE_TEST, null)?.let {
        alarmManager.cancel(it)
        it.cancel()
      }
      existingPendingIntent(appContext, REQUEST_CODE_RETRY, null)?.let {
        alarmManager.cancel(it)
        it.cancel()
      }
    }
    return info(appContext)
  }

  /**
   * Sveglia "di prova" tra `minutes` minuti: serve a verificare subito, senza
   * aspettare l'orario vero, che il telefono svegli davvero l'app.
   */
  fun scheduleTest(context: Context, minutes: Int): Map<String, Any?> {
    val appContext = context.applicationContext
    val delay = minutes.coerceIn(1, MAX_TEST_MINUTES).toLong() * 60_000L
    val triggerAt = System.currentTimeMillis() + delay
    val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    if (alarmManager == null) {
      prefs(appContext).edit().putString(KEY_LAST_RESULT, "errore: AlarmManager non disponibile").apply()
      return info(appContext)
    }

    val pendingIntent = buildPendingIntent(appContext, REQUEST_CODE_TEST, SOURCE_TEST)
    try {
      if (canScheduleExact(appContext)) {
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPendingIntent(appContext)), pendingIntent)
      } else {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
      prefs(appContext).edit().putLong(KEY_TEST_AT, triggerAt).apply()
      Log.i(TAG, "Sveglia di prova impostata tra $minutes minuti")
    } catch (error: Throwable) {
      Log.e(TAG, "Impossibile impostare la sveglia di prova", error)
      prefs(appContext)
        .edit()
        .putString(KEY_LAST_RESULT, "errore sveglia di prova: ${error.message ?: error.javaClass.simpleName}")
        .apply()
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
      preferences.edit().putString(KEY_LAST_RESULT, "errore: AlarmManager non disponibile").apply()
      return info(appContext)
    }

    val pendingIntent = buildPendingIntent(appContext, REQUEST_CODE, SOURCE_ALARM)
    var exact = canScheduleExact(appContext)
    var alarmClock = false

    try {
      if (exact) {
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPendingIntent(appContext)), pendingIntent)
        alarmClock = true
      } else {
        // Senza il permesso "allarmi esatti" Android può spostare la sveglia:
        // meglio un controllo in ritardo che nessun controllo.
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
    } catch (error: SecurityException) {
      // Il permesso può essere revocato mentre l'app è aperta.
      Log.w(TAG, "Sveglia esatta rifiutata da Android, uso quella approssimativa", error)
      exact = false
      alarmClock = false
      try {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } catch (fallbackError: Throwable) {
        Log.e(TAG, "Impossibile impostare la sveglia", fallbackError)
        preferences
          .edit()
          .putString(KEY_LAST_RESULT, "errore: ${fallbackError.message ?: fallbackError.javaClass.simpleName}")
          .apply()
        return info(appContext)
      }
    } catch (error: Throwable) {
      Log.e(TAG, "Impossibile impostare la sveglia", error)
      preferences
        .edit()
        .putString(KEY_LAST_RESULT, "errore: ${error.message ?: error.javaClass.simpleName}")
        .apply()
      return info(appContext)
    }

    preferences
      .edit()
      .putLong(KEY_NEXT, triggerAt)
      .putBoolean(KEY_EXACT, exact)
      .putBoolean(KEY_ALARM_CLOCK, alarmClock)
      .apply()

    Log.i(
      TAG,
      "Sveglia impostata per ${java.util.Date(triggerAt)} (${if (exact) "esatta" else "approssimativa"})",
    )
    return info(appContext)
  }

  /**
   * Secondo tentativo di oggi (`RETRY_DELAY_MS` dopo il primo risveglio).
   *
   * Serve perché il produttore può bloccare il primo risveglio (telefono spento,
   * riavvio in corso, risparmio energetico): il controllo di recupero riprova più
   * tardi. Se il backup di oggi è già stato fatto, il controllo in JS non fa nulla.
   */
  fun armRetry(context: Context, delayMs: Long = RETRY_DELAY_MS) {
    val appContext = context.applicationContext
    val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = buildPendingIntent(appContext, REQUEST_CODE_RETRY, SOURCE_RETRY)
    val triggerAt = System.currentTimeMillis() + delayMs
    try {
      if (canScheduleExact(appContext)) {
        alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPendingIntent(appContext)), pendingIntent)
      } else {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
      Log.i(TAG, "Controllo di recupero impostato per ${java.util.Date(triggerAt)}")
    } catch (error: Throwable) {
      Log.w(TAG, "Controllo di recupero non impostato", error)
    }
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
    val testAt = if (preferences.contains(KEY_TEST_AT)) preferences.getLong(KEY_TEST_AT, 0L) else 0L
    val now = System.currentTimeMillis()

    return mapOf(
      "enabled" to enabled,
      "hour" to preferences.getInt(KEY_HOUR, 3),
      "minute" to preferences.getInt(KEY_MINUTE, 0),
      "scheduled" to (enabled && nextTriggerAt > now - TOLERANCE_MS),
      "nextTriggerAt" to if (nextTriggerAt > 0L) nextTriggerAt.toDouble() else null,
      "exact" to preferences.getBoolean(KEY_EXACT, false),
      "alarmClock" to preferences.getBoolean(KEY_ALARM_CLOCK, false),
      "canScheduleExact" to canScheduleExact(appContext),
      "batteryOptimized" to isBatteryOptimized(appContext),
      "standbyBucket" to standbyBucket(appContext),
      "testScheduledAt" to if (testAt > now - TOLERANCE_MS) testAt.toDouble() else null,
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

  /** true se l'app è ancora soggetta all'ottimizzazione batteria. */
  fun isBatteryOptimized(context: Context): Boolean {
    val appContext = context.applicationContext
    val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return try {
      !powerManager.isIgnoringBatteryOptimizations(appContext.packageName)
    } catch (error: Throwable) {
      false
    }
  }

  /**
   * "Bucket" di standby dell'app (Android 9+): è qui che Samsung mette le app
   * "in sospensione". `rare`/`restricted`/`never` spiegano un backup che non parte.
   */
  fun standbyBucket(context: Context): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "n/d"
    val appContext = context.applicationContext
    val manager = appContext.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return "n/d"
    return try {
      // Valori di UsageStatsManager: ACTIVE=10, WORKING_SET=20, FREQUENT=30,
      // RARE=40, RESTRICTED=45, NEVER=50 (le costanti non sono tutte pubbliche).
      when (manager.appStandbyBucket) {
        10 -> "attiva"
        20 -> "in uso"
        30 -> "frequente"
        40 -> "rara"
        45 -> "limitata"
        50 -> "mai"
        else -> "sconosciuta"
      }
    } catch (error: Throwable) {
      Log.w(TAG, "Bucket di standby non disponibile", error)
      "n/d"
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

  /** PendingIntent mostrato dal sistema quando l'utente tocca l'icona della sveglia. */
  private fun showPendingIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      REQUEST_CODE,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun buildPendingIntent(context: Context, requestCode: Int, source: String?): PendingIntent {
    val intent = Intent(context, BackupAlarmReceiver::class.java).apply {
      action = ACTION_ALARM
      if (source != null) putExtra(EXTRA_SOURCE, source)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, requestCode, intent, flags)
  }

  private fun existingPendingIntent(context: Context, requestCode: Int, source: String?): PendingIntent? {
    val intent = Intent(context, BackupAlarmReceiver::class.java).apply {
      action = ACTION_ALARM
      if (source != null) putExtra(EXTRA_SOURCE, source)
    }
    val flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
    return try {
      PendingIntent.getBroadcast(context, requestCode, intent, flags)
    } catch (error: Throwable) {
      null
    }
  }
}
