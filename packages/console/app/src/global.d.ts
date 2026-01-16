/// <reference types="@solidjs/start/env" />

declare module "@stripe/stripe-js"
declare module "solid-stripe"

declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
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
