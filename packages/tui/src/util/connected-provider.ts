import type { IntegrationInfo, ModelInfo, ProviderInfo } from "@opencode/client"
import { isHiddenProvider } from "@opencode/util/hidden-provider"

// Any stored or detected connection, or a listed provider with models beyond the keyless OpenCode catalog, such as
// one declared only in config. Matches `anyConnection` in packages/app/src/providers/catalog/providers.ts.
export function hasConnectedProvider(input: {
  integrations: readonly (Pick<IntegrationInfo, "connections"> & Partial<Pick<IntegrationInfo, "id">>)[]
  providers: readonly Pick<ProviderInfo, "id">[]
  models: readonly Pick<ModelInfo, "providerID" | "status">[]
}) {
  if (
    input.integrations.some(
      (integration) => (!integration.id || !isHiddenProvider(integration.id)) && integration.connections.length > 0,
    )
  ) {
    return true
  }
  const providers = new Set(input.providers.map((provider) => provider.id).filter((id) => !isHiddenProvider(id)))
  return input.models.some(
    (model) =>
      model.providerID !== "opencode" &&
      model.status !== "deprecated" &&
      !isHiddenProvider(model.providerID) &&
      providers.has(model.providerID),
  )
}
