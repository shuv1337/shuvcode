import { MacOSScrollAccel, type ScrollAcceleration } from "@opentui/core"

export type ScrollConfig = {
  scroll?: {
    acceleration?: boolean
    speed?: number
  }
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function getScrollAcceleration(tuiConfig?: ScrollConfig): ScrollAcceleration {
  if (tuiConfig?.scroll?.acceleration) {
    return new MacOSScrollAccel()
  }
  if (tuiConfig?.scroll?.speed !== undefined) {
    return new CustomSpeedScroll(tuiConfig.scroll.speed)
  }

  return new CustomSpeedScroll(3)
}
