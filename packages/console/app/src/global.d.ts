/// <reference types="@solidjs/start/env" />

declare module "@stripe/stripe-js" {
  export type Stripe = unknown
  export type PaymentMethod = { id: string; type: string; card?: { last4?: string } }
  export const loadStripe: (...args: unknown[]) => Promise<Stripe | null>
}

declare module "solid-stripe" {
  export const Elements: (props: any) => any
  export const PaymentElement: (props: any) => any
  export const AddressElement: (props: any) => any
  export const useStripe: () => any
  export const useElements: () => any
}

declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
  export const createHandler: (...args: unknown[]) => unknown
  export const StartServer: (props: any) => any
}

declare global {
  interface Navigator {
    gpu?: {
      requestAdapter: (...args: unknown[]) => Promise<GPUAdapter | null>
      getPreferredCanvasFormat: () => string
    }
  }

  interface GPUAdapter {
    requestDevice: (...args: unknown[]) => Promise<GPUDevice>
  }

  interface GPUDevice {
    createShaderModule: (...args: unknown[]) => unknown
    createBuffer: (...args: unknown[]) => GPUBuffer
    createBindGroupLayout: (...args: unknown[]) => unknown
    createBindGroup: (...args: unknown[]) => GPUBindGroup
    createPipelineLayout: (...args: unknown[]) => unknown
    createRenderPipeline: (...args: unknown[]) => GPURenderPipeline
    createCommandEncoder: (...args: unknown[]) => unknown
    destroy: (...args: unknown[]) => void
    queue: {
      writeBuffer: (...args: unknown[]) => void
      submit: (...args: unknown[]) => void
    }
  }
  interface GPUCanvasContext {
    configure: (...args: unknown[]) => void
    getCurrentTexture: (...args: unknown[]) => { createView: (...args: unknown[]) => unknown }
  }
  interface GPURenderPipeline {}
  interface GPUBuffer {
    destroy: (...args: unknown[]) => void
  }
  interface GPUBindGroup {}

  const GPUBufferUsage: Record<string, number>
  const GPUShaderStage: Record<string, number>
}

export {}
