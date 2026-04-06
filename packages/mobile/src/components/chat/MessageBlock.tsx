import React, { useMemo, useState } from 'react';
import { Image, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { withUniwind } from 'uniwind';
import { Markdown } from '../Markdown';
import { Icon, IconName } from '../Icon';
import type { MessageWithParts } from '../../providers/OpenCodeProvider';

const WView = withUniwind(View);
const WText = withUniwind(Text);
const WTouchableOpacity = withUniwind(TouchableOpacity);

function getToolIcon(name: string): IconName {
  const map: Record<string, IconName> = {
    read: 'file-text',
    write: 'file-plus',
    edit: 'pencil',
    bash: 'terminal',
    glob: 'folder-search',
    grep: 'search',
    list: 'folder-open',
    todowrite: 'list-todo',
    todoread: 'list-todo',
    task: 'play',
    webfetch: 'globe',
    websearch: 'globe',
    codesearch: 'search',
  };
  return map[name] || 'zap';
}

function clean(text?: string) {
  if (!text) return '';
  return text.replace(/<\/?file>/g, '').replace(/^\d{5}\| /gm, '').trim().slice(0, 800);
}

function imageMime(mime?: string) {
  if (!mime) return false;
  return mime.startsWith('image/');
}

function imageURL(url: string, serverURL: string) {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const base = serverURL.endsWith('/') ? serverURL.slice(0, -1) : serverURL;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}

function StripeBlock({
  colors,
  stripe,
  icon,
  title,
  detail,
  showHeader,
  expanded,
  expandable,
  onToggle,
  children,
}: {
  colors: any;
  stripe: string;
  icon: IconName;
  title: string;
  detail?: string;
  showHeader?: boolean;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const header = showHeader ?? true;

  return (
    <WView className="border-l-2 px-3 py-2" style={{ borderLeftColor: stripe, backgroundColor: colors.bgCard }}>
      {header ? (
        <WTouchableOpacity className="flex-row items-center gap-2" onPress={onToggle} activeOpacity={expandable ? 0.7 : 1}>
          <Icon name={icon} size={15} color={colors.textSecondary} />
          <WText className="text-xs font-semibold" style={{ color: colors.textSecondary }}>{title}</WText>
          {detail ? <WText className="flex-1 text-xs font-medium" numberOfLines={1} style={{ color: colors.text }}>{detail}</WText> : <WView className="flex-1" />}
          {expandable ? <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} /> : null}
        </WTouchableOpacity>
      ) : null}
      {children && (!expandable || expanded) ? (
        <WView className={header ? 'mt-2 gap-2' : 'gap-2'}>{children}</WView>
      ) : null}
    </WView>
  );
}

function ToolBlock({ part, colors }: { part: any; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const status = typeof part.state === 'object' ? part.state?.status : part.state;
  const done = status === 'completed' || status === 'complete' || status === 'result';
  const tool = part.tool || part.toolName || 'tool';
  const icon = getToolIcon(tool);
  const detail = part.state?.input?.filePath || part.state?.input?.description || part.state?.input?.pattern || '';
  const command = part.state?.input?.command;
  const output = clean(part.state?.output);
  const todos = part.state?.input?.todos;
  const hasExpanded = Boolean(command || output || todos);

  return (
    <StripeBlock
      colors={colors}
      stripe={done ? colors.success : colors.warning}
      icon={icon}
      title={tool}
      detail={detail ? String(detail) : undefined}
      expanded={expanded}
      expandable={hasExpanded}
      onToggle={() => hasExpanded && setExpanded((prev) => !prev)}
    >
      {command ? (
        <WView className="gap-1">
          <WText className="text-[10px] uppercase tracking-[0.5px]" style={{ color: colors.textMuted }}>Command</WText>
          <WView className="rounded-md px-2 py-1" style={{ backgroundColor: colors.bg }}>
            <WText className="font-mono text-xs" style={{ color: colors.accent }}>{command}</WText>
          </WView>
        </WView>
      ) : null}
      {Array.isArray(todos) ? (
        <WView className="gap-1">
          <WText className="text-[10px] uppercase tracking-[0.5px]" style={{ color: colors.textMuted }}>Todos</WText>
          {todos.slice(0, 6).map((todo: any, i: number) => (
            <WView key={i} className="flex-row items-center gap-2">
              <Icon name={todo.status === 'completed' ? 'check' : 'circle'} size={13} color={todo.status === 'completed' ? colors.success : colors.textMuted} />
              <WText className="flex-1 text-xs" numberOfLines={1} style={{ color: colors.text }}>{todo.content}</WText>
            </WView>
          ))}
        </WView>
      ) : null}
      {output ? (
        <WView className="gap-1">
          <WText className="text-[10px] uppercase tracking-[0.5px]" style={{ color: colors.textMuted }}>Output</WText>
          <WText className="font-mono text-xs leading-5" style={{ color: colors.textSecondary }}>{output}</WText>
        </WView>
      ) : null}
    </StripeBlock>
  );
}

function ImageBlock({ part, colors, serverURL }: { part: any; colors: any; serverURL: string }) {
  const [error, setError] = useState(false);
  const { width } = useWindowDimensions();
  const url = part.url ? imageURL(part.url, serverURL) : '';

  if (!url || error) {
    return (
      <WView className="flex-row items-center gap-2 self-start rounded-lg border px-3 py-2" style={{ backgroundColor: colors.bgCard, borderColor: colors.border }}>
        <Icon name="file" size={18} color={colors.textMuted} />
        <WText className="text-xs" style={{ color: colors.textMuted }}>Image</WText>
      </WView>
    );
  }

  return (
    <Image
      source={{ uri: url }}
      resizeMode="contain"
      onError={() => setError(true)}
      style={{ width: 200, height: 200, borderRadius: 8, maxWidth: width - 40, maxHeight: 300 }}
    />
  );
}

function ReasoningBlock({
  id,
  part,
  colors,
  expanded,
  onToggle,
}: {
  id: string;
  part: any;
  colors: any;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const raw = String(part.text || '').trim();
  const lines = raw.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  const titleLine = lines[0] || 'thinking';
  const heading = titleLine
    .replace(/^#+\s+/, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .trim() || 'thinking';
  const body = lines
    .slice(1)
    .join('\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .trim();
  const detail = !expanded && body ? (body.length > 100 ? `${body.slice(0, 97)}...` : body) : undefined;

  return (
    <StripeBlock
      colors={colors}
      stripe={colors.accent}
      icon="brain"
      title="thinking"
      detail={heading}
      expanded={expanded}
      expandable={Boolean(body)}
      onToggle={() => onToggle(id)}
    >
      {body ? <WText className="text-xs leading-5" style={{ color: colors.textSecondary }}>{body}</WText> : null}
    </StripeBlock>
  );
}

export function MessageBlock({
  message,
  colors,
  serverURL,
  expandedReasoning,
  onToggleReasoning,
}: {
  message: MessageWithParts;
  colors: any;
  serverURL: string;
  expandedReasoning: Record<string, boolean>;
  onToggleReasoning: (id: string) => void;
}) {
  const isUser = message.info.role === 'user';

  const data = useMemo(() => {
    const text = message.parts
      .filter((p) => p.type === 'text' && (p as any).text?.trim())
      .map((p) => (p as any).text)
      .join('\n\n');
    const tools = message.parts.filter((p) => p.type === 'tool');
    const images = message.parts.filter((p) => p.type === 'file' && imageMime((p as any).mime));
    const reasoning = message.parts.filter((p) => p.type === 'reasoning' && (p as any).text?.trim());
    return { text, tools, images, reasoning };
  }, [message.parts]);

  if (!data.text && data.tools.length === 0 && data.images.length === 0 && data.reasoning.length === 0) return null;

  if (isUser) {
    return (
      <WView className="flex-row" style={{ backgroundColor: colors.userMessageBg }}>
        <WView style={{ width: 2, backgroundColor: colors.accent }} />
        <WView className="flex-1 px-4 py-3">
          {data.images.length > 0 ? (
            <WView className="mb-2 gap-2">
              {data.images.map((part, i) => <ImageBlock key={(part as any).id ?? `${message.info.id}-${i}`} part={part} colors={colors} serverURL={serverURL} />)}
            </WView>
          ) : null}
          {data.text ? <Markdown isUser={false}>{data.text}</Markdown> : null}
        </WView>
      </WView>
    );
  }

  return (
    <WView>
      {data.reasoning.length > 0 ? data.reasoning.map((part, i) => {
        const id = (part as any).id ?? `${message.info.id}-reasoning-${i}`;
        return <ReasoningBlock key={id} id={id} part={part} colors={colors} expanded={Boolean(expandedReasoning[id])} onToggle={onToggleReasoning} />;
      }) : null}

      {data.text || data.images.length > 0 ? (
        <WView className="flex-row" style={{ backgroundColor: colors.assistantMessage }}>
          <WView style={{ width: 2, backgroundColor: colors.textMuted }} />
          <WView className="flex-1 px-4 py-3">
          {data.images.length > 0 ? (
            <WView className="mb-2 gap-2">
              {data.images.map((part, i) => <ImageBlock key={(part as any).id ?? `${message.info.id}-image-${i}`} part={part} colors={colors} serverURL={serverURL} />)}
            </WView>
          ) : null}
          {data.text ? <Markdown isUser={false}>{data.text}</Markdown> : null}
          </WView>
        </WView>
      ) : null}

      {data.tools.length > 0 ? (
        <WView>
          {data.tools.map((part, i) => <ToolBlock key={(part as any).id ?? `${message.info.id}-tool-${i}`} part={part} colors={colors} />)}
        </WView>
      ) : null}
    </WView>
  );
}
