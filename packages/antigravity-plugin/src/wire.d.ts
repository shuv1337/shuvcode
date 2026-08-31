export * as GoogleAntigravityWire from "./wire";
import type { CatalogDraft } from "@opencode-ai/plugin/effect/catalog";
import { GoogleAntigravityOAuth } from "./oauth";
export declare const generateURL = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
export declare const defaultModelID: string & import("effect/Brand").Brand<"Model.ID">;
export declare const googleProviderID: string & import("effect/Brand").Brand<"Provider.ID">;
export type ShippedModel = {
    id: string;
    name: string;
    apiID?: string;
    modelEnum?: string;
};
export declare const shippedModels: readonly ShippedModel[];
export declare const modelEnumDefaults: Map<string, string>;
export declare const catalogID: (id: string) => string;
export declare const isGenerateURL: (url: string) => boolean;
export declare const modelFromURL: (url: string) => string | undefined;
export declare const isBlockedModelID: (id: string) => boolean;
export declare const isGoogleCatalogModel: (model: GoogleAntigravityOAuth.CatalogModel) => boolean;
export declare const filterGoogleModels: (models: readonly GoogleAntigravityOAuth.CatalogModel[]) => GoogleAntigravityOAuth.CatalogModel[];
export declare function modelEnumsFrom(models: readonly GoogleAntigravityOAuth.CatalogModel[]): Map<string, string>;
/**
 * Strips JSON Schema keywords Cloud Code rejects. Known limitation: a `$ref` is dropped rather
 * than resolved, so a tool parameter defined only by reference degrades to untyped.
 */
export declare function cleanSchema(value: unknown): unknown;
export declare function wrapGenerateRequest(input: {
    body: unknown;
    projectId: string;
    model: string;
    sessionID: string;
    modelEnum?: string;
    now?: number;
    trajectory?: string;
}): Record<string, unknown>;
export declare function applyRequestHeaders(headers: Headers, accessToken: string): void;
export declare function unwrapDataLine(line: string): string;
export declare function unwrapSSEText(text: string): string;
export declare function unwrapSSE(): TransformStream<Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>>;
export declare function applyCatalog(evt: CatalogDraft, active: boolean): void;
