export * as OauthCallbackPage from "./page";
export interface CallbackPageOptions {
    provider?: string;
    autoClose?: boolean;
}
export declare function success(options?: CallbackPageOptions): string;
export declare function error(detail: string, options?: CallbackPageOptions): string;
