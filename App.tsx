import { Feather } from '@expo/vector-icons';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as DocumentPicker from 'expo-document-picker';
import { Directory } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/ErrorBoundary';
import { IncomingShareBridge, SharedFile } from './src/IncomingShareBridge';
import {
  isBackgroundTaskRegistered,
  registerBackgroundTask,
  unregisterBackgroundTask,
} from './src/backgroundTasks';
import { runFolderSync, readFolderFiles } from './src/folderSync';
import { createStyles } from './src/styles';
import {
  FolderState,
  emptyState,
  formatScheduleTime,
  isDailyRunDue,
  loadCredentials,
  loadState,
  localDateKey,
  parseScheduleTime,
  saveCredentials,
  saveState,
} from './src/storage';
import { getChat, getMe, sendDocument, sendTestMessage } from './src/telegram';
import { useColors } from './src/useColors';

SplashScreen.preventAutoHideAsync().catch(() => {});

type SelectedFile = {
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
};

type Notice = {
  tone: 'success' | 'error' | 'info';
  text: string;
} | null;

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return 'Dimensione non disponibile';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDateTime(iso?: string) {
  if (!iso) return 'mai';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'mai';
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function triggerLabel(trigger?: string) {
  if (trigger === 'background') return 'automatico';
  if (trigger === 'foreground') return 'all’apertura dell’app';
  if (trigger === 'manual') return 'manuale';
  return '';
}

function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isDark = colors.background === '#071522';
  const styles = useMemo(() => createStyles(colors), [colors]);
  const extra = useMemo(() => createExtraStyles(colors), [colors]);

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isCheckingBot, setIsCheckingBot] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [folderState, setFolderState] = useState<FolderState>(emptyState());
  const [scheduleTime, setScheduleTime] = useState('03:00');
  const [folderAccessible, setFolderAccessible] = useState<boolean | null>(null);
  const [taskRegistered, setTaskRegistered] = useState(false);
  const [batteryOptimizationEnabled, setBatteryOptimizationEnabled] = useState<boolean | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const busyRef = useRef(false);

  const refreshFolderAccess = useCallback((state: FolderState) => {
    if (!state.directoryUri) {
      setFolderAccessible(null);
      return;
    }
    try {
      const directory = new Directory(state.directoryUri);
      setFolderAccessible(Boolean(directory.exists));
    } catch {
      setFolderAccessible(false);
    }
  }, []);

  const refreshState = useCallback(() => {
    const state = loadState();
    setFolderState(state);
    setScheduleTime(formatScheduleTime(state.scheduleHour, state.scheduleMinute));
    refreshFolderAccess(state);
  }, [refreshFolderAccess]);

  const refreshBatteryOptimization = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setBatteryOptimizationEnabled(null);
      return;
    }
    try {
      setBatteryOptimizationEnabled(await Battery.isBatteryOptimizationEnabledAsync());
    } catch {
      setBatteryOptimizationEnabled(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [credentials, state, registered] = await Promise.all([
        loadCredentials(),
        Promise.resolve(loadState()),
        isBackgroundTaskRegistered(),
      ]);
      if (!mounted) return;
      setBotToken(credentials.botToken);
      setChatId(credentials.chatId);
      setFolderState(state);
      setScheduleTime(formatScheduleTime(state.scheduleHour, state.scheduleMinute));
      setTaskRegistered(registered);
      setIsReady(true);
      refreshFolderAccess(state);
    })().catch(() => {
      if (mounted) {
        setNotice({ tone: 'error', text: 'Non riesco a leggere le impostazioni salvate.' });
        setIsReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [refreshFolderAccess]);

  /**
   * Rete di sicurezza: se l'orario giornaliero è passato e Android non ha ancora
   * svegliato il task (succede spesso con WorkManager), l'app esegue il controllo
   * appena viene aperta o riportata in primo piano.
   */
  const runCatchUpIfDue = useCallback(async () => {
    if (busyRef.current) return;
    const state = loadState();
    if (!state.enabled || !isDailyRunDue(state)) return;
    busyRef.current = true;
    try {
      const result = await runFolderSync({ trigger: 'foreground', markScheduledDay: true });
      if (result.uploaded > 0) {
        setNotice({
          tone: 'success',
          text: `Controllo automatico recuperato: ${result.uploaded} file inviati a Telegram.`,
        });
      }
    } catch {
      // Il catch-up non deve disturbare l'utente con errori già mostrati altrove.
    } finally {
      busyRef.current = false;
      refreshState();
    }
  }, [refreshState]);

  useEffect(() => {
    if (!isReady) return;
    refreshBatteryOptimization();
    void runCatchUpIfDue();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshBatteryOptimization();
        void runCatchUpIfDue();
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void runCatchUpIfDue();
    }, 60 * 1000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [isReady, refreshBatteryOptimization, runCatchUpIfDue]);

  async function persistCredentials() {
    await saveCredentials(botToken, chatId);
  }

  async function openBatteryOptimizationSettings() {
    if (Platform.OS !== 'android') return;
    try {
      if (Application.applicationId) {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          { data: `package:${Application.applicationId}` },
        );
      } else {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
        );
      }
    } catch {
      try {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
        );
      } catch {
        setNotice({
          tone: 'error',
          text: 'Non riesco ad aprire le impostazioni batteria: aprirle a mano da Impostazioni → App → Telegram File Sender.',
        });
      }
    } finally {
      await refreshBatteryOptimization();
    }
  }

  async function pickFolder() {
    setNotice(null);
    try {
      const directory = await Directory.pickDirectoryAsync(
        folderState.directoryUri || undefined,
      );
      const current = loadState();
      const next: FolderState = {
        ...current,
        directoryUri: directory.uri,
        directoryName: directory.name || 'Cartella scelta',
        // Una cartella nuova riparte da zero: i file già presenti verranno
        // inviati al primo controllo.
        sent: {},
      };
      saveState(next);
      setFolderState(next);
      refreshFolderAccess(next);
      setNotice({
        tone: 'success',
        text: `Cartella collegata: ${next.directoryName}. Premi «Scan ora» per inviare i file presenti.`,
      });
      await Haptics.selectionAsync();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('cancel')) return;
      setNotice({ tone: 'error', text: 'Cartella non selezionata. Riprova.' });
    }
  }

  async function setAutomationEnabled(enabled: boolean) {
    setNotice(null);
    const current = loadState();

    if (enabled) {
      if (!current.directoryUri) {
        setNotice({ tone: 'error', text: 'Scegli una cartella prima di attivare il backup automatico.' });
        return;
      }
      if (!botToken.trim() || !chatId.trim()) {
        setNotice({
          tone: 'error',
          text: 'Inserisci token del bot e Chat ID prima di attivare il backup automatico.',
        });
        return;
      }
    }

    try {
      await persistCredentials();
      if (enabled) {
        await registerBackgroundTask();
      } else {
        await unregisterBackgroundTask();
      }

      const now = new Date();
      const alreadyPastSchedule =
        now.getHours() * 60 + now.getMinutes() >=
        current.scheduleHour * 60 + current.scheduleMinute;
      const next: FolderState = {
        ...current,
        enabled,
        // Se l'orario di oggi è già passato non lo recuperiamo subito (i file
        // presenti si inviano con «Scan ora»); se invece deve ancora arrivare,
        // il primo controllo automatico parte oggi all'orario scelto.
        lastScheduledDateKey:
          enabled && alreadyPastSchedule ? localDateKey(now) : current.lastScheduledDateKey,
      };
      saveState(next);
      setFolderState(next);
      setTaskRegistered(await isBackgroundTaskRegistered());

      const schedule = formatScheduleTime(next.scheduleHour, next.scheduleMinute);
      setNotice({
        tone: 'success',
        text: enabled
          ? `Backup automatico attivo. Prossimo controllo dopo le ${schedule} (Android può ritardarlo di qualche minuto). Premi «Scan ora» per inviare subito i file nuovi.`
          : 'Backup automatico in pausa.',
      });
      await Haptics.selectionAsync();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Non riesco a cambiare il backup automatico.',
      });
      refreshState();
    }
  }

  async function updateScheduleTime(value: string) {
    setScheduleTime(value);
    const parsed = parseScheduleTime(value);
    if (!parsed) return;
    const current = loadState();
    const next: FolderState = {
      ...current,
      scheduleHour: parsed.hour,
      scheduleMinute: parsed.minute,
    };
    saveState(next);
    setFolderState(next);
  }

  async function scanFolderNow() {
    Keyboard.dismiss();
    setNotice(null);
    setIsScanning(true);
    try {
      await persistCredentials();
      const result = await runFolderSync({ trigger: 'manual', maxFiles: 100 });
      refreshState();

      const parts: string[] = [];
      if (result.uploaded > 0) {
        parts.push(`${result.uploaded} file inviati a Telegram`);
      }
      if (result.skipped > 0) {
        parts.push(`${result.skipped} già inviati in precedenza`);
      }
      if (result.failures.length > 0) {
        const first = result.failures[0];
        parts.push(`${result.failures.length} non inviati (${first.fileName}: ${first.message})`);
      }
      if (!parts.length) {
        parts.push('Nessun file trovato nella cartella');
      }

      setNotice({
        tone: result.failures.length ? 'error' : result.uploaded ? 'success' : 'info',
        text: `${parts.join(' · ')}.`,
      });
      await Haptics.notificationAsync(
        result.failures.length
          ? Haptics.NotificationFeedbackType.Error
          : Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      refreshState();
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Il controllo della cartella non è riuscito.',
      });
    } finally {
      setIsScanning(false);
    }
  }

  async function pickFile() {
    if (isUploading) return;
    setNotice(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const selected = result.assets[0];
        setFile({
          name: selected.name,
          uri: selected.uri,
          size: selected.size,
          mimeType: selected.mimeType,
        });
        setProgress(0);
        await Haptics.selectionAsync();
      }
    } catch {
      setNotice({ tone: 'error', text: 'Il selettore file non si è aperto. Riprova.' });
    }
  }

  const handleIncomingSharedFile = useCallback((sharedFile: SharedFile, multiple: boolean) => {
    setFile(sharedFile);
    setProgress(0);
    setNotice({
      tone: 'info',
      text: multiple
        ? `${sharedFile.name}: l’app invia un file alla volta.`
        : `${sharedFile.name} pronto da inviare.`,
    });
  }, []);

  async function checkBot() {
    Keyboard.dismiss();
    setNotice(null);
    if (!botToken.trim()) {
      setNotice({ tone: 'error', text: 'Inserisci prima il token del bot.' });
      return;
    }
    setIsCheckingBot(true);
    try {
      await persistCredentials();
      const me = await getMe(botToken);
      const label = me.username ? `@${me.username}` : me.first_name || 'il tuo bot';

      if (!chatId.trim()) {
        setNotice({
          tone: 'info',
          text: `Bot ${label} raggiungibile. Ora inserisci il Chat ID.`,
        });
        return;
      }

      const chat = await getChat(botToken, chatId);
      const chatLabel = chat.title || chat.username ? `@${chat.username}` : chat.first_name || chat.id;
      setNotice({
        tone: 'success',
        text: `Bot ${label} collegato alla chat ${chatLabel}. Puoi inviare file.`,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Verifica non riuscita.',
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCheckingBot(false);
    }
  }

  async function sendTestMessageNow() {
    Keyboard.dismiss();
    setNotice(null);
    if (!botToken.trim() || !chatId.trim()) {
      setNotice({ tone: 'error', text: 'Servono token del bot e Chat ID.' });
      return;
    }
    setIsCheckingBot(true);
    try {
      await persistCredentials();
      await sendTestMessage(botToken, chatId);
      setNotice({
        tone: 'success',
        text: 'Messaggio di prova inviato: controlla Telegram, la chat è raggiungibile.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Invio di prova non riuscito.',
      });
    } finally {
      setIsCheckingBot(false);
    }
  }

  async function sendFile() {
    Keyboard.dismiss();
    setNotice(null);
    if (!file) {
      setNotice({ tone: 'error', text: 'Scegli un file prima di inviare.' });
      return;
    }
    if (!botToken.trim() || !chatId.trim()) {
      setNotice({ tone: 'error', text: 'Servono token del bot e Chat ID.' });
      return;
    }
    setIsUploading(true);
    setProgress(0);
    try {
      await persistCredentials();
      await sendDocument({
        botToken,
        chatId,
        uri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType,
        size: file.size,
        onProgress: setProgress,
      });
      setNotice({ tone: 'success', text: `${file.name} inviato a Telegram.` });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Il file non è stato inviato.',
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploading(false);
    }
  }

  function resetSentHistory() {
    const current = loadState();
    const next: FolderState = { ...current, sent: {} };
    saveState(next);
    setFolderState(next);
    setNotice({
      tone: 'info',
      text: 'Memoria degli invii azzerata: al prossimo controllo tutti i file nella cartella verranno reinviati.',
    });
  }

  const fileCount = useMemo(() => {
    try {
      if (!folderState.directoryUri) return null;
      return readFolderFiles(folderState.directoryUri).files.length;
    } catch {
      return null;
    }
  }, [folderState.directoryUri, folderState.lastScanAt]);

  const schedule = formatScheduleTime(folderState.scheduleHour, folderState.scheduleMinute);
  const nextRunLabel = useMemo(() => {
    const now = new Date();
    const scheduleMinutes = folderState.scheduleHour * 60 + folderState.scheduleMinute;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes >= scheduleMinutes && folderState.lastScheduledDateKey !== localDateKey(now)) {
      return `in attesa (dopo le ${schedule}) — parte all’apertura dell’app o al prossimo risveglio di Android`;
    }
    if (nowMinutes < scheduleMinutes) return `oggi alle ${schedule}`;
    return `domani alle ${schedule}`;
  }, [folderState.lastScheduledDateKey, folderState.scheduleHour, folderState.scheduleMinute, schedule]);

  const busy = isScanning || isUploading || isCheckingBot;

  return (
    <View style={styles.root}>
      <IncomingShareBridge onFileShared={handleIncomingSharedFile} />
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom + 24, 28) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Feather name="send" size={21} color={colors.primaryForeground} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>TRASFERIMENTO PRIVATO</Text>
            <Text style={styles.title}>Invia a Telegram</Text>
          </View>
          <View style={styles.lockBadge}>
            <Feather name="lock" size={14} color={colors.accentForeground} />
          </View>
        </View>

        <Text style={styles.subtitle}>
          Scegli un file e spediscilo direttamente alla chat Telegram del tuo bot, senza intermediari.
        </Text>

        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <View style={styles.heroIcon}>
            <Feather name="upload-cloud" size={30} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Pronto quando vuoi</Text>
          <Text style={styles.heroText}>
            Il file va da questo telefono a Telegram. Nessun server in mezzo.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scegli un file"
            testID="choose-file"
            onPress={pickFile}
            disabled={isUploading}
            style={({ pressed }) => [
              styles.chooseButton,
              pressed && styles.pressed,
              isUploading && styles.disabled,
            ]}
          >
            <Feather name="folder" size={18} color={colors.primaryForeground} />
            <Text style={styles.chooseButtonText}>
              {file ? 'Scegli un altro file' : 'Scegli un file'}
            </Text>
          </Pressable>
        </View>

        {file ? (
          <View style={styles.fileCard}>
            <View style={styles.fileIcon}>
              <Feather name="file" size={20} color={colors.primary} />
            </View>
            <View style={styles.fileDetails}>
              <Text style={styles.fileName} numberOfLines={1}>
                {file.name}
              </Text>
              <Text style={styles.fileMeta}>
                {formatBytes(file.size)} · {file.mimeType || 'tipo sconosciuto'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rimuovi il file scelto"
              testID="remove-file"
              onPress={() => {
                setFile(null);
                setProgress(0);
                setNotice(null);
              }}
              disabled={isUploading}
              style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}

        {isUploading ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressLabels}>
              <Text style={styles.progressLabel}>Invio in corso</Text>
              <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 2)}%` }]} />
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Invia il file a Telegram"
          testID="send-file"
          onPress={sendFile}
          disabled={isUploading || !isReady}
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.pressed,
            (isUploading || !isReady) && styles.disabled,
          ]}
        >
          {isUploading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Feather name="send" size={18} color={colors.primaryForeground} />
          )}
          <Text style={styles.sendButtonText}>
            {isUploading ? 'Invio…' : 'Invia file'}
          </Text>
        </Pressable>

        {notice ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.notice,
              notice.tone === 'success'
                ? styles.successNotice
                : notice.tone === 'error'
                  ? styles.errorNotice
                  : styles.infoNotice,
            ]}
          >
            <Feather
              name={
                notice.tone === 'success' ? 'check-circle' : notice.tone === 'error' ? 'alert-circle' : 'info'
              }
              size={17}
              color={
                notice.tone === 'success'
                  ? colors.success
                  : notice.tone === 'error'
                    ? colors.destructive
                    : colors.primary
              }
            />
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Backup automatico</Text>
          <Text style={styles.sectionHint}>Android</Text>
        </View>

        <View style={styles.automationCard}>
          <View style={styles.automationHeader}>
            <View style={styles.automationIcon}>
              <Feather name="refresh-cw" size={18} color={colors.primary} />
            </View>
            <View style={styles.automationCopy}>
              <Text style={styles.automationTitle}>Controlla la cartella</Text>
              <Text style={styles.automationText}>
                Ogni giorno all’orario scelto l’app cerca i file nuovi nella cartella e li manda su
                Telegram. I file già inviati non vengono rimandati.
              </Text>
            </View>
            <Switch
              testID="automation-toggle"
              value={folderState.enabled}
              onValueChange={setAutomationEnabled}
              disabled={isScanning || !isReady}
              trackColor={{ false: colors.muted, true: colors.accent }}
              thumbColor={folderState.enabled ? colors.primary : colors.mutedForeground}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scegli la cartella da controllare"
            testID="choose-folder"
            onPress={pickFolder}
            disabled={isScanning || !isReady}
            style={({ pressed }) => [
              styles.folderButton,
              pressed && styles.pressed,
              isScanning && styles.disabled,
            ]}
          >
            <Feather name="folder" size={16} color={colors.primary} />
            <Text style={styles.folderButtonText} numberOfLines={1}>
              {folderState.directoryName || 'Scegli la cartella da controllare'}
            </Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>

          {folderState.directoryUri ? (
            <View style={extra.statusList}>
              <View style={extra.statusRow}>
                <Feather
                  name={folderAccessible ? 'unlock' : 'alert-triangle'}
                  size={13}
                  color={folderAccessible ? colors.success : colors.destructive}
                />
                <Text style={extra.statusText}>
                  {folderAccessible
                    ? `Permesso cartella attivo · ${fileCount === null ? '—' : `${fileCount} file`} nella cartella`
                    : 'Permesso cartella scaduto: seleziona di nuovo la cartella'}
                </Text>
              </View>
              <View style={extra.statusRow}>
                <Feather name="clock" size={13} color={colors.mutedForeground} />
                <Text style={extra.statusText}>
                  Ultimo controllo: {formatDateTime(folderState.lastScanAt)}
                  {folderState.lastScanTrigger
                    ? ` (${triggerLabel(folderState.lastScanTrigger)})`
                    : ''}
                  {typeof folderState.lastUploadedCount === 'number'
                    ? ` · ${folderState.lastUploadedCount} inviati`
                    : ''}
                </Text>
              </View>
              <View style={extra.statusRow}>
                <Feather name="calendar" size={13} color={colors.mutedForeground} />
                <Text style={extra.statusText}>
                  Prossimo controllo: {folderState.enabled ? nextRunLabel : 'backup automatico spento'}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.scheduleRow}>
            <View style={styles.scheduleCopy}>
              <Text style={styles.intervalLabel}>Controllo giornaliero alle</Text>
              <Text style={styles.scheduleHint}>formato 24 ore</Text>
            </View>
            <TextInput
              testID="schedule-time-input"
              value={scheduleTime}
              onChangeText={updateScheduleTime}
              placeholder="03:00"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy && isReady}
              style={styles.scheduleInput}
            />
          </View>

          <View style={styles.automationFooter}>
            <View style={styles.lastScanCopy}>
              <Feather name="shield" size={14} color={colors.mutedForeground} />
              <Text style={styles.lastScanText} numberOfLines={1}>
                {folderState.lastBackgroundRunAt
                  ? `Ultimo tentativo automatico: ${formatDateTime(folderState.lastBackgroundRunAt)}`
                  : 'Nessun tentativo automatico registrato'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Controlla la cartella adesso"
              testID="scan-folder"
              onPress={scanFolderNow}
              disabled={isScanning || !isReady}
              style={({ pressed }) => [
                styles.scanButton,
                pressed && styles.pressed,
                isScanning && styles.disabled,
              ]}
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="play" size={14} color={colors.primary} />
              )}
              <Text style={styles.scanButtonText}>{isScanning ? 'Controllo…' : 'Scan ora'}</Text>
            </Pressable>
          </View>

          <Text style={styles.automationHint}>
            Android non garantisce l’ora esatta: il controllo automatico può slittare di qualche
            minuto per risparmiare batteria. Se salta, l’app lo recupera appena la apri.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mostra diagnostica"
            onPress={() => setShowDiagnostics((value) => !value)}
            style={({ pressed }) => [extra.diagToggle, pressed && styles.pressed]}
          >
            <Feather name={showDiagnostics ? 'chevron-up' : 'chevron-down'} size={13} color={colors.primary} />
            <Text style={extra.diagToggleText}>Diagnostica</Text>
          </Pressable>

          {showDiagnostics ? (
            <View style={extra.diagCard}>
              <Text style={extra.diagLine}>
                Task in background registrato: {taskRegistered ? 'sì' : 'no'}
              </Text>
              <Text style={extra.diagLine}>
                Giorno già coperto: {folderState.lastScheduledDateKey || 'nessuno'}
              </Text>
              <Text style={extra.diagLine}>
                Esito ultimo tentativo: {folderState.lastBackgroundResult || '—'}
              </Text>
              <Text style={extra.diagLine}>
                Ultimo errore: {folderState.lastError || 'nessuno'}
                {folderState.lastErrorAt ? ` (${formatDateTime(folderState.lastErrorAt)})` : ''}
              </Text>
              <Text style={extra.diagLine}>
                File in memoria invii: {Object.keys(folderState.sent).length}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={resetSentHistory}
                style={({ pressed }) => [extra.diagButton, pressed && styles.pressed]}
              >
                <Feather name="rotate-ccw" size={13} color={colors.destructive} />
                <Text style={extra.diagButtonText}>Azzera memoria invii</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {Platform.OS === 'android' && batteryOptimizationEnabled === true ? (
          <View style={styles.batteryCard}>
            <View style={styles.batteryIcon}>
              <Feather name="battery-charging" size={17} color={colors.primary} />
            </View>
            <View style={styles.batteryCopy}>
              <Text style={styles.batteryTitle}>Consenti i controlli in background</Text>
              <Text style={styles.batteryText}>
                Android sta ancora ottimizzando la batteria di questa app e può bloccare il backup
                automatico. Concedi l’uso illimitato della batteria: questo avviso sparisce da solo
                quando Android conferma.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Apri le impostazioni batteria"
              testID="battery-settings"
              onPress={openBatteryOptimizationSettings}
              style={({ pressed }) => [styles.batteryButton, pressed && styles.pressed]}
            >
              <Feather name="external-link" size={15} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Destinazione</Text>
          <Text style={styles.sectionHint}>salvata sul telefono</Text>
        </View>

        <View style={styles.settingsCard}>
          <View style={styles.field}>
            <Text style={styles.label}>Token del bot</Text>
            <TextInput
              testID="bot-token-input"
              value={botToken}
              onChangeText={setBotToken}
              placeholder="123456789:AA…"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy && isReady}
              style={styles.input}
            />
            <Text style={styles.fieldHint}>
              Crea un bot con @BotFather e incolla qui il token.
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.field}>
            <Text style={styles.label}>Chat ID</Text>
            <TextInput
              testID="chat-id-input"
              value={chatId}
              onChangeText={setChatId}
              placeholder="Il tuo Chat ID privato"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy && isReady}
              style={styles.input}
            />
            <Text style={styles.fieldHint}>
              Manda prima un messaggio al bot, poi usa l’ID di quella chat.
            </Text>
          </View>
          <View style={extra.buttonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Verifica bot e chat"
              testID="check-bot"
              onPress={checkBot}
              disabled={busy || !isReady}
              style={({ pressed }) => [
                styles.checkButton,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              {isCheckingBot ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="activity" size={16} color={colors.primary} />
              )}
              <Text style={styles.checkButtonText}>
                {isCheckingBot ? 'Verifico…' : 'Verifica bot e chat'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Invia un messaggio di prova"
              onPress={sendTestMessageNow}
              disabled={busy || !isReady}
              style={({ pressed }) => [
                styles.checkButton,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Feather name="message-square" size={16} color={colors.primary} />
              <Text style={styles.checkButtonText}>Messaggio di prova</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerNote}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text style={styles.footerText}>
            Token e Chat ID restano nella memoria protetta del telefono e non sono mai scritti nel
            codice dell’app.
          </Text>
        </View>

        <View style={extra.credit}>
          <View style={extra.creditLine} />
          <Text style={extra.creditText}>made by zorawar</Text>
          <View style={extra.creditLine} />
        </View>
      </ScrollView>
    </View>
  );
}

function createExtraStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    statusList: { gap: 7, paddingHorizontal: 2 },
    statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
    statusText: {
      flex: 1,
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 15,
      fontFamily: 'Inter_500Medium',
    },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    diagToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 2,
    },
    diagToggleText: {
      color: colors.primary,
      fontSize: 11,
      fontFamily: 'Inter_600SemiBold',
    },
    diagCard: {
      gap: 5,
      padding: 12,
      borderRadius: 13,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    diagLine: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'Inter_400Regular',
    },
    diagButton: {
      marginTop: 6,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.destructive,
    },
    diagButtonText: {
      color: colors.destructive,
      fontSize: 11,
      fontFamily: 'Inter_600SemiBold',
    },
    credit: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    creditLine: { flex: 1, height: 1, backgroundColor: colors.border, opacity: 0.7 },
    creditText: {
      color: colors.mutedForeground,
      fontSize: 12,
      letterSpacing: 1.4,
      fontFamily: 'Inter_600SemiBold',
    },
  });
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <HomeScreen />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
