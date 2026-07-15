import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { OpenAIResponses } from "./openai-responses"

const ADAPTER = "openai-compatible-responses"

export type OpenAICompatibleResponsesModelInput = RouteRoutedModelInput

/**
 * Route for providers that expose an OpenAI Responses-compatible `/responses`
 * endpoint. Provider helpers configure identity, endpoint, and auth before
 * model selection while this route reuses the OpenAI Responses protocol.
 */
export const route = Route.make({
  id: ADAPTER,
  providerMetadataKey: "openai",
  protocol: OpenAIResponses.protocol,
  endpoint: Endpoint.path(OpenAIResponses.PATH),
  transport: OpenAIResponses.httpTransport,
  defaults: { providerOptions: { openai: { store: false } } },
})

export * as OpenAICompatibleResponses from "./openai-compatible-responses"
