package expo.modules.alarmbackup

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import expo.modules.backgroundtask.BackgroundTaskScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Esegue il backup automatico quando arriva la sveglia.
 *
 * Perché un foreground service e non solo WorkManager: su Android 12+ WorkManager
 * è libero di rimandare il lavoro, e Samsung (One UI) lo rimanda finché il telefono
 * non viene usato, specialmente per le app "in sospensione". Un exact alarm invece
 * può avviare un foreground service anche con l'app chiusa, e da lì il processo resta
 * vivo (con un wakelock) finché il controllo della cartella non è finito.
 *
 * Il lavoro vero (leggere la cartella e caricare i file su Telegram) resta in
 * JavaScript: questo servizio riusa `BackgroundTaskScheduler.runTasks`, la stessa
 * strada di expo-background-task, che avvia l'app in headless e aspetta la fine.
 */
class BackupRunService : Service() {

  companion object {
    private const val TAG = "AlarmBackup"
    private const val CHANNEL_ID = "alarm-backup-run"
    private const val NOTIFICATION_ID = 4711
    private const val WAKELOCK_TIMEOUT_MS = 10 * 60 * 1000L

    /**
     * Avvia il servizio. Restituisce false se Android non lo permette (per esempio
     * con l'app in background senza una sveglia esatta): in quel caso chi chiama
     * deve ripiegare su WorkManager.
     */
    fun start(context: Context, source: String): Boolean {
      val intent = Intent(context, BackupRunService::class.java)
        .putExtra(AlarmScheduler.EXTRA_SOURCE, source)
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (error: Throwable) {
        Log.w(TAG, "Foreground service non avviabile, passo a WorkManager", error)
        false
      }
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val source = intent?.getStringExtra(AlarmScheduler.EXTRA_SOURCE) ?: AlarmScheduler.SOURCE_ALARM

    // Va fatto entro pochi secondi dall'avvio, altrimenti Android chiude il servizio.
    startAsForeground()
    acquireWakeLock()

    scope.launch {
      var failed = false
      try {
        AlarmScheduler.recordRunStart(applicationContext, source)
        if (BackgroundTaskScheduler.inForeground) {
          // L'app è aperta: il controllo lo sta già facendo la schermata.
          AlarmScheduler.recordRunResult(
            applicationContext,
            "app aperta: il controllo lo esegue la schermata",
          )
        } else {
          BackgroundTaskScheduler.runTasks(applicationContext, applicationContext.packageName)
          AlarmScheduler.recordRunResult(applicationContext, "controllo eseguito (sveglia)")
        }
      } catch (error: Throwable) {
        failed = true
        val message = error.message ?: error.javaClass.simpleName
        AlarmScheduler.recordRunResult(applicationContext, "errore: $message")
        Log.e(TAG, "Controllo automatico non riuscito", error)
      } finally {
        // Se il controllo non è partito, riprova con WorkManager (che a volte
        // riesce dove il servizio no, e viceversa).
        if (failed) {
          AlarmBackupRunner.enqueue(applicationContext, source)
        }
        releaseWakeLock()
        stopForegroundCompat()
        stopSelf(startId)
      }
    }

    return START_NOT_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    super.onDestroy()
  }

  private fun startAsForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Backup automatico",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Avviso mostrato mentre il backup controlla la cartella"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    val icon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.stat_sys_download
    val notification = builder
      .setContentTitle("Backup in corso")
      .setContentText("Controllo della cartella e invio dei file nuovi…")
      .setSmallIcon(icon)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock != null) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    wakeLock = try {
      powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AlarmBackup:run").apply {
        setReferenceCounted(false)
        acquire(WAKELOCK_TIMEOUT_MS)
      }
    } catch (error: Throwable) {
      Log.w(TAG, "Wakelock non disponibile", error)
      null
    }
  }

  private fun releaseWakeLock() {
    val lock = wakeLock ?: return
    wakeLock = null
    try {
      if (lock.isHeld) lock.release()
    } catch (error: Throwable) {
      Log.w(TAG, "Rilascio del wakelock non riuscito", error)
    }
  }
}
