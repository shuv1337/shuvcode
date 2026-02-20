import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { withUniwind } from 'uniwind';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';

const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTextInput = withUniwind(TextInput);
const WTouchableOpacity = withUniwind(TouchableOpacity);
const WKeyboardAvoidingView = withUniwind(KeyboardAvoidingView);

interface ConnectScreenProps {
  serverUrl: string;
  onServerUrlChange: (url: string) => void;
  onConnect: () => void;
  connecting: boolean;
  error: string | null;
}

export function ConnectScreen({
  serverUrl,
  onServerUrlChange,
  onConnect,
  connecting,
  error,
}: ConnectScreenProps) {
  const { colors } = useTheme();

  return (
    <WView className="flex-1" style={{ backgroundColor: colors.bg }}>
      <WKeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <WView className="flex-1 justify-center px-6">
          <WView className="mb-12 items-center">
            <WView className="mb-4 h-20 w-20 items-center justify-center rounded-3xl" style={{ backgroundColor: colors.accent }}>
              <Icon name="zap" size={36} color={colors.textInverse} strokeWidth={2.5} />
            </WView>
            <WText className="mb-2 text-4xl font-semibold" style={{ color: colors.text }}>OpenPad</WText>
            <WText className="max-w-[280px] text-center text-base leading-6" style={{ color: colors.textSecondary }}>
              Connect to your OpenCode server to get started
            </WText>
          </WView>

          <WView className="w-full max-w-[440px] self-center rounded-3xl border p-4" style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}>
            <WText className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: colors.textMuted }}>Server URL</WText>
            <WTextInput
              className="rounded-2xl border px-4 py-3 text-base"
              style={{ backgroundColor: colors.bgElevated, borderColor: colors.border, color: colors.text }}
              value={serverUrl}
              onChangeText={onServerUrlChange}
              placeholder="http://192.168.1.100:9034"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!connecting}
              returnKeyType="go"
              onSubmitEditing={onConnect}
            />

            {error ? (
              <WView className="mt-3 flex-row items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: `${colors.error}20` }}>
                <Icon name="alert" size={18} color={colors.error} />
                <WText className="flex-1 text-sm" style={{ color: colors.error }}>{error}</WText>
              </WView>
            ) : null}

            <WTouchableOpacity
              className="mt-4 flex-row items-center justify-center rounded-2xl px-5 py-3"
              style={{ backgroundColor: colors.accent, opacity: connecting ? 0.6 : 1 }}
              onPress={onConnect}
              disabled={connecting}
              activeOpacity={0.85}
            >
              {connecting ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <>
                  <Icon name="wifi" size={20} color={colors.textInverse} />
                  <WText className="ml-2 text-base font-semibold" style={{ color: colors.textInverse }}>Connect</WText>
                </>
              )}
            </WTouchableOpacity>
          </WView>

          <WView className="mt-8 items-center gap-3">
            <WView className="flex-row items-center gap-2">
              <WView className="h-2 w-2 rounded-full" style={{ backgroundColor: connecting ? colors.warning : colors.textMuted }} />
              <WText className="text-xs" style={{ color: colors.textSecondary }}>
                {connecting ? 'Connecting to server...' : 'Ready to connect'}
              </WText>
            </WView>
            <WView className="w-full max-w-[440px] rounded-xl px-3 py-2" style={{ backgroundColor: colors.bgCard }}>
              <WText className="text-center text-xs" style={{ color: colors.textMuted }}>opencode serve --port 9034 --hostname "0.0.0.0"</WText>
            </WView>
          </WView>
        </WView>
      </WKeyboardAvoidingView>
    </WView>
  );
}
