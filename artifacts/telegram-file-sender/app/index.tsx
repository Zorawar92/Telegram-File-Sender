import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as BackgroundTask from 'expo-background-task';
import * as Battery from 'expo-battery';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File as ExpoFile } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { useIncomingShare } from 'expo-sharing';
import * as TaskManager from 'expo-task-manager';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

const TOKEN_KEY = 'telegram-file-sender.bot-token';
const CHAT_ID_KEY = 'telegram-file-sender.chat-id';
const AUTOMATION_KEY = 'telegram-file-sender.folder-automation';
const FOLDER_TASK_NAME = 'telegram-file-sender.folder-sync';
const BACKGROUND_CHECK_MINUTES = 15;

type SelectedFile = {
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
};

type FolderAutomation = {
  enabled: boolean;
  directoryUri: string;
  directoryName: string;
  intervalMinutes: number;
  scheduleHour?: number;
  scheduleMinute?: number;
  uploaded: Record<string, number>;
  lastScanAt?: string;
  lastUploadedCount?: number;
  lastScheduledDate?: string;
  lastError?: string;
};

type UploadableFile = SelectedFile | ExpoFile;

type Notice = {
  tone: 'success' | 'error' | 'info';
  text: string;
} | null;

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return 'Size not available';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function readSetting(key: string) {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function writeSetting(key: string, value: string) {
  if (Platform.OS === 'web') {
    return AsyncStorage.setItem(key, value);
  }
  return SecureStore.setItemAsync(key, value);
}

async function getFolderAutomation() {
  const raw = await readSetting(AUTOMATION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FolderAutomation;
    return {
      ...parsed,
      intervalMinutes: BACKGROUND_CHECK_MINUTES,
      scheduleHour: parsed.scheduleHour ?? 3,
      scheduleMinute: parsed.scheduleMinute ?? 0,
    };
  } catch {
    return null;
  }
}

function formatScheduleTime(hour = 3, minute = 0) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseScheduleTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isScheduledScanDue(automation: FolderAutomation) {
  const now = new Date();
  const scheduleHour = automation.scheduleHour ?? 3;
  const scheduleMinute = automation.scheduleMinute ?? 0;
  const isAfterSchedule =
    now.getHours() > scheduleHour ||
    (now.getHours() === scheduleHour && now.getMinutes() >= scheduleMinute);
  return (
    isAfterSchedule &&
    automation.lastScheduledDate !== getLocalDateKey(now)
  );
}

function getFileType(file: UploadableFile) {
  if (file instanceof ExpoFile) return file.type || 'application/octet-stream';
  return file.mimeType || 'application/octet-stream';
}

function getFileName(file: UploadableFile) {
  return file instanceof ExpoFile ? file.name : file.name || 'file';
}

function uploadDocument(
  botToken: string,
  chatId: string,
  file: UploadableFile,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append(
      'document',
      file instanceof ExpoFile
        ? (file as unknown as Blob)
        : ({
            uri: file.uri,
            name: getFileName(file),
            type: getFileType(file),
          } as unknown as Blob),
    );

    const request = new XMLHttpRequest();
    request.open(
      'POST',
      `https://api.telegram.org/bot${botToken}/sendDocument`,
    );
    request.timeout = 120000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    request.onload = () => {
      try {
        const payload = JSON.parse(request.responseText) as {
          ok?: boolean;
          description?: string;
        };
        if (request.status >= 200 && request.status < 300 && payload.ok) {
          onProgress(1);
          resolve();
          return;
        }
        reject(
          new Error(
            payload.description || `Telegram returned HTTP ${request.status}.`,
          ),
        );
      } catch {
        reject(new Error('Telegram returned an unreadable response.'));
      }
    };
    request.onerror = () =>
      reject(new Error('Could not reach Telegram. Check your connection.'));
    request.ontimeout = () =>
      reject(new Error('The upload took too long and timed out.'));
    request.send(formData);
  });
}

async function scanAndUploadFolder(markAsScheduled = false) {
  const automation = await getFolderAutomation();
  if (!automation?.enabled || !automation.directoryUri) return 0;

  const botToken = await readSetting(TOKEN_KEY);
  const chatId = await readSetting(CHAT_ID_KEY);
  if (!botToken?.trim() || !chatId?.trim()) {
    throw new Error('Add your bot token and chat ID before enabling automation.');
  }

  const directory = new Directory(automation.directoryUri);
  const entries = directory.list();
  const files = entries.filter(
    (entry): entry is ExpoFile => entry instanceof ExpoFile,
  );
  const uploaded = { ...automation.uploaded };
  let uploadedCount = 0;

  for (const file of files) {
    const fingerprint = `${file.uri}:${file.size}:${file.lastModified ?? ''}`;
    if (uploaded[fingerprint]) continue;
    await uploadDocument(botToken.trim(), chatId.trim(), file, () => {});
    uploaded[fingerprint] = Date.now();
    uploadedCount += 1;
  }

  await writeSetting(
    AUTOMATION_KEY,
    JSON.stringify({
      ...automation,
      uploaded: Object.fromEntries(Object.entries(uploaded).slice(-500)),
      lastScanAt: new Date().toISOString(),
      lastUploadedCount: uploadedCount,
      lastScheduledDate: markAsScheduled
        ? getLocalDateKey(new Date())
        : automation.lastScheduledDate,
      lastError: undefined,
    }),
  );
  return uploadedCount;
}

if (!TaskManager.isTaskDefined(FOLDER_TASK_NAME)) {
  TaskManager.defineTask(FOLDER_TASK_NAME, async () => {
    try {
      const automation = await getFolderAutomation();
      if (automation && isScheduledScanDue(automation)) {
        await scanAndUploadFolder(true);
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      const automation = await getFolderAutomation();
      if (automation) {
        await writeSetting(
          AUTOMATION_KEY,
          JSON.stringify({
            ...automation,
            lastError:
              error instanceof Error ? error.message : 'Automatic scan failed.',
          }),
        );
      }
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

function IncomingShareBridge({
  onFileShared,
}: {
  onFileShared: (file: SelectedFile, multiple: boolean) => void;
}) {
  const {
    resolvedSharedPayloads,
    isResolving,
    clearSharedPayloads,
  } = useIncomingShare();

  useEffect(() => {
    if (isResolving || resolvedSharedPayloads.length === 0) return;
    const shared = resolvedSharedPayloads.find(
      (payload) => 'contentUri' in payload && Boolean(payload.contentUri),
    );
    if (!shared || !('contentUri' in shared) || !shared.contentUri) return;

    let sharedName = shared.originalName || 'Shared file';
    try {
      sharedName = decodeURIComponent(sharedName);
    } catch {
      // Keep the original name if the provider returned an encoded value.
    }
    onFileShared(
      {
        name: sharedName,
        uri: shared.contentUri,
        size: shared.contentSize ?? undefined,
        mimeType: shared.contentMimeType ?? shared.mimeType,
      },
      resolvedSharedPayloads.length > 1,
    );
    clearSharedPayloads();
  }, [
    clearSharedPayloads,
    isResolving,
    onFileShared,
    resolvedSharedPayloads,
  ]);

  return null;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isDark = colors.background === '#071522';
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isCheckingBot, setIsCheckingBot] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [automation, setAutomation] = useState<FolderAutomation | null>(null);
  const [scheduleTime, setScheduleTime] = useState('03:00');
  const [batteryOptimizationEnabled, setBatteryOptimizationEnabled] = useState<
    boolean | null
  >(null);
  const [isReady, setIsReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function refreshBatteryOptimization() {
    if (Platform.OS !== 'android') {
      setBatteryOptimizationEnabled(null);
      return;
    }
    try {
      setBatteryOptimizationEnabled(
        await Battery.isBatteryOptimizationEnabledAsync(),
      );
    } catch {
      setBatteryOptimizationEnabled(null);
    }
  }

  useEffect(() => {
    let mounted = true;
    Promise.all([
      readSetting(TOKEN_KEY),
      readSetting(CHAT_ID_KEY),
      getFolderAutomation(),
    ])
      .then(([savedToken, savedChatId, savedAutomation]) => {
        if (!mounted) return;
        setBotToken(savedToken ?? '');
        setChatId(savedChatId ?? '');
        setAutomation(savedAutomation);
        setScheduleTime(
          formatScheduleTime(
            savedAutomation?.scheduleHour,
            savedAutomation?.scheduleMinute,
          ),
        );
      })
      .catch(() => {
        if (mounted) {
          setNotice({
            tone: 'error',
            text: 'Could not load saved settings from this device.',
          });
        }
      })
      .finally(() => {
        if (mounted) setIsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    refreshBatteryOptimization();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshBatteryOptimization();
      }
    });
    return () => subscription.remove();
  }, []);

  async function saveSettings() {
    await Promise.all([
      writeSetting(TOKEN_KEY, botToken.trim()),
      writeSetting(CHAT_ID_KEY, chatId.trim()),
    ]);
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
          text: 'Battery settings could not be opened. Open this app’s battery settings manually.',
        });
      }
    } finally {
      await refreshBatteryOptimization();
    }
  }

  async function pickFolder() {
    setNotice(null);
    if (Platform.OS !== 'android') {
      setNotice({
        tone: 'info',
        text: 'Folder automation is available in the installable Android build.',
      });
      return;
    }
    try {
      const directory = await Directory.pickDirectoryAsync(
        automation?.directoryUri,
      );
      const nextAutomation: FolderAutomation = {
        enabled: false,
        directoryUri: directory.uri,
        directoryName: directory.name || 'Selected folder',
        intervalMinutes: BACKGROUND_CHECK_MINUTES,
        scheduleHour: automation?.scheduleHour ?? 3,
        scheduleMinute: automation?.scheduleMinute ?? 0,
        uploaded: automation?.uploaded ?? {},
        lastScanAt: automation?.lastScanAt,
        lastUploadedCount: automation?.lastUploadedCount,
        lastScheduledDate: automation?.lastScheduledDate,
      };
      setAutomation(nextAutomation);
      setScheduleTime(
        formatScheduleTime(nextAutomation.scheduleHour, nextAutomation.scheduleMinute),
      );
      await writeSetting(AUTOMATION_KEY, JSON.stringify(nextAutomation));
      setNotice({
        tone: 'success',
        text: `Folder selected: ${nextAutomation.directoryName}.`,
      });
      await Haptics.selectionAsync();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('cancel')) {
        return;
      }
      setNotice({
        tone: 'error',
        text: 'The folder could not be selected. Please try again.',
      });
    }
  }

  async function setAutomationEnabled(enabled: boolean) {
    setNotice(null);
    if (Platform.OS !== 'android') {
      setNotice({
        tone: 'info',
        text: 'Automatic folder checks require an installable Android build.',
      });
      return;
    }
    if (!automation?.directoryUri) {
      setNotice({ tone: 'error', text: 'Choose a folder before enabling automation.' });
      return;
    }
    if (enabled && (!botToken.trim() || !chatId.trim())) {
      setNotice({
        tone: 'error',
        text: 'Add your bot token and chat ID before enabling automation.',
      });
      return;
    }
    const parsedSchedule = parseScheduleTime(scheduleTime);
    if (enabled && !parsedSchedule) {
      setNotice({
        tone: 'error',
        text: 'Choose a valid daily time in 24-hour format, such as 03:00.',
      });
      return;
    }

    try {
      await saveSettings();
      const scheduledAutomation: FolderAutomation = {
        ...automation,
        intervalMinutes: BACKGROUND_CHECK_MINUTES,
        scheduleHour: parsedSchedule?.hour ?? automation.scheduleHour ?? 3,
        scheduleMinute: parsedSchedule?.minute ?? automation.scheduleMinute ?? 0,
      };
      if (enabled) {
        const available = await TaskManager.isAvailableAsync();
        if (!available) {
          throw new Error(
            'Background checks are unavailable here. Install the Android build instead of using Expo Go.',
          );
        }
        if (await TaskManager.isTaskRegisteredAsync(FOLDER_TASK_NAME)) {
          await BackgroundTask.unregisterTaskAsync(FOLDER_TASK_NAME);
        }
        await BackgroundTask.registerTaskAsync(FOLDER_TASK_NAME, {
          minimumInterval: BACKGROUND_CHECK_MINUTES,
        });
      } else if (await TaskManager.isTaskRegisteredAsync(FOLDER_TASK_NAME)) {
        await BackgroundTask.unregisterTaskAsync(FOLDER_TASK_NAME);
      }
      const nextAutomation = { ...scheduledAutomation, enabled };
      setAutomation(nextAutomation);
      await writeSetting(AUTOMATION_KEY, JSON.stringify(nextAutomation));
      setNotice({
        tone: 'success',
        text: enabled
          ? 'Automatic folder checks are enabled.'
          : 'Automatic folder checks are paused.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not update automatic folder checks.',
      });
    }
  }

  async function updateScheduleTime(value: string) {
    setScheduleTime(value);
    const parsedSchedule = parseScheduleTime(value);
    if (!parsedSchedule || !automation) return;
    const nextAutomation: FolderAutomation = {
      ...automation,
      scheduleHour: parsedSchedule.hour,
      scheduleMinute: parsedSchedule.minute,
    };
    setAutomation(nextAutomation);
    await writeSetting(AUTOMATION_KEY, JSON.stringify(nextAutomation));
  }

  async function scanFolderNow() {
    if (!automation?.directoryUri) {
      setNotice({ tone: 'error', text: 'Choose a folder before scanning.' });
      return;
    }
    setIsScanning(true);
    setNotice(null);
    try {
      await saveSettings();
      const count = await scanAndUploadFolder();
      setAutomation(await getFolderAutomation());
      setNotice({
        tone: 'success',
        text: count
          ? `${count} new file${count === 1 ? '' : 's'} sent to Telegram.`
          : 'No new files found in the selected folder.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'The folder scan failed.',
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
      setNotice({
        tone: 'error',
        text: 'The file picker could not open. Please try again.',
      });
    }
  }

  async function checkBot() {
    Keyboard.dismiss();
    setNotice(null);
    if (!botToken.trim()) {
      setNotice({ tone: 'error', text: 'Enter your bot token first.' });
      return;
    }
    setIsCheckingBot(true);
    try {
      await saveSettings();
      const response = await fetch(
        `https://api.telegram.org/bot${botToken.trim()}/getMe`,
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: { username?: string; first_name?: string };
        description?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.description || 'Telegram rejected this token.');
      }
      const label = payload.result?.username
        ? `@${payload.result.username}`
        : payload.result?.first_name || 'your bot';
      setNotice({ tone: 'success', text: `Connected to ${label}.` });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not check the bot.',
      });
    } finally {
      setIsCheckingBot(false);
    }
  }

  async function sendFile() {
    Keyboard.dismiss();
    setNotice(null);
    if (!file) {
      setNotice({ tone: 'error', text: 'Choose a file before sending.' });
      return;
    }
    if (!botToken.trim() || !chatId.trim()) {
      setNotice({
        tone: 'error',
        text: 'Add both your bot token and chat ID before sending.',
      });
      return;
    }
    setIsUploading(true);
    setProgress(0);
    try {
      await saveSettings();
      await uploadDocument(
        botToken.trim(),
        chatId.trim(),
        file,
        setProgress,
      );
      setNotice({ tone: 'success', text: `${file.name} was sent to Telegram.` });
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      setNotice({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'The file could not be sent.',
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploading(false);
    }
  }

  const handleIncomingSharedFile = useCallback(
    (sharedFile: SelectedFile, multiple: boolean) => {
      setFile(sharedFile);
      setProgress(0);
      setNotice({
        tone: 'info',
        text: multiple
          ? `${sharedFile.name} was shared. This app sends one file at a time.`
          : `${sharedFile.name} is ready to send.`,
      });
    },
    [],
  );

  return (
    <View style={styles.root}>
      {Platform.OS === 'android' ? (
        <IncomingShareBridge onFileShared={handleIncomingSharedFile} />
      ) : null}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 18,
            paddingBottom: Math.max(insets.bottom + 24, Platform.OS === 'web' ? 34 : 24),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Feather name="send" size={21} color={colors.primaryForeground} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>PRIVATE TRANSFER</Text>
            <Text style={styles.title}>Send to Telegram</Text>
          </View>
          <View style={styles.lockBadge}>
            <Feather name="lock" size={14} color={colors.accentForeground} />
          </View>
        </View>

        <Text style={styles.subtitle}>
          Pick any file and deliver it straight to your saved Telegram chat.
        </Text>

        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <View style={styles.heroIcon}>
            <Feather name="upload-cloud" size={30} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Ready when you are</Text>
          <Text style={styles.heroText}>
            Your file goes directly from this phone to Telegram. Nothing is
            uploaded to a middleman.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a file"
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
              {file ? 'Choose a different file' : 'Choose a file'}
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
                {formatBytes(file.size)} · {file.mimeType || 'Unknown type'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove selected file"
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Folder automation</Text>
          <Text style={styles.sectionHint}>Android only</Text>
        </View>

        <View style={styles.automationCard}>
          <View style={styles.automationHeader}>
            <View style={styles.automationIcon}>
              <Feather name="refresh-cw" size={18} color={colors.primary} />
            </View>
            <View style={styles.automationCopy}>
              <Text style={styles.automationTitle}>Watch for new files</Text>
              <Text style={styles.automationText}>
                The app checks one folder in the background and sends files it
                has not sent before.
              </Text>
            </View>
            <Switch
              testID="automation-toggle"
              value={automation?.enabled ?? false}
              onValueChange={setAutomationEnabled}
              disabled={Platform.OS !== 'android' || isScanning || !isReady}
              trackColor={{ false: colors.muted, true: colors.accent }}
              thumbColor={
                automation?.enabled ? colors.primary : colors.mutedForeground
              }
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose folder to watch"
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
              {automation?.directoryName || 'Choose a folder to watch'}
            </Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>

          <View style={styles.scheduleRow}>
            <View style={styles.scheduleCopy}>
              <Text style={styles.intervalLabel}>Run once a day at</Text>
              <Text style={styles.scheduleHint}>24-hour time</Text>
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
              editable={!isScanning && isReady}
              style={styles.scheduleInput}
            />
          </View>

          <View style={styles.automationFooter}>
            <View style={styles.lastScanCopy}>
              <Feather name="clock" size={14} color={colors.mutedForeground} />
              <Text style={styles.lastScanText} numberOfLines={1}>
                {automation?.lastScanAt
                  ? `Last scan ${new Date(automation.lastScanAt).toLocaleString()}`
                  : 'No folder scan yet'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan folder now"
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
              <Text style={styles.scanButtonText}>
                {isScanning ? 'Scanning…' : 'Scan now'}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.automationHint}>
            {Platform.OS !== 'android'
              ? 'Folder access and daily background checks become available in the installable Android build. Android decides the exact run time to protect battery life.'
              : 'Android checks near this time once per day and only runs while it is scanning or uploading. It does not stay active all day.'}
          </Text>
        </View>

        {Platform.OS === 'android' && batteryOptimizationEnabled === true ? (
          <View style={styles.batteryCard}>
            <View style={styles.batteryIcon}>
              <Feather name="battery-charging" size={17} color={colors.primary} />
            </View>
            <View style={styles.batteryCopy}>
              <Text style={styles.batteryTitle}>Allow background uploads</Text>
              <Text style={styles.batteryText}>
                Android is still optimizing this app’s battery use. Allow
                unrestricted battery use so the daily check can run. This
                reminder disappears automatically after Android confirms it.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open battery optimization settings"
              testID="battery-settings"
              onPress={openBatteryOptimizationSettings}
              style={({ pressed }) => [
                styles.batteryButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="external-link" size={15} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Destination</Text>
          <Text style={styles.sectionHint}>Saved securely on this phone</Text>
        </View>

        <View style={styles.settingsCard}>
          <View style={styles.field}>
            <Text style={styles.label}>Bot token</Text>
            <TextInput
              testID="bot-token-input"
              value={botToken}
              onChangeText={setBotToken}
              placeholder="123456789:AA..."
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isUploading && isReady}
              style={styles.input}
            />
            <Text style={styles.fieldHint}>
              Create a bot with @BotFather, then paste its token here.
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.field}>
            <Text style={styles.label}>Chat ID</Text>
            <TextInput
              testID="chat-id-input"
              value={chatId}
              onChangeText={setChatId}
              placeholder="Your private chat ID"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isUploading && isReady}
              style={styles.input}
            />
            <Text style={styles.fieldHint}>
              Send your bot a message first, then use the chat ID for that chat.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check Telegram bot connection"
            testID="check-bot"
            onPress={checkBot}
            disabled={isCheckingBot || isUploading || !isReady}
            style={({ pressed }) => [
              styles.checkButton,
              pressed && styles.pressed,
              (isCheckingBot || isUploading) && styles.disabled,
            ]}
          >
            {isCheckingBot ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="activity" size={16} color={colors.primary} />
            )}
            <Text style={styles.checkButtonText}>
              {isCheckingBot ? 'Checking…' : 'Check bot connection'}
            </Text>
          </Pressable>
        </View>

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
                notice.tone === 'success'
                  ? 'check-circle'
                  : notice.tone === 'error'
                    ? 'alert-circle'
                    : 'info'
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

        {isUploading ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressLabels}>
              <Text style={styles.progressLabel}>Sending file</Text>
              <Text style={styles.progressPercent}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(progress * 100, 2)}%` }]} />
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send file to Telegram"
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
            {isUploading ? 'Sending…' : 'Send file'}
          </Text>
        </Pressable>

        <View style={styles.footerNote}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text style={styles.footerText}>
            Bot credentials are stored in the phone’s secure storage and never
            saved in the app project.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

type Palette = ReturnType<typeof useColors>;

function createStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingHorizontal: 20, gap: 16 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    brandMark: {
      width: 44,
      height: 44,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      transform: [{ rotate: '-8deg' }],
    },
    headerCopy: { flex: 1, gap: 2 },
    eyebrow: {
      color: colors.primary,
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      letterSpacing: 1.6,
    },
    title: {
      color: colors.foreground,
      fontSize: 26,
      lineHeight: 31,
      fontFamily: 'Inter_700Bold',
      letterSpacing: -0.6,
    },
    lockBadge: {
      width: 32,
      height: 32,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    subtitle: {
      color: colors.mutedForeground,
      fontSize: 15,
      lineHeight: 22,
      fontFamily: 'Inter_400Regular',
      maxWidth: 360,
    },
    heroCard: {
      overflow: 'hidden',
      borderRadius: 24,
      padding: 24,
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    heroGlow: {
      position: 'absolute',
      width: 180,
      height: 180,
      borderRadius: 90,
      top: -95,
      right: -58,
      backgroundColor: colors.secondary,
      opacity: 0.8,
    },
    heroIcon: {
      width: 64,
      height: 64,
      borderRadius: 22,
      marginBottom: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondary,
    },
    heroTitle: {
      color: colors.cardForeground,
      fontSize: 19,
      fontFamily: 'Inter_700Bold',
    },
    heroText: {
      color: colors.mutedForeground,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      fontFamily: 'Inter_400Regular',
      maxWidth: 285,
      marginTop: 8,
      marginBottom: 20,
    },
    chooseButton: {
      minHeight: 48,
      paddingHorizontal: 18,
      borderRadius: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: colors.primary,
    },
    chooseButtonText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
    },
    fileCard: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 13,
      borderRadius: 18,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    fileIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    fileDetails: { flex: 1, gap: 4 },
    fileName: {
      color: colors.foreground,
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
    },
    fileMeta: {
      color: colors.mutedForeground,
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
    },
    removeButton: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    automationCard: {
      padding: 16,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    automationHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 11,
    },
    automationIcon: {
      width: 40,
      height: 40,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondary,
    },
    automationCopy: { flex: 1, gap: 4 },
    automationTitle: {
      color: colors.cardForeground,
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
    },
    automationText: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'Inter_400Regular',
    },
    folderButton: {
      minHeight: 46,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: 13,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.input,
    },
    folderButtonText: {
      flex: 1,
      color: colors.foreground,
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
    },
    scheduleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    scheduleCopy: { flex: 1, gap: 3 },
    scheduleHint: {
      color: colors.mutedForeground,
      fontSize: 10,
      fontFamily: 'Inter_400Regular',
    },
    scheduleInput: {
      width: 78,
      minHeight: 42,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.input,
      backgroundColor: colors.background,
      color: colors.foreground,
      textAlign: 'center',
      fontSize: 15,
      fontFamily: 'Inter_700Bold',
    },
    intervalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    intervalLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontFamily: 'Inter_500Medium',
    },
    intervalOptions: { flexDirection: 'row', gap: 6 },
    intervalOption: {
      minWidth: 42,
      minHeight: 32,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: colors.muted,
    },
    intervalOptionActive: {
      backgroundColor: colors.primary,
    },
    intervalOptionText: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
    },
    intervalOptionTextActive: {
      color: colors.primaryForeground,
    },
    automationFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    lastScanCopy: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    lastScanText: {
      flex: 1,
      color: colors.mutedForeground,
      fontSize: 10,
      fontFamily: 'Inter_400Regular',
    },
    scanButton: {
      minHeight: 34,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 10,
      backgroundColor: colors.secondary,
    },
    scanButtonText: {
      color: colors.secondaryForeground,
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
    },
    automationHint: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'Inter_400Regular',
    },
    batteryCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 13,
      borderRadius: 16,
      backgroundColor: colors.accent,
      borderWidth: 1,
      borderColor: colors.success,
    },
    batteryIcon: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    batteryCopy: { flex: 1, gap: 4 },
    batteryTitle: {
      color: colors.cardForeground,
      fontSize: 12,
      fontFamily: 'Inter_700Bold',
    },
    batteryText: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'Inter_400Regular',
    },
    batteryButton: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    sectionTitle: {
      color: colors.foreground,
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
    },
    sectionHint: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontFamily: 'Inter_500Medium',
    },
    settingsCard: {
      padding: 17,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    field: { gap: 7 },
    label: {
      color: colors.cardForeground,
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
    },
    input: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.input,
      backgroundColor: colors.background,
      color: colors.foreground,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
    fieldHint: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'Inter_400Regular',
    },
    divider: { height: 1, backgroundColor: colors.border },
    checkButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 36,
      paddingHorizontal: 11,
      borderRadius: 11,
      backgroundColor: colors.secondary,
    },
    checkButtonText: {
      color: colors.secondaryForeground,
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
    },
    notice: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 13,
      borderRadius: 14,
      borderWidth: 1,
    },
    successNotice: {
      backgroundColor: colors.accent,
      borderColor: colors.success,
    },
    errorNotice: {
      backgroundColor: colors.destructive + '12',
      borderColor: colors.destructive,
    },
    infoNotice: {
      backgroundColor: colors.secondary,
      borderColor: colors.primary,
    },
    noticeText: {
      flex: 1,
      color: colors.foreground,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: 'Inter_500Medium',
    },
    progressBlock: { gap: 8, paddingHorizontal: 2 },
    progressLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    progressLabel: {
      color: colors.foreground,
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
    },
    progressPercent: {
      color: colors.primary,
      fontSize: 12,
      fontFamily: 'Inter_700Bold',
    },
    progressTrack: {
      height: 7,
      overflow: 'hidden',
      borderRadius: 4,
      backgroundColor: colors.muted,
    },
    progressFill: {
      height: '100%',
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    sendButton: {
      minHeight: 56,
      borderRadius: 17,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: colors.primary,
    },
    sendButtonText: {
      color: colors.primaryForeground,
      fontSize: 15,
      fontFamily: 'Inter_700Bold',
    },
    footerNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingHorizontal: 4,
      paddingTop: 2,
    },
    footerText: {
      flex: 1,
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'Inter_400Regular',
    },
    pressed: { opacity: 0.78 },
    disabled: { opacity: 0.5 },
  });
}