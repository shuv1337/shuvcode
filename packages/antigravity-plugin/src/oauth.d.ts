export * as GoogleAntigravityOAuth from "./oauth";
export declare const methodID: string & import("effect/Brand").Brand<"Integration.MethodID">;
export declare const integrationID: string & import("effect/Brand").Brand<"Integration.ID">;
/** Official Antigravity CLI client, extracted from `agy` 1.1.13. */
export declare const clientID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export declare const callbackPort = 36742;
export declare const redirectURI = "http://localhost:36742/oauth-callback";
export declare const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
export declare const tokenEndpoint = "https://oauth2.googleapis.com/token";
export declare const userInfoEndpoint = "https://www.googleapis.com/oauth2/v2/userinfo";
export declare const cloudCodeEndpoint = "https://daily-cloudcode-pa.googleapis.com";
export declare const scopes: readonly ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/cclog", "https://www.googleapis.com/auth/experimentsandconfigs"];
export type Tokens = {
    access: string;
    refresh: string;
    expires: number;
};
export type AccountInfo = {
    projectId?: string;
    email?: string;
    paidTier?: string;
};
export type ImportedAccount = {
    refresh: string;
    access?: string;
    expires?: number;
    projectId?: string;
    email?: string;
};
export type CompletedAccount = Tokens & {
    projectId: string;
    email?: string;
    paidTier?: string;
};
export type CatalogModel = {
    id: string;
    name?: string;
    modelEnum?: string;
    provider?: string;
    internal?: boolean;
    recommended?: boolean;
};
type CredentialLike = {
    readonly type: string;
    readonly methodID?: string;
};
export declare const isSubscription: (credential: CredentialLike | undefined) => boolean;
export declare const projectId: (metadata: Readonly<Record<string, unknown>> | undefined) => string | undefined;
export declare const userAgent: () => string;
export declare const pkce: () => {
    verifier: string;
    challenge: string;
};
export declare const authorizeURL: (challenge: string, state: string) => string;
export declare const nextRefresh: (current: string, returned?: string) => string;
export declare const exchange: (code: string, verifier: string) => Promise<Tokens>;
export declare const refresh: (refreshToken: string) => Promise<Tokens>;
export declare function loadCodeAssist(access: string): Promise<AccountInfo>;
export declare function fetchUserInfo(access: string): Promise<{
    email: string | undefined;
} | undefined>;
export declare function parseCatalogModels(payload: unknown): CatalogModel[];
export declare function fetchAvailableModels(access: string, project: string): Promise<CatalogModel[]>;
export declare function splitRefresh(value: string): {
    refresh: string;
    projectId?: undefined;
} | {
    refresh: string;
    projectId: string | undefined;
};
export declare function parseV1Accounts(text: string): ImportedAccount | undefined;
export declare function parseOAuthTokenBlob(value: string): ImportedAccount | undefined;
export declare function antigravityStatePaths(home?: string): string[];
export declare function v1AccountsPath(dataDir?: string): string;
export declare function importExisting(options?: {
    dataDir?: string;
    statePaths?: string[];
}): Promise<ImportedAccount | undefined>;
export declare function completeAccount(input: ImportedAccount | Tokens): Promise<CompletedAccount>;
