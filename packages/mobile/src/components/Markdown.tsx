import React, { useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import MarkdownDisplay from 'react-native-markdown-display';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../theme';

interface MarkdownProps {
  children: string;
  isUser?: boolean;
}

// Structural styles that don't depend on theme/isUser
const baseStyles = StyleSheet.create({
  heading1: {
    fontSize: 24,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    lineHeight: 30,
  },
  heading2: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    lineHeight: 26,
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    lineHeight: 24,
  },
  heading4: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  strong: {
    fontWeight: '600',
  },
  em: {
    fontStyle: 'italic',
  },
  list_item: {
    marginVertical: 3,
  },
  bullet_list: {
    marginVertical: spacing.sm,
  },
  ordered_list: {
    marginVertical: spacing.sm,
  },
  hr: {
    height: 1,
    marginVertical: spacing.lg,
  },
});

const monoFamily = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const Markdown = React.memo(function Markdown({ children, isUser = false }: MarkdownProps) {
  const { colors: c, isDark } = useTheme();

  const markdownStyles = useMemo(() => {
    const textColor = isUser ? '#ffffff' : c.text;
    const secondaryColor = isUser ? 'rgba(255,255,255,0.7)' : c.textSecondary;
    const codeBackground = isUser
      ? 'rgba(0,0,0,0.2)'
      : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)');
    const blockquoteBorder = isUser ? 'rgba(255,255,255,0.4)' : c.accent;

    return {
      body: {
        color: textColor,
        ...typography.body,
      },
      heading1: { ...baseStyles.heading1, color: textColor },
      heading2: { ...baseStyles.heading2, color: textColor },
      heading3: { ...baseStyles.heading3, color: textColor },
      heading4: { ...baseStyles.heading4, color: textColor },
      paragraph: baseStyles.paragraph,
      strong: baseStyles.strong,
      em: baseStyles.em,
      link: {
        color: isUser ? '#ffffff' : c.accent,
        textDecorationLine: 'underline' as const,
      },
      blockquote: {
        backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : c.accentSubtle,
        borderLeftColor: blockquoteBorder,
        borderLeftWidth: 3,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        marginVertical: spacing.sm,
      },
      code_inline: {
        fontFamily: monoFamily,
        fontSize: 14,
        backgroundColor: codeBackground,
        color: isUser ? '#ffffff' : c.accent,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
      },
      code_block: {
        fontFamily: monoFamily,
        fontSize: 13,
        backgroundColor: codeBackground,
        color: textColor,
        padding: spacing.md,
        borderRadius: radius.md,
        marginVertical: spacing.sm,
        overflow: 'hidden' as const,
        lineHeight: 20,
      },
      fence: {
        fontFamily: monoFamily,
        fontSize: 13,
        backgroundColor: codeBackground,
        color: textColor,
        padding: spacing.md,
        borderRadius: radius.md,
        marginVertical: spacing.sm,
        overflow: 'hidden' as const,
        lineHeight: 20,
      },
      list_item: baseStyles.list_item,
      bullet_list: baseStyles.bullet_list,
      ordered_list: baseStyles.ordered_list,
      bullet_list_icon: {
        color: secondaryColor,
        marginRight: spacing.sm,
        fontSize: 14,
      },
      ordered_list_icon: {
        color: secondaryColor,
        marginRight: spacing.sm,
        fontSize: 14,
      },
      table: {
        borderWidth: 1,
        borderColor: isUser ? 'rgba(255,255,255,0.2)' : c.border,
        borderRadius: radius.md,
        marginVertical: spacing.sm,
        overflow: 'hidden' as const,
      },
      thead: {
        backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : c.bgHover,
      },
      th: {
        padding: spacing.sm,
        fontWeight: '600' as const,
      },
      td: {
        padding: spacing.sm,
        borderTopWidth: 1,
        borderColor: isUser ? 'rgba(255,255,255,0.1)' : c.divider,
      },
      hr: {
        ...baseStyles.hr,
        backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : c.divider,
      },
    };
  }, [isUser, isDark, c]);

  return (
    <MarkdownDisplay style={markdownStyles}>
      {children}
    </MarkdownDisplay>
  );
});
