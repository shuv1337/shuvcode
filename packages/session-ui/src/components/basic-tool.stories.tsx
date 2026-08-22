import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { BasicTool } from "./basic-tool"

export default {
  title: "OpenCode/Tools/Disclosure",
  id: "components-basic-tool",
  component: BasicTool,
  parameters: {
    docs: {
      description: {
        component:
          "The disclosure frame shared by production tool messages. Use these stories to inspect common resting, running, expanded, and summary-only states.",
      },
    },
  },
}

export const Completed = {
  render: () => (
    <BasicTool
      icon="glasses"
      defaultOpen
      trigger={{ title: "Read", subtitle: "src/session.ts", args: ["offset=1", "limit=80"] }}
    >
      <div class="px-3 py-2 text-12-regular text-text-base">Loaded the requested file.</div>
    </BasicTool>
  ),
}

export const Running = {
  render: () => (
    <BasicTool icon="console" status="running" trigger={{ title: "Running tests", subtitle: "bun test src/timeline" }}>
      <div class="px-3 py-2 font-mono text-12-regular text-text-base">Running timeline tests...</div>
    </BasicTool>
  ),
}

export const Collapsed = {
  render: () => (
    <BasicTool
      icon="magnifying-glass-menu"
      trigger={{ title: "Searched", subtitle: "packages/session-ui", args: ["pattern=TimelineRow.key"] }}
    >
      <div class="px-3 py-2 text-12-regular text-text-base">2 matching files</div>
    </BasicTool>
  ),
}

export const SummaryOnly = {
  render: () => (
    <BasicTool icon="post-skill" hideDetails trigger={{ title: "Skill", subtitle: "rtl-aware-development" }} />
  ),
}

export const Controlled = {
  render: () => {
    const [state, setState] = createStore({ open: false })
    return (
      <div class="flex max-w-[620px] flex-col gap-3">
        <Button class="w-fit" size="small" variant="neutral" onClick={() => setState("open", (value) => !value)}>
          {state.open ? "Close tool details" : "Open tool details"}
        </Button>
        <BasicTool
          icon="code-lines"
          open={state.open}
          onOpenChange={(open) => setState("open", open)}
          trigger={{ title: "Edited", subtitle: "src/session.ts", args: ["+3", "-1"] }}
        >
          <div class="px-3 py-2 text-12-regular text-text-base">Changed the active Session label.</div>
        </BasicTool>
      </div>
    )
  },
}

export const WebFetch = {
  render: () => (
    <BasicTool
      icon="window-cursor"
      hideDetails
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">Webfetch</span>
            <a
              data-slot="basic-tool-tool-subtitle"
              class="webfetch-link"
              href="https://www.figma.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span data-slot="webfetch-link-text">https://www.figma.com</span>
              <Icon name="outline-square-arrow" class="webfetch-link-icon" />
            </a>
          </div>
        </div>
      }
    />
  ),
}

const mockSearchUrls = [
  "https://www.figma.com/community/file/1606560040358762787/figma-mcp-console-setup-guide",
  "https://designagentlab.com",
  "https://www.figma.com/community/whiteboarding?resource_type=widgets",
  "https://figma-console-mcp.southleft.com/mcp",
  "https://designagentlab.com/figma-console-mcp",
  "https://designagentlab.com/figma-tutorials",
  "https://github.com/southleft/figma-console-mcp/issues",
  "https://designagentlab.com/ui-kits",
  "https://designagentlab.com/prototyping-tools",
  "https://www.inthepocket.design/guidelines/figma-mcp/setup-figma-mcp",
  "https://www.figma.com/community/plugins",
  "https://figma-console-mcp.southleft.com/docs",
  "https://designagentlab.com/resources",
  "https://github.com/southleft/figma-console-mcp/releases",
  "https://www.inthepocket.design/blog/figma-mcp",
  "https://designagentlab.com/community",
]

export const WebSearch = {
  render: () => {
    const [showAll, setShowAll] = createSignal(false)
    let firstRevealedRef: HTMLAnchorElement | undefined
    const visibleLinks = () => (showAll() ? mockSearchUrls : mockSearchUrls.slice(0, 10))
    const remaining = () => Math.max(0, mockSearchUrls.length - 10)

    const expand = (event: MouseEvent) => {
      event.stopPropagation()
      setShowAll(true)
      requestAnimationFrame(() => {
        firstRevealedRef?.focus()
      })
    }

    return (
      <BasicTool
        icon="window-cursor"
        defaultOpen
        trigger={{
          title: "Firecrawl Web Search",
          subtitle: "figma mcp setup",
          subtitleClass: "exa-tool-query",
        }}
      >
        <div data-component="exa-tool-output">
          <div data-slot="exa-tool-links">
            <For each={visibleLinks()}>
              {(url, index) => (
                <a
                  ref={(el) => {
                    if (index() === 10) firstRevealedRef = el
                  }}
                  data-slot="exa-tool-link"
                  class="webfetch-link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span data-slot="webfetch-link-text">{url}</span>
                  <Icon name="outline-square-arrow" class="webfetch-link-icon" />
                </a>
              )}
            </For>
            <Show when={!showAll() && remaining() > 0}>
              <button type="button" data-slot="exa-tool-more" onClick={expand}>
                +{remaining()} more
              </button>
            </Show>
          </div>
        </div>
      </BasicTool>
    )
  },
}

export const GatheredContext = {
  render: () => (
    <BasicTool
      icon="bullet-list"
      defaultOpen
      trigger={{ title: "Used", subtitle: "Shell, Explore, Patch", args: ["4"] }}
    >
      <div class="flex flex-col gap-1 text-13-regular text-text-base">
        <div class="flex items-center gap-2">
          <span class="font-medium text-text-base">Shell</span>
          <span class="text-text-muted">opencode2 api get /openapi.json</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium text-text-base">Explore</span>
          <span class="text-text-muted">inspect active v2 beta service</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium text-text-base">Patch</span>
          <span class="text-text-muted">packages/session-ui/src/tools</span>
        </div>
      </div>
    </BasicTool>
  ),
}

export const PatchFileList = {
  render: () => (
    <BasicTool icon="code-lines" defaultOpen trigger={{ title: "Patch", subtitle: "4 files" }}>
      <div class="flex flex-col gap-1.5 text-13-regular text-text-base">
        <div class="flex items-center gap-2">
          <Icon name="file-tree" size="small" />
          <span class="text-text-base">packages/app/src/composer/composer.tsx</span>
        </div>
        <div class="flex items-center gap-2">
          <Icon name="file-tree" size="small" />
          <span class="text-text-base">packages/session-ui/src/tools/tool-renderer.tsx</span>
        </div>
        <div class="flex items-center gap-2">
          <Icon name="file-tree" size="small" />
          <span class="text-text-base">packages/session-ui/src/components/basic-tool.css</span>
        </div>
        <div class="flex items-center gap-2">
          <Icon name="file-tree" size="small" />
          <span class="text-text-base">packages/ui/src/icons/icon/icon.tsx</span>
        </div>
      </div>
    </BasicTool>
  ),
}
