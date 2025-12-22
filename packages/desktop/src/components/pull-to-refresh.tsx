import { createSignal, onCleanup, onMount, ParentProps, Show } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"

const PULL_THRESHOLD = 80
const RESISTANCE = 2.5

export function PullToRefresh(props: ParentProps) {
  let containerRef: HTMLDivElement | undefined
  const [pullDistance, setPullDistance] = createSignal(0)
  const [isRefreshing, setIsRefreshing] = createSignal(false)
  const [startY, setStartY] = createSignal(0)
  const [isPulling, setIsPulling] = createSignal(false)

  const canPull = () => {
    if (!containerRef) return false
    // Only allow pull when scrolled to top
    const scrollTop = containerRef.scrollTop
    return scrollTop <= 0
  }

  const handleTouchStart = (e: TouchEvent) => {
    if (isRefreshing()) return
    if (!canPull()) return

    const touch = e.touches[0]
    setStartY(touch.clientY)
    setIsPulling(true)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!isPulling() || isRefreshing()) return

    const touch = e.touches[0]
    const deltaY = touch.clientY - startY()

    if (deltaY > 0 && canPull()) {
      // Apply resistance to make pull feel natural
      const distance = Math.min(deltaY / RESISTANCE, PULL_THRESHOLD * 1.5)
      setPullDistance(distance)

      // Prevent default scrolling while pulling
      if (distance > 0) {
        e.preventDefault()
      }
    } else {
      setPullDistance(0)
    }
  }

  const handleTouchEnd = async () => {
    if (!isPulling()) return
    setIsPulling(false)

    if (pullDistance() >= PULL_THRESHOLD && !isRefreshing()) {
      setIsRefreshing(true)
      setPullDistance(PULL_THRESHOLD / 2) // Show spinner at a nice position

      // Perform refresh
      try {
        await new Promise((resolve) => setTimeout(resolve, 300))
        window.location.reload()
      } catch {
        setIsRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }

  onMount(() => {
    if (!containerRef) return

    containerRef.addEventListener("touchstart", handleTouchStart, { passive: true })
    containerRef.addEventListener("touchmove", handleTouchMove, { passive: false })
    containerRef.addEventListener("touchend", handleTouchEnd, { passive: true })

    onCleanup(() => {
      if (!containerRef) return
      containerRef.removeEventListener("touchstart", handleTouchStart)
      containerRef.removeEventListener("touchmove", handleTouchMove)
      containerRef.removeEventListener("touchend", handleTouchEnd)
    })
  })

  const progress = () => Math.min(pullDistance() / PULL_THRESHOLD, 1)
  const shouldShowIndicator = () => pullDistance() > 10 || isRefreshing()

  return (
    <div
      ref={containerRef}
      class="size-full overflow-y-auto overflow-x-hidden flex flex-col items-start contain-strict"
    >
      {/* Pull indicator */}
      <Show when={shouldShowIndicator()}>
        <div
          class="absolute left-1/2 -translate-x-1/2 z-40 flex items-center justify-center transition-opacity duration-150"
          style={{
            top: `calc(var(--safe-area-inset-top, 0px) + ${Math.max(pullDistance() - 20, 8)}px)`,
            opacity: isRefreshing() ? 1 : progress(),
          }}
        >
          <div class="bg-surface-base rounded-full p-2 shadow-lg border border-border-weak-base">
            <Show
              when={isRefreshing()}
              fallback={
                <div
                  class="text-text-base transition-transform duration-150"
                  style={{
                    transform: `rotate(${progress() * 180}deg)`,
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 5v14" />
                    <path d="m19 12-7 7-7-7" />
                  </svg>
                </div>
              }
            >
              <Spinner class="size-5" />
            </Show>
          </div>
        </div>
      </Show>

      {/* Content with pull transform */}
      <div
        class="size-full"
        style={{
          transform: pullDistance() > 0 ? `translateY(${pullDistance()}px)` : undefined,
          transition: isPulling() ? "none" : "transform 0.2s ease-out",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}
