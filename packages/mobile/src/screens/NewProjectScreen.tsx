import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';

const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTextInput = withUniwind(TextInput);
const WTouchableOpacity = withUniwind(TouchableOpacity);
const WScrollView = withUniwind(ScrollView);
const WKeyboardAvoidingView = withUniwind(KeyboardAvoidingView);

type ProjectCreationMode = 'directory' | 'clone';

interface NewProjectScreenProps {
  onBack: () => void;
  onSelectDirectory: (path: string) => void;
  onCloneRepository: (url: string, path?: string) => void;
}

export function NewProjectScreen({ onBack, onSelectDirectory, onCloneRepository }: NewProjectScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ProjectCreationMode>('directory');
  const [directory, setDirectory] = useState('');
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');

  const disabled = mode === 'directory' ? !directory.trim() : !url.trim();

  const submit = () => {
    if (mode === 'directory' && directory.trim()) {
      onSelectDirectory(directory.trim());
      return;
    }
    if (mode === 'clone' && url.trim()) {
      onCloneRepository(url.trim(), path.trim() || undefined);
    }
  };

  return (
    <WKeyboardAvoidingView className="flex-1 justify-end" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <WTouchableOpacity className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.28)' }} activeOpacity={1} onPress={onBack} />
      <WView
        className="mb-3 max-h-[82%] overflow-hidden"
        style={{
          backgroundColor: colors.bg,
          marginHorizontal: 10,
          borderRadius: 28,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        }}
      >
        <WView className="px-5 pb-3 pt-4">
          <WText className="text-4xl font-semibold" style={{ color: colors.text }}>New Project</WText>
          <WText className="mt-1 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>open or clone</WText>
        </WView>

        <WScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <WView className="mb-6 flex-row gap-3">
            <WTouchableOpacity
              className="flex-1 items-center rounded-2xl border px-3 py-5"
              style={{
                backgroundColor: mode === 'directory' ? `${colors.accent}16` : colors.bgCard,
                borderColor: mode === 'directory' ? colors.accent : colors.border,
              }}
              onPress={() => setMode('directory')}
            >
              <Icon name="folder-open" size={22} color={mode === 'directory' ? colors.accent : colors.textSecondary} />
              <WText className="mt-2 text-sm font-medium" style={{ color: mode === 'directory' ? colors.accent : colors.textSecondary }}>Open Directory</WText>
            </WTouchableOpacity>

            <WTouchableOpacity
              className="flex-1 items-center rounded-2xl border px-3 py-5"
              style={{
                backgroundColor: mode === 'clone' ? `${colors.accent}16` : colors.bgCard,
                borderColor: mode === 'clone' ? colors.accent : colors.border,
              }}
              onPress={() => setMode('clone')}
            >
              <Icon name="git-branch" size={22} color={mode === 'clone' ? colors.accent : colors.textSecondary} />
              <WText className="mt-2 text-sm font-medium" style={{ color: mode === 'clone' ? colors.accent : colors.textSecondary }}>Clone Repo</WText>
            </WTouchableOpacity>
          </WView>

          {mode === 'directory' ? (
            <WView className="rounded-2xl border p-4" style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}>
              <WText className="mb-2 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>Directory Path</WText>
              <WTextInput
                className="rounded-xl border px-3 py-3 text-base"
                style={{ backgroundColor: colors.bgElevated, borderColor: colors.border, color: colors.text }}
                value={directory}
                onChangeText={setDirectory}
                placeholder="/path/to/project"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <WText className="mt-2 text-xs" style={{ color: colors.textSecondary }}>Enter a full path to an existing project directory.</WText>
            </WView>
          ) : (
            <WView className="rounded-2xl border p-4" style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}>
              <WText className="mb-2 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>Repository URL</WText>
              <WTextInput
                className="rounded-xl border px-3 py-3 text-base"
                style={{ backgroundColor: colors.bgElevated, borderColor: colors.border, color: colors.text }}
                value={url}
                onChangeText={setUrl}
                placeholder="https://github.com/user/repo.git"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              <WText className="mb-2 mt-4 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>Clone To (optional)</WText>
              <WTextInput
                className="rounded-xl border px-3 py-3 text-base"
                style={{ backgroundColor: colors.bgElevated, borderColor: colors.border, color: colors.text }}
                value={path}
                onChangeText={setPath}
                placeholder="~/Projects/repo"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <WText className="mt-2 text-xs" style={{ color: colors.textSecondary }}>Leave empty to use the default location.</WText>
            </WView>
          )}
        </WScrollView>

        <WView className="border-t px-4 pt-4" style={{ borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) + 10 }}>
          <WTouchableOpacity
            className="flex-row items-center justify-center rounded-full px-5 py-3"
            style={{ backgroundColor: colors.accent, opacity: disabled ? 0.5 : 1 }}
            disabled={disabled}
            onPress={submit}
          >
            <Icon name={mode === 'directory' ? 'folder-open' : 'download'} size={18} color={colors.textInverse} />
            <WText className="ml-2 text-sm font-semibold" style={{ color: colors.textInverse }}>
              {mode === 'directory' ? 'Open Project' : 'Clone Repository'}
            </WText>
          </WTouchableOpacity>
        </WView>
      </WView>
    </WKeyboardAvoidingView>
  );
}
