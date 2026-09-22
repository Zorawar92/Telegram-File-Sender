import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

const TOKEN_KEY = 'telegram-file-sender.bot-token';
const CHAT_ID_KEY = 'telegram-file-sender.chat-id';

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

function uploadDocument(
  botToken: string,
  chatId: string,
  file: SelectedFile,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append(
      'document',
      {
        uri: file.uri,
        name: file.name || 'file',
        type: file.mimeType || 'application/octet-stream',
      } as unknown as Blob,
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
  const [isReady, setIsReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      readSetting(TOKEN_KEY),
      readSetting(CHAT_ID_KEY),
    ])
      .then(([savedToken, savedChatId]) => {
        if (!mounted) return;
        setBotToken(savedToken ?? '');
        setChatId(savedChatId ?? '');
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

  async function saveSettings() {
    await Promise.all([
      writeSetting(TOKEN_KEY, botToken.trim()),
      writeSetting(CHAT_ID_KEY, chatId.trim()),
    ]);
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

  return (
    <View style={styles.root}>
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