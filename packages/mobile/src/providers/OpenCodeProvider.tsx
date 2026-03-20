import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as streamingFetch } from 'expo/fetch';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { Project, Session, Message, Part } from '@opencode-ai/sdk/v2/client';
import { applyMessageEvent, loadMessages, type MessageStore } from '@opencode-ai/sdk/event-reducer';

const SERVER_URL_KEY = 'opencode_server_url';
const SELECTED_MODEL_KEY = 'opencode_selected_model';
const RECENT_MODELS_KEY = 'opencode_recent_models';
const MAX_RECENT_MODELS = 5;

export type OpenCodeClient = ReturnType<typeof createOpencodeClient>;
export type { Project, Session, Message, Part as MessagePart };

export interface SessionWithPreview extends Session {
  preview?: string;
}

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

export interface PromptAttachment {
  mime: string;
  url: string;
  filename?: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  providerID: string;
  providerName: string;
}

export interface ProviderData {
  all: any[];
  connected: string[];
  default: Record<string, string>;
}

export interface AgentMode {
  name: string;
  description?: string;
  mode: 'subagent' | 'primary' | 'all';
  hidden?: boolean;
}

interface OpenCodeContextValue {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  serverUrl: string;
  connect: (url?: string) => Promise<boolean>;
  disconnect: () => void;
  setServerUrl: (url: string) => void;
  sessions: SessionWithPreview[];
  sessionsLoading: boolean;
  sessionsRefreshing: boolean;
  refreshSessions: () => void;
  getSessionMessages: (sessionId: string) => MessageWithParts[];
  isSessionMessagesLoading: (sessionId: string) => boolean;
  refreshSessionMessages: (sessionId: string) => void;
  subscribeToSession: (sessionId: string) => void;
  unsubscribeFromSession: () => void;
  activeSessionId: string | null;
  sendPrompt: (
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    mode?: string,
    attachments?: PromptAttachment[],
  ) => Promise<boolean>;
  isSending: boolean;
  createSession: (projectID?: string, parentID?: string) => Promise<Session | null>;
  projects: Project[];
  projectsLoading: boolean;
  refreshProjects: () => void;
  providerData: ProviderData | null;
  agentModes: AgentMode[];
  selectedModel: string | null;
  setSelectedModel: (model: string | null) => void;
  recentModelKeys: string[];
  client: OpenCodeClient | null;
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null);

function extractPreview(parts: Part[]): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] as any;
    if (part.type === 'text' && part.text?.trim()) {
      const text = part.text.trim();
      return text.length > 60 ? text.substring(0, 57) + '...' : text;
    }
  }
  return '';
}

function getMessages(store: MessageStore, sessionId: string): MessageWithParts[] {
  const messages = store.messages[sessionId];
  if (!messages) return [];
  return messages.map((info) => ({
    info,
    parts: store.parts[info.id] ?? [],
  }));
}

function headerDirectory(directory: string) {
  return /^[\x00-\x7F]*$/.test(directory) ? directory : encodeURIComponent(directory);
}

interface OpenCodeProviderProps {
  children: ReactNode;
}

export function OpenCodeProvider({ children }: OpenCodeProviderProps) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrlState] = useState('');
  const clientRef = useRef<OpenCodeClient | null>(null);
  const connectionIdRef = useRef(0);

  const setServerUrl = useCallback((url: string) => {
    setServerUrlState(url);
    AsyncStorage.setItem(SERVER_URL_KEY, url).catch(() => {});
  }, []);

  const [sessions, setSessions] = useState<SessionWithPreview[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);

  const [messageStore, setMessageStore] = useState<MessageStore>({ messages: {}, parts: {} });
  const [messagesLoading, setMessagesLoading] = useState<Set<string>>(new Set());

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [providerData, setProviderData] = useState<ProviderData | null>(null);
  const [agentModes, setAgentModes] = useState<AgentMode[]>([]);
  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [recentModelKeys, setRecentModelKeys] = useState<string[]>([]);

  const setSelectedModel = useCallback((model: string | null) => {
    setSelectedModelState(model);
    if (model) {
      AsyncStorage.setItem(SELECTED_MODEL_KEY, model).catch(() => {});
      setRecentModelKeys(prev => {
        const next = [model, ...prev.filter(k => k !== model)].slice(0, MAX_RECENT_MODELS);
        AsyncStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      return;
    }
    AsyncStorage.removeItem(SELECTED_MODEL_KEY).catch(() => {});
  }, []);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  const [isSending, setIsSending] = useState(false);

  const connect = useCallback(async (url?: string) => {
    const targetUrl = url || serverUrl;
    const connectionId = ++connectionIdRef.current;
    setConnecting(true);
    setError(null);

    try {
      const client = createOpencodeClient({
        baseUrl: targetUrl,
        fetch: (input: any, init?: any) => fetch(input, init),
      });

      const listPromise = client.session.list();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), 5000),
      );
      await Promise.race([listPromise, timeoutPromise]);

      if (connectionId !== connectionIdRef.current) return false;
      clientRef.current = client;
      setServerUrl(targetUrl);
      setConnected(true);
      setConnecting(false);
      return true;
    } catch (err) {
      if (connectionId !== connectionIdRef.current) return false;
      setError((err as Error).message);
      setConnected(false);
      setConnecting(false);
      return false;
    }
  }, [serverUrl]);

  useEffect(() => {
    (async () => {
      try {
        const [savedUrl, savedModel, savedRecents] = await Promise.all([
          AsyncStorage.getItem(SERVER_URL_KEY),
          AsyncStorage.getItem(SELECTED_MODEL_KEY),
          AsyncStorage.getItem(RECENT_MODELS_KEY),
        ]);
        if (savedModel) setSelectedModelState(savedModel);
        if (savedRecents) try { setRecentModelKeys(JSON.parse(savedRecents)); } catch {}
        if (savedUrl) connect(savedUrl);
      } catch {}
    })();
  }, []);

  const disconnect = useCallback(() => {
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    clientRef.current = null;
    setConnected(false);
    setActiveSessionId(null);
    setSessions([]);
    setMessageStore({ messages: {}, parts: {} });
    setProjects([]);
  }, []);

  const fetchSessions = useCallback(async (isRefresh = false) => {
    if (!clientRef.current) return;
    if (isRefresh) setSessionsRefreshing(true);
    else setSessionsLoading(true);

    try {
      const result = await clientRef.current.session.list();
      const data = (result.data ?? []) as Session[];
      data.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
      setSessions(data.map(s => ({ ...s, preview: '' })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSessionsLoading(false);
      setSessionsRefreshing(false);
    }
  }, []);

  const refreshSessions = useCallback(() => fetchSessions(true), [fetchSessions]);

  useEffect(() => {
    if (connected) fetchSessions();
  }, [connected, fetchSessions]);

  const getSessionMessagesForSession = useCallback((sessionId: string): MessageWithParts[] => {
    return getMessages(messageStore, sessionId);
  }, [messageStore]);

  const isSessionMessagesLoading = useCallback((sessionId: string): boolean => {
    return messagesLoading.has(sessionId);
  }, [messagesLoading]);

  const fetchSessionMessages = useCallback(async (sessionId: string) => {
    if (!clientRef.current) return;
    const directory = sessions.find(s => s.id === sessionId)?.directory;
    setMessagesLoading(prev => new Set(prev).add(sessionId));

    try {
      const result = await clientRef.current.session.messages({
        sessionID: sessionId,
        ...(directory && { directory }),
      });
      const data = (result.data ?? []) as MessageWithParts[];
      setMessageStore(prev => loadMessages(prev, sessionId, data));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMessagesLoading(prev => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, [sessions]);

  const refreshSessionMessages = useCallback((sessionId: string) => {
    fetchSessionMessages(sessionId);
  }, [fetchSessionMessages]);

  const subscribeToSession = useCallback((sessionId: string) => {
    if (!clientRef.current) return;

    sseAbortRef.current?.abort();
    setActiveSessionId(sessionId);
    const directory = sessions.find(s => s.id === sessionId)?.directory;

    fetchSessionMessages(sessionId);

    const abort = new AbortController();
    sseAbortRef.current = abort;
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;

    (async () => {
      if (__DEV__) console.log('[SSE] Subscribing for session', sessionId);

      while (!abort.signal.aborted) {
        try {
          const response = await streamingFetch(`${baseUrl}/event`, {
            headers: {
              Accept: 'text/event-stream',
              ...(directory && { 'x-opencode-directory': headerDirectory(directory) }),
            },
            signal: abort.signal,
          });
          if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body reader');

          const decoder = new TextDecoder();
          let buffer = '';

          while (!abort.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() ?? '';

            for (const chunk of chunks) {
              const dataLine = chunk.split('\n').find(l => l.startsWith('data:'));
              if (!dataLine) continue;
              const json = dataLine.slice(5).trim();
              if (!json) continue;

              try {
                const eventData = JSON.parse(json);
                const event = eventData?.payload ?? eventData;
                const props = event?.properties;
                const evtSessionId =
                  props?.sessionID ??
                  props?.info?.sessionID ??
                  props?.part?.sessionID;

                if (evtSessionId && evtSessionId !== sessionId) continue;

                setMessageStore(prev => applyMessageEvent(prev, event) ?? prev);
              } catch {
                // skip malformed JSON
              }
            }
          }
        } catch (err) {
          if (abort.signal.aborted) break;
          if (__DEV__) console.log('[SSE] Reconnecting in 3s...', (err as Error).message);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();
  }, [serverUrl, sessions, fetchSessionMessages]);

  const unsubscribeFromSession = useCallback(() => {
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setActiveSessionId(null);
  }, []);

  const sendPrompt = useCallback(async (
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    mode?: string,
    attachments?: PromptAttachment[],
  ): Promise<boolean> => {
    if (!clientRef.current) return false;
    const trimmed = text.trim();
    const files = (attachments ?? []).flatMap((item) => {
      if (!item.mime || !item.url) return [];
      return [{
        type: 'file' as const,
        mime: item.mime,
        url: item.url,
        ...(item.filename && { filename: item.filename }),
      }];
    });
    const parts = trimmed
      ? [...files, { type: 'text' as const, text: trimmed }]
      : files;
    if (!parts.length) return false;
    const directory = sessions.find(s => s.id === sessionId)?.directory;
    setIsSending(true);

    try {
      await clientRef.current.session.promptAsync({
        sessionID: sessionId,
        ...(directory && { directory }),
        parts,
        ...(model && { model }),
        ...(mode && { agent: mode }),
      }, { throwOnError: true });
    } catch (err) {
      if (__DEV__) console.log('[OpenCode] promptAsync failed, trying prompt fallback', (err as any)?.message || err);

      try {
        clientRef.current.session.prompt({
          sessionID: sessionId,
          ...(directory && { directory }),
          parts,
          ...(model && { model }),
          ...(mode && { agent: mode }),
        }, { throwOnError: true }).catch((fallbackErr: any) => {
          const message = fallbackErr?.data?.message || fallbackErr?.message || String(fallbackErr);
          setError(message);
        });
      } catch (fallbackErr) {
        const error = fallbackErr as any;
        setError(error?.data?.message || error?.message || 'Failed to send message');
        return false;
      }
    } finally {
      setIsSending(false);
    }

    fetchSessionMessages(sessionId);
    return true;
  }, [fetchSessionMessages, sessions]);

  const createSession = useCallback(async (directory?: string, parentID?: string): Promise<Session | null> => {
    if (!clientRef.current) return null;
    try {
      const result = await clientRef.current.session.create(
        { parentID, directory },
        { throwOnError: true },
      );
      const newSession = result.data as Session;
      if (newSession) {
        setSessions((prev) => {
          const next = prev.some((s) => s.id === newSession.id)
            ? prev
            : [{ ...newSession, preview: '' }, ...prev];
          next.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
          return next;
        });
        refreshSessions();
        return newSession;
      }
      return null;
    } catch (err) {
      const error = err as any;
      setError(error?.data?.message || error?.message || 'Failed to create session');
      return null;
    }
  }, [refreshSessions]);

  const fetchProjects = useCallback(async () => {
    if (!clientRef.current) return;
    setProjectsLoading(true);
    try {
      const result = await clientRef.current.project.list();
      const data = (result.data ?? []) as Project[];
      data.sort((a, b) => ((b as any).time?.updated ?? (b as any).time?.created ?? 0) - ((a as any).time?.updated ?? (a as any).time?.created ?? 0));
      setProjects(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const refreshProjects = useCallback(() => fetchProjects(), [fetchProjects]);

  const fetchProviders = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      const result = await clientRef.current.provider.list();
      if (result.data) setProviderData(result.data as ProviderData);
    } catch {}
  }, []);

  const fetchAgents = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      const result = await clientRef.current.app.agents();
      const data = (result.data ?? []) as AgentMode[];
      setAgentModes(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (connected) { fetchProjects(); fetchProviders(); fetchAgents(); }
  }, [connected, fetchProjects, fetchProviders, fetchAgents]);

  useEffect(() => () => { sseAbortRef.current?.abort(); }, []);

  const value = useMemo<OpenCodeContextValue>(() => ({
    connected, connecting, error, serverUrl,
    connect, disconnect, setServerUrl,
    sessions, sessionsLoading, sessionsRefreshing, refreshSessions,
    getSessionMessages: getSessionMessagesForSession,
    isSessionMessagesLoading,
    refreshSessionMessages,
    subscribeToSession, unsubscribeFromSession, activeSessionId,
    sendPrompt, isSending, createSession,
    projects, projectsLoading, refreshProjects,
    providerData, agentModes, selectedModel, setSelectedModel, recentModelKeys,
    client: clientRef.current,
  }), [
    connected, connecting, error, serverUrl,
    connect, disconnect, setServerUrl,
    sessions, sessionsLoading, sessionsRefreshing, refreshSessions,
    getSessionMessagesForSession, isSessionMessagesLoading, refreshSessionMessages,
    subscribeToSession, unsubscribeFromSession, activeSessionId,
    sendPrompt, isSending, createSession,
    projects, projectsLoading, refreshProjects,
    providerData, agentModes, selectedModel, setSelectedModel, recentModelKeys,
  ]);

  return (
    <OpenCodeContext.Provider value={value}>
      {children}
    </OpenCodeContext.Provider>
  );
}

export function useOpenCode() {
  const context = useContext(OpenCodeContext);
  if (!context) throw new Error('useOpenCode must be used within an OpenCodeProvider');
  return context;
}
