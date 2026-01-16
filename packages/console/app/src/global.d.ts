/// <reference types="@solidjs/start/env" />

declare module "@stripe/stripe-js"
declare module "solid-stripe"

export declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
}

declare global {
  interface Navigator {
    gpu?: {
      requestAdapter: (...args: unknown[]) => Promise<GPUAdapter | null>
      getPreferredCanvasFormat?: () => string
    }
  }

  interface GPUAdapter {
    requestDevice: (...args: unknown[]) => Promise<GPUDevice>
  }

  interface GPUDevice {}
  interface GPUCanvasContext {
    configure?: (...args: unknown[]) => void
  }
  interface GPURenderPipeline {}
  interface GPUBuffer {}
  interface GPUBindGroup {}

  const GPUBufferUsage: Record<string, number>
  const GPUShaderStage: Record<string, number>
}
