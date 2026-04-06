import React from 'react';
import {
  MessageSquare,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  Wifi,
  WifiOff,
  RefreshCw,
  Code2,
  Terminal,
  User,
  Bot,
  Check,
  Clock,
  AlertCircle,
  Settings,
  LogOut,
  Loader2,
  Zap,
  Hash,
  FileText,
  FileCode,
  FilePlus,
  Pencil,
  Search,
  Globe,
  ListTodo,
  Play,
  Eye,
  File,
  FolderSearch,
  SearchCode,
  Circle,
  Inbox,
  Mic,
  Send,
  ArrowUp,
  Plus,
  X,
  GitBranch,
  Download,
  Brain,
} from 'lucide-react-native';
import { useTheme } from '../hooks/useTheme';

export type IconName =
  | 'message-square'
  | 'folder-open'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevrons-down'
  | 'wifi'
  | 'wifi-off'
  | 'refresh'
  | 'code'
  | 'terminal'
  | 'user'
  | 'bot'
  | 'check'
  | 'clock'
  | 'alert'
  | 'settings'
  | 'logout'
  | 'loader'
  | 'zap'
  | 'hash'
  | 'file-text'
  | 'file-code'
  | 'file-plus'
  | 'pencil'
  | 'search'
  | 'globe'
  | 'list-todo'
  | 'play'
  | 'eye'
  | 'file'
  | 'folder-search'
  | 'search-code'
  | 'circle'
  | 'inbox'
  | 'mic'
  | 'send'
  | 'arrow-up'
  | 'plus'
  | 'x'
  | 'git-branch'
  | 'download'
  | 'brain';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const iconMap = {
  'message-square': MessageSquare,
  'folder-open': FolderOpen,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'chevrons-down': ChevronsDown,
  'wifi': Wifi,
  'wifi-off': WifiOff,
  'refresh': RefreshCw,
  'code': Code2,
  'terminal': Terminal,
  'user': User,
  'bot': Bot,
  'check': Check,
  'clock': Clock,
  'alert': AlertCircle,
  'settings': Settings,
  'logout': LogOut,
  'loader': Loader2,
  'zap': Zap,
  'hash': Hash,
  'file-text': FileText,
  'file-code': FileCode,
  'file-plus': FilePlus,
  'pencil': Pencil,
  'search': Search,
  'globe': Globe,
  'list-todo': ListTodo,
  'play': Play,
  'eye': Eye,
  'file': File,
  'folder-search': FolderSearch,
  'search-code': SearchCode,
  'circle': Circle,
  'inbox': Inbox,
  'mic': Mic,
  'send': Send,
  'arrow-up': ArrowUp,
  'plus': Plus,
  'x': X,
  'git-branch': GitBranch,
  'download': Download,
  'brain': Brain,
};

export const Icon = React.memo(function Icon({ name, size = 24, color, strokeWidth = 2 }: IconProps) {
  const { colors: c } = useTheme();
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    return null;
  }

  return (
    <IconComponent
      size={size}
      color={color || c.text}
      strokeWidth={strokeWidth}
    />
  );
});
