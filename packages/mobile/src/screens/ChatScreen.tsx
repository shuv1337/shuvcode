import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/ui/EmptyState';
import { MessageBlock } from '../components/chat/MessageBlock';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { MessageWithParts, PromptAttachment, ProviderModel, Session } from '../providers/OpenCodeProvider';

const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTouchableOpacity = withUniwind(TouchableOpacity);
const WKeyboardAvoidingView = withUniwind(KeyboardAvoidingView);
const WTextInput = withUniwind(TextInput);
const WScrollView = withUniwind(ScrollView);
const WImage = withUniwind(Image);

interface ChatScreenProps {
  session: Session;
  messages: MessageWithParts[];
  loading: boolean;
  serverUrl: string;
  error?: string | null;
  models: ProviderModel[];
  modes: string[];
  branches: Session[];
  recentModelKeys: string[];
  selectedModel: string | null;
  onSelectModel: (modelKey: string) => void;
  onBack: () => void;
  onSendMessage: (
    text: string,
    model?: { providerID: string; modelID: string },
    mode?: string,
    attachments?: PromptAttachment[],
  ) => Promise<boolean>;
  onCreateBranch: () => void;
  onOpenBranch: (sessionId: string) => void;
  isSending: boolean;
}

export function ChatScreen({
  session,
  messages,
  loading,
  serverUrl,
  error,
  models,
  modes,
  branches,
  recentModelKeys,
  selectedModel,
  onSelectModel,
  onBack,
  onSendMessage,
  onCreateBranch,
  onOpenBranch,
  isSending,
}: ChatScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedMode, setSelectedMode] = useState('');
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const flatListRef = useRef<FlatList<MessageWithParts>>(null);
  const atBottomRef = useRef(true);

  React.useEffect(() => {
    if (!modes.length) return;
    setSelectedMode((prev) => (prev && modes.includes(prev) ? prev : modes[0]));
  }, [modes]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const selectedModelObj = useMemo(() => {
    if (!selectedModel) return undefined;
    const model = models.find((item) => `${item.providerID}/${item.id}` === selectedModel);
    if (!model) return undefined;
    return { providerID: model.providerID, modelID: model.id };
  }, [selectedModel, models]);

  const selectedModelLabel = useMemo(() => {
    if (!selectedModel) return 'Server Default';
    const model = models.find((item) => `${item.providerID}/${item.id}` === selectedModel);
    return model?.name || selectedModel.split('/').pop() || 'Server Default';
  }, [selectedModel, models]);

  const selectedModelVendor = useMemo(() => {
    if (!selectedModel) return '';
    const model = models.find((item) => `${item.providerID}/${item.id}` === selectedModel);
    return model?.providerName || model?.providerID || '';
  }, [selectedModel, models]);

  const handleSend = useCallback(async () => {
    if ((!inputText.trim() && !attachments.length) || isSending) return;
    const text = inputText.trim();
    const files = attachments;
    setInputText('');
    setAttachments([]);
    const ok = await onSendMessage(text, selectedModelObj, selectedMode || undefined, files);
    if (ok) return;
    setInputText(text);
    setAttachments(files);
  }, [inputText, attachments, isSending, onSendMessage, selectedModelObj, selectedMode]);

  const handleAttach = useCallback(async () => {
    if (isSending) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    if (!asset.uri) return;
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    }).catch(() => '');
    if (!base64) return;
    const mime = asset.mimeType || (asset.fileName?.toLowerCase().endsWith('.heic') ? 'image/heic' : 'image/jpeg');
    const ext = mime.split('/')[1] || 'jpg';
    setAttachments((prev) => [
      ...prev,
      {
        mime,
        url: `data:${mime};base64,${base64}`,
        filename: asset.fileName || `image.${ext}`,
      },
    ]);
  }, [isSending]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const visible = event.nativeEvent.layoutMeasurement.height;
    const total = event.nativeEvent.contentSize.height;
    const distance = total - visible - offset;
    atBottomRef.current = distance < 60;
    const shouldShow = distance > 200;
    setShowScrollButton((prev) => (prev === shouldShow ? prev : shouldShow));
  }, []);

  const scrollToLatest = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const filtered = useMemo(() => {
    const query = modelSearch.toLowerCase();
    const list = query
      ? models.filter((item) =>
          item.name.toLowerCase().includes(query) ||
          item.providerName.toLowerCase().includes(query) ||
          item.id.toLowerCase().includes(query),
        )
      : models;
    const grouped = new Map<string, ProviderModel[]>();
    for (const model of list) {
      const items = grouped.get(model.providerName) ?? [];
      items.push(model);
      grouped.set(model.providerName, items);
    }
    return { list, grouped: Array.from(grouped.entries()) };
  }, [models, modelSearch]);

  const recent = useMemo(() => {
    if (modelSearch) return [];
    return recentModelKeys
      .map((key) => models.find((item) => `${item.providerID}/${item.id}` === key))
      .filter((item): item is ProviderModel => Boolean(item));
  }, [recentModelKeys, models, modelSearch]);

  const dismissModelPicker = useCallback(() => {
    setShowModelPicker(false);
    setModelSearch('');
  }, []);

  const dismissModePicker = useCallback(() => {
    setShowModePicker(false);
  }, []);

  const dismissBranchPicker = useCallback(() => {
    setShowBranchPicker(false);
  }, []);

  const openModelPicker = useCallback(() => {
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      setShowModelPicker(true);
    });
  }, []);

  const openModePicker = useCallback(() => {
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      setShowModePicker(true);
    });
  }, []);

  const openBranchPicker = useCallback(() => {
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      setShowBranchPicker(true);
    });
  }, []);

  const keyExtractor = useCallback((item: MessageWithParts, index: number) => item.info.id || String(index), []);

  const renderMessage = useCallback(
    ({ item }: { item: MessageWithParts }) => (
      <MessageBlock
        message={item}
        colors={colors}
        serverURL={serverUrl}
        expandedReasoning={expandedReasoning}
        onToggleReasoning={(id) => {
          setExpandedReasoning((prev) => ({ ...prev, [id]: !prev[id] }));
        }}
      />
    ),
    [colors, serverUrl, expandedReasoning],
  );

  const visibleBranches = useMemo(() => {
    if (branches.length) return branches;
    return [session];
  }, [branches, session]);

  return (
    <WView className="flex-1" style={{ backgroundColor: colors.bg }}>
      <WKeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <WView className="flex-row items-center justify-between border-b px-4 pb-3" style={{ borderBottomColor: colors.border, paddingTop: insets.top + 8 }}>
          <WText className="flex-1 text-left text-base font-semibold" style={{ color: colors.text }} numberOfLines={1}>
            {session.title || 'Chat'}
          </WText>

          <WTouchableOpacity className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: colors.accentSubtle }} onPress={openBranchPicker} activeOpacity={0.8}>
            <Icon name="git-branch" size={16} color={colors.accent} />
          </WTouchableOpacity>
        </WView>

        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          onContentSizeChange={() => {
            if (!atBottomRef.current) return;
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToEnd({ animated: false });
            });
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 14, flexGrow: messages.length ? 0 : 1 }}
          ListEmptyComponent={
            <WView style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState
                icon="message-square"
                title={loading ? 'Loading...' : 'No Messages'}
                description={loading ? 'Fetching messages for this session' : 'Send a message to start this conversation'}
                accent={colors.accent}
              />
            </WView>
          }
        />

        {showScrollButton ? (
          <WView className="absolute right-3" style={{ bottom: insets.bottom + 112 }}>
            <WTouchableOpacity
              className="flex-row items-center gap-2 rounded-full border px-3.5 py-2.5"
              style={{
                backgroundColor: colors.bgCard,
                borderColor: colors.border,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
              onPress={scrollToLatest}
            >
              <WView className="h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: colors.accentSubtle }}>
                <Icon name="chevrons-down" size={14} color={colors.accent} />
              </WView>
              <WText className="text-xs font-semibold" style={{ color: colors.text }}>Latest</WText>
            </WTouchableOpacity>
          </WView>
        ) : null}

        <WView
          className="border-t px-3 pt-2"
          style={{
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 8 + (Platform.OS === 'android' ? Math.max(0, keyboardHeight - insets.bottom) + 24 : 0),
          }}
        >
          {error ? (
            <WView className="mb-2 rounded-xl px-3 py-2" style={{ backgroundColor: `${colors.error}1f` }}>
              <WText className="text-xs" style={{ color: colors.error }} numberOfLines={2}>{error}</WText>
            </WView>
          ) : null}

          {attachments.length ? (
            <WScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
              <WView className="flex-row gap-2">
                {attachments.map((item, index) => (
                  <WView key={`${item.url.slice(0, 32)}-${index}`} className="relative h-12 w-12 overflow-hidden rounded-xl border" style={{ borderColor: colors.border, backgroundColor: colors.bgCard }}>
                    <WImage className="h-12 w-12" source={{ uri: item.url }} resizeMode="cover" />
                    <WTouchableOpacity className="absolute right-0 top-0 h-5 w-5 items-center justify-center rounded-bl-lg" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => removeAttachment(index)}>
                      <Icon name="x" size={12} color="#fff" />
                    </WTouchableOpacity>
                  </WView>
                ))}
              </WView>
            </WScrollView>
          ) : null}

          <WView className="flex-row items-center rounded-2xl border px-2 py-2" style={{ borderColor: colors.border, backgroundColor: colors.bgElevated }}>
            <WTouchableOpacity
              className="h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: colors.bgHover }}
              onPress={handleAttach}
              disabled={isSending}
            >
              <Icon name="plus" size={18} color={colors.textSecondary} />
            </WTouchableOpacity>
            <WTextInput
              className="max-h-36 flex-1 px-2 py-1 text-base"
              style={{ color: colors.text }}
              placeholder="Message..."
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={10000}
              editable={!isSending}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <WTouchableOpacity
              className="ml-2 h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: (inputText.trim() || attachments.length) && !isSending ? colors.accent : colors.bgHover }}
              disabled={(!inputText.trim() && !attachments.length) || isSending}
              onPress={handleSend}
            >
              {isSending ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Icon name="arrow-up" size={18} color={inputText.trim() || attachments.length ? colors.textInverse : colors.textMuted} />}
            </WTouchableOpacity>
          </WView>

          <WView className="mt-2 flex-row items-center justify-start gap-2">
            <WTouchableOpacity className="flex-row items-center gap-1 rounded-full border px-3 py-1.5" style={{ borderColor: colors.border, backgroundColor: colors.bgCard }} onPress={openModePicker}>
              <Icon name="hash" size={12} color={colors.textSecondary} />
              <WText className="text-xs font-medium capitalize" style={{ color: colors.textSecondary }}>{selectedMode}</WText>
              <Icon name="chevron-down" size={12} color={colors.textMuted} />
            </WTouchableOpacity>

            <WTouchableOpacity className="flex-row items-center gap-1 rounded-full border px-3 py-1.5" style={{ borderColor: colors.border, backgroundColor: colors.accentSubtle }} onPress={openModelPicker}>
              <WView className="max-w-[190px] flex-row items-center">
                <WText className="text-xs font-medium" style={{ color: colors.accent }} numberOfLines={1}>{selectedModelLabel}</WText>
                {selectedModelVendor ? <WText className="ml-1 text-xs" style={{ color: colors.accentMuted }} numberOfLines={1}>{selectedModelVendor}</WText> : null}
              </WView>
              <Icon name="chevron-down" size={12} color={colors.accentMuted} />
            </WTouchableOpacity>
          </WView>
        </WView>
      </WKeyboardAvoidingView>

      {showModelPicker ? (
        <WKeyboardAvoidingView className="absolute inset-0" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <WTouchableOpacity className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} activeOpacity={1} onPress={dismissModelPicker} />
          <WView className="mb-3 max-h-[70%] px-4 pb-4 pt-3" style={{ backgroundColor: colors.bgCard, width: '95%', alignSelf: 'center', borderRadius: 28, overflow: 'hidden' }}>
            <WView className="mb-3 items-center">
              <WView className="h-1.5 w-10 rounded-full" style={{ backgroundColor: colors.textMuted }} />
            </WView>

            <WView className="mb-3">
              <WText className="text-base font-semibold" style={{ color: colors.text }}>Select Model</WText>
            </WView>

            <WView className="mb-3 flex-row items-center rounded-xl border px-3 py-2" style={{ borderColor: colors.border, backgroundColor: colors.bgElevated }}>
              <Icon name="search" size={16} color={colors.textMuted} />
              <WTextInput
                className="ml-2 flex-1 py-0.5 text-sm"
                style={{ color: colors.text }}
                placeholder="Search models..."
                placeholderTextColor={colors.textMuted}
                value={modelSearch}
                onChangeText={setModelSearch}
              />
            </WView>

            <WScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {!modelSearch ? (
                <WTouchableOpacity className="mb-2 rounded-xl px-3 py-3" style={{ backgroundColor: !selectedModel ? colors.accentSubtle : 'transparent' }} onPress={() => { onSelectModel(''); dismissModelPicker(); }}>
                  <WText className="text-sm font-medium" style={{ color: colors.text }}>Server Default</WText>
                </WTouchableOpacity>
              ) : null}

              {recent.length > 0 ? (
                <WView className="mb-3">
                  <WText className="mb-2 px-1 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>Recent</WText>
                  {recent.map((item) => {
                    const key = `${item.providerID}/${item.id}`;
                    return (
                      <WTouchableOpacity key={`recent-${key}`} className="mb-1 rounded-xl px-3 py-3" style={{ backgroundColor: selectedModel === key ? colors.accentSubtle : 'transparent' }} onPress={() => { onSelectModel(key); dismissModelPicker(); }}>
                        <WText className="text-sm font-medium" style={{ color: colors.text }} numberOfLines={1}>{item.name}</WText>
                        <WText className="text-xs" style={{ color: colors.textMuted }}>{item.providerName}</WText>
                      </WTouchableOpacity>
                    );
                  })}
                </WView>
              ) : null}

              {filtered.list.length === 0 && modelSearch ? (
                <WText className="px-2 py-4 text-sm" style={{ color: colors.textMuted }}>No models match "{modelSearch}"</WText>
              ) : (
                filtered.grouped.map(([provider, items]) => (
                  <WView key={provider} className="mb-3">
                    <WText className="mb-2 px-1 text-xs uppercase tracking-wide" style={{ color: colors.textMuted }}>{provider}</WText>
                    {items.map((item) => {
                      const key = `${item.providerID}/${item.id}`;
                      return (
                        <WTouchableOpacity key={key} className="mb-1 rounded-xl px-3 py-3" style={{ backgroundColor: selectedModel === key ? colors.accentSubtle : 'transparent' }} onPress={() => { onSelectModel(key); dismissModelPicker(); }}>
                          <WText className="text-sm font-medium" style={{ color: colors.text }} numberOfLines={1}>{item.name}</WText>
                        </WTouchableOpacity>
                      );
                    })}
                  </WView>
                ))
              )}
            </WScrollView>
          </WView>
        </WKeyboardAvoidingView>
      ) : null}

      {showModePicker ? (
        <WKeyboardAvoidingView className="absolute inset-0" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <WTouchableOpacity className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} activeOpacity={1} onPress={dismissModePicker} />
          <WView className="mb-3 px-4 pb-5 pt-3" style={{ backgroundColor: colors.bgCard, width: '95%', alignSelf: 'center', borderRadius: 28, overflow: 'hidden' }}>
            <WView className="mb-3 items-center">
              <WView className="h-1.5 w-10 rounded-full" style={{ backgroundColor: colors.textMuted }} />
            </WView>
            <WView className="mb-3">
              <WText className="text-base font-semibold" style={{ color: colors.text }}>Select Mode</WText>
            </WView>
            {modes.map((mode) => (
              <WTouchableOpacity
                key={mode}
                className="mb-1 flex-row items-center rounded-xl px-3 py-3"
                style={{ backgroundColor: selectedMode === mode ? colors.accentSubtle : 'transparent' }}
                onPress={() => {
                  setSelectedMode(mode);
                  dismissModePicker();
                }}
              >
                <Icon name={mode === 'plan' ? 'list-todo' : mode === 'build' ? 'code' : 'zap'} size={16} color={selectedMode === mode ? colors.accent : colors.textSecondary} />
                <WText className="ml-2 text-sm font-medium capitalize" style={{ color: selectedMode === mode ? colors.accent : colors.text }}>{mode}</WText>
              </WTouchableOpacity>
            ))}
          </WView>
        </WKeyboardAvoidingView>
      ) : null}

      {showBranchPicker ? (
        <WKeyboardAvoidingView className="absolute inset-0" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <WTouchableOpacity className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} activeOpacity={1} onPress={dismissBranchPicker} />
          <WView className="mb-3 h-[72%] px-4 pb-5 pt-3" style={{ backgroundColor: colors.bgCard, width: '95%', alignSelf: 'center', borderRadius: 28, overflow: 'hidden' }}>
            <WView className="mb-3 items-center">
              <WView className="h-1.5 w-10 rounded-full" style={{ backgroundColor: colors.textMuted }} />
            </WView>

            <WView className="mb-3 flex-row items-center justify-between">
              <WText className="text-base font-semibold" style={{ color: colors.text }}>Branches</WText>
            </WView>

            <WScrollView className="flex-1" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {visibleBranches.map((item) => {
                const active = item.id === session.id;
                const main = item.id === (session.parentID ?? session.id);
                return (
                  <WTouchableOpacity
                    key={item.id}
                    className="mb-1 rounded-xl border px-3 py-3"
                    style={{ backgroundColor: active ? colors.accentSubtle : colors.bgElevated, borderColor: active ? colors.accent : colors.border }}
                    onPress={() => {
                      dismissBranchPicker();
                      onOpenBranch(item.id);
                    }}
                  >
                    <WView className="flex-row items-center justify-between gap-2">
                      <WText className="flex-1 text-sm font-medium" numberOfLines={1} style={{ color: active ? colors.accent : colors.text }}>
                        {item.title || 'Untitled Session'}
                      </WText>
                    </WView>
                    <WView className="mt-1 flex-row items-center gap-2">
                      <WText className="text-[11px] uppercase tracking-wide" style={{ color: colors.textMuted }}>{main ? 'Main' : 'Branch'}</WText>
                      {item.time?.updated ? (
                        <WText className="text-[11px]" style={{ color: colors.textMuted }}>
                          {new Date(item.time.updated).toLocaleString()}
                        </WText>
                      ) : null}
                    </WView>
                  </WTouchableOpacity>
                );
              })}
            </WScrollView>

            <WTouchableOpacity
              className="mt-3 flex-row items-center justify-center rounded-xl border px-3 py-3"
              style={{ borderColor: colors.border, backgroundColor: colors.accentSubtle }}
              onPress={() => {
                dismissBranchPicker();
                onCreateBranch();
              }}
            >
              <Icon name="plus" size={16} color={colors.accent} />
              <WText className="ml-2 text-sm font-semibold" style={{ color: colors.accent }}>New Branch</WText>
            </WTouchableOpacity>
          </WView>
        </WKeyboardAvoidingView>
      ) : null}
    </WView>
  );
}
