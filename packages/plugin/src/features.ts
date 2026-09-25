export interface Features {
  readonly richFailures: true
}

export const features = {
  richFailures: true,
} as const satisfies Features
