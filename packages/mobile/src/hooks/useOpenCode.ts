// Re-export everything from the provider for backwards compatibility
export { useOpenCode } from '../providers/OpenCodeProvider';
export type {
  Session,
  SessionWithPreview,
  Project,
  Message,
  MessagePart,
  MessageWithParts,
  OpenCodeClient,
  ProviderModel,
  ProviderData,
  AgentMode,
} from '../providers/OpenCodeProvider';
