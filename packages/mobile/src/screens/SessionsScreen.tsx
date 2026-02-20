import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { formatRelativeDate } from '../utils/date';
import type { Session, SessionWithPreview } from '../providers/OpenCodeProvider';

const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTouchableOpacity = withUniwind(TouchableOpacity);
const WSafeAreaView = withUniwind(SafeAreaView);

interface SessionsScreenProps {
  sessions: SessionWithPreview[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectSession: (session: Session) => void;
}

interface GroupedSession extends SessionWithPreview {
  children?: SessionWithPreview[];
}

export function SessionsScreen({
  sessions,
  loading,
  refreshing,
  onRefresh,
  onSelectSession,
}: SessionsScreenProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const parents: GroupedSession[] = [];
    const children = new Map<string, SessionWithPreview[]>();
    for (const session of sessions) {
      if (!session.parentID) {
        parents.push({ ...session });
        continue;
      }
      const existing = children.get(session.parentID) ?? [];
      existing.push(session);
      children.set(session.parentID, existing);
    }
    for (const session of parents) {
      const nested = children.get(session.id);
      if (!nested) continue;
      session.children = nested.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
    }
    return parents.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
  }, [sessions]);

  return (
    <WSafeAreaView className="flex-1" style={{ backgroundColor: colors.bg }} edges={['top']}>
      <ScreenHeader
        title="Sessions"
        subtitle={`${grouped.length} ${grouped.length === 1 ? 'session' : 'sessions'}`}
      />

      <FlatList
        data={grouped}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: 100, flexGrow: grouped.length ? 0 : 1 }}
        renderItem={({ item }) => {
          const open = expanded.has(item.id);
          const child = item.children ?? [];
          const hasChild = child.length > 0;
          return (
            <WView className="mx-4 mb-2">
              <WTouchableOpacity
                className="flex-row items-center rounded-2xl border px-4 py-3"
                style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}
                onPress={() => onSelectSession(item)}
                activeOpacity={0.8}
              >
                <WView className="flex-1">
                  <WView className="flex-row items-center justify-between gap-3">
                    <WText className="flex-1 text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>{item.title || 'Untitled Session'}</WText>
                    <WText className="text-[11px]" style={{ color: colors.textMuted }}>{formatRelativeDate(item.time?.updated ?? item.time?.created)}</WText>
                  </WView>
                  {item.preview ? <WText className="mt-1 text-xs" numberOfLines={1} style={{ color: colors.textSecondary }}>{item.preview}</WText> : null}
                </WView>
                {hasChild ? (
                  <WTouchableOpacity
                    className="ml-2 flex-row items-center gap-1 rounded-lg px-2 py-1"
                    style={{ backgroundColor: `${colors.accent}1f` }}
                    onPress={() => setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })}
                  >
                    <WText className="text-xs font-semibold" style={{ color: colors.accent }}>{child.length}</WText>
                    <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
                  </WTouchableOpacity>
                ) : <Icon name="chevron-right" size={18} color={colors.textMuted} />}
              </WTouchableOpacity>

              {hasChild && open ? (
                <WView className="mt-2 gap-2 pl-4">
                  {child.map((nested) => (
                    <WTouchableOpacity
                      key={nested.id}
                      className="flex-row items-center rounded-xl border px-3 py-3"
                      style={{ backgroundColor: colors.bgElevated, borderColor: colors.border }}
                      activeOpacity={0.8}
                      onPress={() => onSelectSession(nested)}
                    >
                      <WView className="mr-2 h-6 w-1 rounded-full" style={{ backgroundColor: colors.accent }} />
                      <WView className="flex-1">
                        <WText className="text-xs font-medium" numberOfLines={1} style={{ color: colors.text }}>{nested.title || 'Untitled Session'}</WText>
                        {nested.preview ? <WText className="mt-1 text-[11px]" numberOfLines={1} style={{ color: colors.textSecondary }}>{nested.preview}</WText> : null}
                      </WView>
                      <WText className="ml-2 text-[10px]" style={{ color: colors.textMuted }}>{formatRelativeDate(nested.time?.updated ?? nested.time?.created)}</WText>
                    </WTouchableOpacity>
                  ))}
                </WView>
              ) : null}
            </WView>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="inbox"
            title={loading ? 'Loading...' : 'No Sessions'}
            description={loading ? 'Fetching your sessions' : 'Select a project to start a new session'}
            accent={colors.accent}
          />
        }
      />
    </WSafeAreaView>
  );
}
