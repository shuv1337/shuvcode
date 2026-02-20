import { useEffect, useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatScreen } from '../../src/screens/ChatScreen';
import { useOpenCode, Session } from '../../src/providers/OpenCodeProvider';
import type { PromptAttachment, ProviderModel } from '../../src/providers/OpenCodeProvider';

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    sessions,
    error,
    getSessionMessages,
    isSessionMessagesLoading,
    serverUrl,
    sendPrompt,
    isSending,
    createSession,
    subscribeToSession,
    unsubscribeFromSession,
    providerData,
    agentModes,
    selectedModel,
    setSelectedModel,
    recentModelKeys,
  } = useOpenCode();

  // Derive available models from connected providers
  const availableModels = useMemo((): ProviderModel[] => {
    if (!providerData) return [];
    const connected = new Set(providerData.connected);
    const result: ProviderModel[] = [];
    for (const provider of providerData.all) {
      if (!connected.has(provider.id)) continue;
      for (const [modelId, model] of Object.entries(provider.models)) {
        result.push({
          id: modelId,
          name: (model as any).name || modelId,
          providerID: provider.id,
          providerName: provider.name,
        });
      }
    }
    return result;
  }, [providerData]);

  const handleBranch = useCallback(async () => {
    if (!id) return;
    const currentSession = sessions.find(s => s.id === id);
    const session = await createSession(currentSession?.directory, id);
    if (session) {
      router.replace({ pathname: '/chat/[id]', params: { id: session.id } });
    }
  }, [id, createSession, sessions, router]);

  const handleOpenBranch = useCallback((sessionId: string) => {
    if (!sessionId) return;
    router.replace({ pathname: '/chat/[id]', params: { id: sessionId } });
  }, [router]);

  // Subscribe to session on mount
  useEffect(() => {
    if (id) {
      subscribeToSession(id);
    }
    return () => {
      unsubscribeFromSession();
    };
  }, [id, subscribeToSession, unsubscribeFromSession]);

  // Find session from the sessions list
  const session = sessions.find((s) => s.id === id) ?? {
    id: id || '',
    title: 'Chat',
  } as Session;

  const branchRootID = useMemo(() => {
    if (!session.id) return '';
    const source = sessions.some((item) => item.id === session.id)
      ? sessions
      : [session, ...sessions];
    const map = new Map(source.map((item) => [item.id, item]));
    let current = map.get(session.id);
    while (current?.parentID && map.has(current.parentID)) {
      current = map.get(current.parentID);
    }
    return current?.id || session.id;
  }, [sessions, session]);

  const branches = useMemo(() => {
    if (!branchRootID) return [];
    const source = sessions.some((item) => item.id === session.id)
      ? sessions
      : [session, ...sessions];
    const map = new Map(source.map((item) => [item.id, item]));
    const rootOf = (sessionID: string) => {
      let current = map.get(sessionID);
      while (current?.parentID && map.has(current.parentID)) {
        current = map.get(current.parentID);
      }
      return current?.id || sessionID;
    };

    return source
      .filter((item) => rootOf(item.id) === branchRootID)
      .sort((a, b) => {
        if (a.id === branchRootID) return -1;
        if (b.id === branchRootID) return 1;
        return (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0);
      });
  }, [sessions, session, branchRootID]);

  const messages = getSessionMessages(id || '');
  const loading = isSessionMessagesLoading(id || '');

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSendMessage = useCallback(async (
    text: string,
    model?: { providerID: string; modelID: string },
    mode?: string,
    attachments?: PromptAttachment[],
  ) => {
    if (!id) return false;
    return sendPrompt(id, text, model, mode, attachments);
  }, [sendPrompt, id]);

  const handleSelectModel = useCallback((key: string) => {
    setSelectedModel(key || null);
  }, [setSelectedModel]);

  const modes = useMemo(() => {
    const list = agentModes
      .filter((a) => !a.hidden && (a.mode === 'primary' || a.mode === 'all'))
      .map((a) => a.name);
    return list.length ? list : ['build'];
  }, [agentModes]);

  return (
    <ChatScreen
      session={session}
      messages={messages}
      loading={loading}
      serverUrl={serverUrl}
      error={error}
      models={availableModels}
      recentModelKeys={recentModelKeys}
      selectedModel={selectedModel}
      modes={modes}
      branches={branches}
      onSelectModel={handleSelectModel}
      onBack={handleBack}
      onSendMessage={handleSendMessage}
      onCreateBranch={handleBranch}
      onOpenBranch={handleOpenBranch}
      isSending={isSending}
    />
  );
}
