import { Argument, Flag, GlobalFlag } from "effect/unstable/cli"
import { Schema } from "effect"
import { Spec } from "../framework/spec"
import { Updater } from "../services/updater"

export const PrintLogs = GlobalFlag.setting("print-logs")({
  flag: Flag.boolean("print-logs").pipe(
    Flag.withDescription("Print logs to stderr (server logs require --standalone)"),
    Flag.withDefault(false),
  ),
})

declare const OPENCODE_CLI_NAME: string | undefined

const PermissionParams = {
  auto: Flag.boolean("auto").pipe(
    Flag.withDescription("Auto-approve permissions that are not explicitly denied"),
    Flag.withDefault(false),
  ),
  yolo: Flag.boolean("yolo").pipe(Flag.withDefault(false), Flag.withHidden),
  dangerouslySkipPermissions: Flag.boolean("dangerously-skip-permissions").pipe(
    Flag.withDefault(false),
    Flag.withHidden,
  ),
}

const SupervisorInitParams = {
  home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
  project: Flag.string("project").pipe(
    Flag.withDescription("Project directory (default: current directory)"),
    Flag.optional,
  ),
  model: Flag.string("model").pipe(Flag.withDescription("Lead and worker model as provider/model"), Flag.optional),
  auto: Flag.boolean("auto").pipe(Flag.withDescription("Allow automatic tool permissions"), Flag.withDefault(false)),
  endpoint: Flag.string("endpoint").pipe(Flag.withDescription("Existing local server endpoint"), Flag.optional),
  providerURL: Flag.string("provider-url").pipe(Flag.withDescription("OpenAI-compatible model API URL"), Flag.optional),
  profile: Flag.string("profile").pipe(Flag.withDescription("Orchestration profile JSON file"), Flag.optional),
}

const SupervisorTaskParams = { task: Argument.string("task"), home: Flag.string("home").pipe(Flag.optional) }

const Root = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "shuvcode", {
  description: "Shuvcode command line interface",
  params: {
    ...PermissionParams,
    directory: Argument.string("directory").pipe(
      Argument.withDescription("Directory to start Shuvcode in"),
      Argument.optional,
    ),
    continue: Flag.boolean("continue").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("Continue the last session"),
      Flag.withDefault(false),
    ),
    session: Flag.string("session").pipe(
      Flag.withAlias("s"),
      Flag.withDescription("Session ID to continue, or to create if it does not exist"),
      Flag.optional,
    ),
    attachOnly: Flag.boolean("attach-only").pipe(Flag.withDefault(false), Flag.withHidden),
    prompt: Flag.string("prompt").pipe(Flag.withDescription("Prompt to use"), Flag.optional),
  },
  commands: [
    Spec.make("upgrade", {
      description: "Upgrade Shuvcode to the latest or a specific version",
      aliases: ["update"],
      params: {
        target: Argument.string("target").pipe(
          Argument.withDescription("Version to upgrade to (with or without a leading v)"),
          Argument.optional,
        ),
        method: Flag.choice("method", Updater.methods).pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Installation method to use"),
          Flag.optional,
        ),
      },
    }),
    Spec.make("uninstall", {
      description: "Uninstall Shuvcode and remove all related files",
      params: {
        keepConfig: Flag.boolean("keep-config").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Keep configuration files"),
          Flag.withDefault(false),
        ),
        keepData: Flag.boolean("keep-data").pipe(
          Flag.withAlias("d"),
          Flag.withDescription("Keep session data and snapshots"),
          Flag.withDefault(false),
        ),
        dryRun: Flag.boolean("dry-run").pipe(
          Flag.withDescription("Show what would be removed without removing"),
          Flag.withDefault(false),
        ),
        force: Flag.boolean("force").pipe(
          Flag.withAlias("f"),
          Flag.withDescription("Skip confirmation prompts"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("acp", { description: "Start an Agent Client Protocol server", connectionFlags: "unsupported" }),
    Spec.make("api", {
      description: "Make a request to the running server",
      params: {
        request: Argument.string("operation | method path").pipe(
          Argument.withDescription("OpenAPI operation ID, or an HTTP method followed by a path"),
          Argument.variadic({ min: 1, max: 2 }),
        ),
        data: Flag.string("data").pipe(Flag.withAlias("d"), Flag.withDescription("Request body"), Flag.optional),
        header: Flag.string("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription("Request header in name:value form"),
          Flag.atMost(100),
        ),
        param: Flag.keyValuePair("param").pipe(Flag.withDescription("OpenAPI path or query parameter"), Flag.optional),
      },
    }),
    Spec.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [
        Spec.make("agents", { description: "List all agents" }),
        Spec.make("config", { description: "List configuration sources" }),
        Spec.make("paths", {
          description: "Show global paths (data, config, cache, state)",
          params: {
            name: Argument.choice("name", [
              "db",
              "home",
              "data",
              "config",
              "cache",
              "state",
              "tmp",
              "bin",
              "log",
              "repos",
            ]).pipe(
              Argument.withDescription(
                "Print only one path: db, home, data, config, cache, state, tmp, bin, log, repos",
              ),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("auth", {
      description: "manage integrations and credentials",
      commands: [
        Spec.make("list", {
          description: "list integrations and credentials",
          params: {
            format: Flag.choice("format", ["default", "json"]).pipe(
              Flag.withDescription("Output format"),
              Flag.withDefault("default"),
            ),
          },
        }),
        Spec.make("login", {
          description: "connect an integration",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID, name, or well-known provider URL"),
              Argument.optional,
            ),
            method: Flag.string("method").pipe(Flag.withDescription("Authentication method ID"), Flag.optional),
            answer: Flag.string("answer").pipe(
              Flag.withDescription("Provider form answer (key=value; repeat for multiple fields)"),
              Flag.atMost(100),
            ),
          },
        }),
        Spec.make("logout", {
          description: "log out of a saved account",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID or name"),
              Argument.optional,
            ),
            credential: Argument.string("credential").pipe(
              Argument.withDescription("Credential ID or label (opens an account picker when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("export", {
          description: "print stored credentials, including secrets, as JSON",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID or name (exports every integration when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("import", {
          description: "import credentials exported by auth export",
          params: {
            file: Argument.string("file").pipe(
              Argument.withDescription("JSON file to import (reads stdin when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("switch", {
          description: "switch the active account for an integration",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Integration ID or name"),
              Argument.optional,
            ),
            credential: Argument.string("credential").pipe(
              Argument.withDescription("Credential ID or label (opens an account picker when omitted)"),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("mcp", {
      description: "Manage MCP (Model Context Protocol) servers",
      commands: [
        Spec.make("list", { description: "List configured MCP servers and their status" }),
        Spec.make("add", {
          description: "Add an MCP server to your configuration",
          connectionFlags: "unsupported",
          params: {
            name: Argument.string("name").pipe(Argument.withDescription("Name of the MCP server")),
            command: Argument.string("command").pipe(
              Argument.withDescription("Command and arguments for a local server, passed after --"),
              Argument.variadic({ min: 0 }),
            ),
            url: Flag.string("url").pipe(Flag.withDescription("URL for a remote MCP server"), Flag.optional),
            header: Flag.keyValuePair("header").pipe(
              Flag.withDescription("HTTP header for a remote server, as name=value"),
              Flag.optional,
            ),
            env: Flag.keyValuePair("env").pipe(
              Flag.withDescription("Environment variable for a local server, as name=value"),
              Flag.optional,
            ),
            global: Flag.boolean("global").pipe(
              Flag.withDescription("Write to the global config instead of the project config"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("auth", {
          description: "Authenticate with an OAuth-capable remote MCP server",
          params: {
            name: Argument.string("name").pipe(Argument.withDescription("Name of the MCP server"), Argument.optional),
          },
        }),
        Spec.make("logout", {
          description: "Remove stored OAuth credentials for an MCP server",
          params: { name: Argument.string("name").pipe(Argument.withDescription("Name of the MCP server")) },
        }),
      ],
    }),
    Spec.make("plugin", {
      description: "Manage plugins",
      commands: [
        Spec.make("list", {
          description: "List plugins",
          params: {
            builtin: Flag.boolean("builtin").pipe(
              Flag.withDescription("Include built-in server plugins"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("add", {
          description: "Install a plugin and add it to the global configuration",
          connectionFlags: "unsupported",
          params: {
            package: Argument.string("package").pipe(Argument.withDescription("npm registry or Git package specifier")),
          },
        }),
        Spec.make("check", {
          description: "Check package plugins for updates",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Configured package target"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("update", {
          description: "Update package plugins",
          connectionFlags: "unsupported",
          params: {
            target: Argument.string("target").pipe(
              Argument.withDescription("Configured package target; omit to update all outdated plugins"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("remove", {
          description: "Remove a plugin from global configuration",
          connectionFlags: "unsupported",
          params: {
            package: Argument.string("package").pipe(Argument.withDescription("configured package specifier")),
          },
        }),
      ],
    }),
    Spec.make("models", {
      description: "List all available models",
    }),
    Spec.make("stats", {
      description: "Show shareable usage statistics",
      params: {
        days: Flag.integer("days").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
          Flag.withDescription("Show the last N days; 0 means today"),
          Flag.optional,
        ),
        year: Flag.integer("year").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1970, maximum: 9_999 }))),
          Flag.withDescription("Show a calendar year"),
          Flag.optional,
        ),
        all: Flag.boolean("all").pipe(Flag.withDescription("Show lifetime statistics"), Flag.withDefault(false)),
        project: Flag.string("project").pipe(
          Flag.withDescription('Filter by project ID, or use "." for the current project'),
          Flag.optional,
        ),
        models: Flag.boolean("models").pipe(Flag.withDescription("Show model usage"), Flag.withDefault(false)),
        tools: Flag.boolean("tools").pipe(Flag.withDescription("Show tool reliability"), Flag.withDefault(false)),
        cost: Flag.boolean("cost").pipe(Flag.withDescription("Show cost and token details"), Flag.withDefault(false)),
        full: Flag.boolean("full").pipe(Flag.withDescription("Show every detailed section"), Flag.withDefault(false)),
        limit: Flag.integer("limit").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
          Flag.withDescription("Number of rows in detailed sections"),
          Flag.withDefault(5),
        ),
        json: Flag.boolean("json").pipe(Flag.withDescription("Output statistics as JSON"), Flag.withDefault(false)),
      },
    }),
    Spec.make("mini", {
      description: "Start the minimal interactive interface",
      params: {
        continue: Flag.boolean("continue").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Continue the last session"),
          Flag.withDefault(false),
        ),
        session: Flag.string("session").pipe(
          Flag.withAlias("s"),
          Flag.withDescription("Session ID to continue, or to create if it does not exist"),
          Flag.optional,
        ),
        fork: Flag.boolean("fork").pipe(
          Flag.withDescription("Fork the session when continuing"),
          Flag.withDefault(false),
        ),
        replay: Flag.boolean("replay").pipe(
          Flag.withDescription("Restore session history on resume and resize (disable with --no-replay)"),
          Flag.optional,
        ),
        replayLimit: Flag.integer("replay-limit").pipe(
          Flag.withDescription("Limit replay to the newest N messages (default: 200)"),
          Flag.optional,
        ),
        model: Flag.string("model").pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Model to use in the format provider/model"),
          Flag.optional,
        ),
        agent: Flag.string("agent").pipe(Flag.withDescription("Agent to use"), Flag.optional),
        prompt: Flag.string("prompt").pipe(Flag.withDescription("Prompt to use"), Flag.optional),
        demo: Flag.boolean("demo").pipe(Flag.withDefault(false), Flag.withHidden),
      },
    }),
    Spec.make("run", {
      description: "Run Shuvcode with a message",
      params: {
        message: Argument.string("message").pipe(
          Argument.withDescription("Message to send"),
          Argument.variadic({ min: 0 }),
        ),
        continue: Flag.boolean("continue").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Continue the last session"),
          Flag.withDefault(false),
        ),
        session: Flag.string("session").pipe(
          Flag.withAlias("s"),
          Flag.withDescription("Session ID to continue, or to create if it does not exist"),
          Flag.optional,
        ),
        fork: Flag.boolean("fork").pipe(
          Flag.withDescription("Fork the session before continuing"),
          Flag.withDefault(false),
        ),
        model: Flag.string("model").pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Model to use in the format provider/model#variant"),
          Flag.optional,
        ),
        agent: Flag.string("agent").pipe(Flag.withDescription("Agent to use"), Flag.optional),
        format: Flag.choice("format", ["default", "json"]).pipe(
          Flag.withDescription("Output format"),
          Flag.withDefault("default"),
        ),
        file: Flag.string("file").pipe(
          Flag.withAlias("f"),
          Flag.withDescription("File to attach to the message"),
          Flag.atMost(100),
        ),
        title: Flag.string("title").pipe(Flag.withDescription("Session title"), Flag.optional),
        thinking: Flag.boolean("thinking").pipe(Flag.withDescription("Show thinking blocks"), Flag.withDefault(false)),
        ...PermissionParams,
      },
    }),
    Spec.make("session", {
      description: "Manage sessions",
      commands: [
        Spec.make("list", {
          description: "List top-level sessions in the current project, newest first",
          params: {
            maxCount: Flag.integer("max-count").pipe(
              Flag.withAlias("n"),
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
              Flag.withDescription("Limit to N most recent sessions (default: 100)"),
              Flag.optional,
            ),
            format: Flag.choice("format", ["table", "json"]).pipe(
              Flag.withDescription("Output format"),
              Flag.withDefault("table"),
            ),
          },
        }),
        Spec.make("delete", {
          description: "Delete a session and its child sessions",
          params: {
            sessionID: Argument.string("sessionID").pipe(Argument.withDescription("Session ID to delete")),
          },
        }),
        Spec.make("export", {
          description: "Export session data as JSON",
          params: {
            session: Argument.string("session").pipe(
              Argument.withDescription("Session ID to export"),
              Argument.optional,
            ),
            sanitize: Flag.boolean("sanitize").pipe(
              Flag.withDescription("Redact sensitive transcript and file data"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("import", {
          description: "Import session data from a JSON file or URL",
          params: {
            file: Argument.string("file").pipe(Argument.withDescription("JSON file or URL to import")),
            directory: Flag.string("directory").pipe(
              Flag.withDescription("Directory in which to import the session"),
              Flag.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("service", {
      description: "Manage the background server",
      connectionFlags: "unsupported",
      commands: [
        Spec.make("start", { description: "Start the background server" }),
        Spec.make("restart", { description: "Restart the background server" }),
        Spec.make("status", { description: "Show background server status" }),
        Spec.make("stop", { description: "Stop the background server" }),
        Spec.make("get", {
          description: "Get service configuration",
          params: {
            key: Argument.string("key").pipe(Argument.withDescription("Service setting or env"), Argument.optional),
            name: Argument.string("name").pipe(
              Argument.withDescription("Environment variable name"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("set", {
          description: "Set service configuration",
          params: {
            key: Argument.string("key").pipe(Argument.withDescription("Service setting or env")),
            value: Argument.string("value").pipe(
              Argument.withDescription("Setting value or environment variable name"),
            ),
            nestedValue: Argument.string("env-value").pipe(
              Argument.withDescription("Environment variable value"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("unset", {
          description: "Unset service configuration",
          params: {
            key: Argument.string("key").pipe(Argument.withDescription("Service setting or env")),
            name: Argument.string("name").pipe(
              Argument.withDescription("Environment variable name"),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("supervisor", {
      description: "Operate the native task supervisor",
      connectionFlags: "unsupported",
      commands: [
        Spec.make("up", {
          description: "Set up and start a supervisor with a lead",
          params: {
            ...SupervisorInitParams,
            open: Flag.boolean("open").pipe(
              Flag.withDescription("Open the lead TUI after startup"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("init", {
          description: "Set up a supervisor home for a project",
          params: SupervisorInitParams,
        }),
        Spec.make("start", {
          description: "Start the supervisor",
          params: { home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional) },
        }),
        Spec.make("stop", {
          description: "Stop the supervisor",
          params: { home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional) },
        }),
        Spec.make("lead", {
          description: "Open the lead session",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            session: Flag.string("session").pipe(Flag.withDescription("Adopt an existing lead session"), Flag.optional),
            new: Flag.boolean("new").pipe(Flag.withDescription("Create a new lead session"), Flag.withDefault(false)),
            noOpen: Flag.boolean("no-open").pipe(
              Flag.withDescription("Print the attach command without opening the TUI"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("attach", {
          description: "View an existing Session without starting work",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory")),
            homeID: Flag.string("home-id").pipe(Flag.withDescription("Expected supervisor home ID")),
            session: Flag.string("session").pipe(Flag.withDescription("Existing Session ID")),
            location: Flag.string("location").pipe(Flag.withDescription("Expected Session directory")),
            json: Flag.boolean("json").pipe(
              Flag.withDescription("Resolve attachment without opening"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("presentation", {
          description: "Read native Session display state",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            json: Flag.boolean("json").pipe(Flag.withDescription("Print JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("send", {
          description: "Send a message to the lead",
          params: {
            message: Argument.string("message"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
          },
        }),
        Spec.make("read", {
          description: "Show the lead's latest reply",
          params: { home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional) },
        }),
        Spec.make("status", {
          description: "Show supervisor and task status",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            task: Flag.string("task").pipe(Flag.withDescription("Show one task"), Flag.optional),
            watch: Flag.boolean("watch").pipe(
              Flag.withDescription("Refresh until interrupted"),
              Flag.withDefault(false),
            ),
            json: Flag.boolean("json").pipe(
              Flag.withDescription("Print machine-readable JSON"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("projects", {
          description: "List registered projects",
          params: {
            home: Flag.string("home").pipe(Flag.optional),
            all: Flag.boolean("all").pipe(Flag.withDescription("Include archived projects"), Flag.withDefault(false)),
          },
        }),
        Spec.make("project", {
          description: "Manage registered projects",
          commands: [
            Spec.make("add", {
              description: "Register an existing Git repository",
              params: {
                path: Argument.string("path"),
                name: Flag.string("name").pipe(Flag.withDescription("Project ID"), Flag.optional),
                home: Flag.string("home").pipe(Flag.optional),
              },
            }),
            Spec.make("clone", {
              description: "Clone and register a Git repository",
              params: {
                url: Argument.string("url"),
                name: Argument.string("name"),
                home: Flag.string("home").pipe(Flag.optional),
              },
            }),
            Spec.make("new", {
              description: "Initialize and register a blank Git repository",
              params: { name: Argument.string("name"), home: Flag.string("home").pipe(Flag.optional) },
            }),
            Spec.make("set", {
              description: "Update a project's policy",
              params: {
                name: Argument.string("name"),
                home: Flag.string("home").pipe(Flag.optional),
                description: Flag.string("description").pipe(Flag.optional),
                base: Flag.string("base").pipe(Flag.withDescription("Git base ref"), Flag.optional),
                mode: Flag.choice("mode", ["no-mistakes", "direct-PR", "local-only", "no-mistakes-prod-only"]).pipe(
                  Flag.optional,
                ),
                yolo: Flag.boolean("yolo").pipe(Flag.withDefault(false)),
                noYolo: Flag.boolean("no-yolo").pipe(Flag.withDefault(false)),
                model: Flag.string("model").pipe(Flag.optional),
                agent: Flag.string("agent").pipe(Flag.optional),
              },
            }),
            Spec.make("default", {
              description: "Select the default project",
              params: { name: Argument.string("name"), home: Flag.string("home").pipe(Flag.optional) },
            }),
            Spec.make("archive", {
              description: "Archive a project and preserve its files",
              params: { name: Argument.string("name"), home: Flag.string("home").pipe(Flag.optional) },
            }),
            Spec.make("restore", {
              description: "Restore an archived project",
              params: { name: Argument.string("name"), home: Flag.string("home").pipe(Flag.optional) },
            }),
          ],
        }),
        Spec.make("backlog", {
          description: "List queued and active work",
          params: {
            home: Flag.string("home").pipe(Flag.optional),
            project: Flag.string("project").pipe(Flag.optional),
            status: Flag.choice("status", ["queued", "in-flight", "done", "cancelled"]).pipe(Flag.optional),
          },
        }),
        Spec.make("bearings", {
          description: "Show underway work, decisions, queue gates, and recent results",
          params: { home: Flag.string("home").pipe(Flag.optional) },
        }),
        Spec.make("board", {
          description: "Open the fleet and decision board",
          params: {
            home: Flag.string("home").pipe(Flag.optional),
            port: Flag.integer("port").pipe(Flag.withDefault(0)),
            noOpen: Flag.boolean("no-open").pipe(Flag.withDefault(false)),
          },
        }),
        Spec.make("discard", {
          description: "Archive and discard a terminal task worktree",
          params: {
            ...SupervisorTaskParams,
            reference: Flag.string("reference").pipe(Flag.withDescription("User decision authorizing discard")),
          },
        }),
        Spec.make("delivery", {
          description: "Prepare, publish, and land completed work",
          commands: [
            Spec.make("prepare", {
              description: "Check the completed work and capture its source and target",
              params: SupervisorTaskParams,
            }),
            Spec.make("publish", {
              description: "Publish an origin PR for prepared work",
              params: { ...SupervisorTaskParams, title: Flag.string("title"), bodyFile: Flag.string("body-file") },
            }),
            Spec.make("approve", {
              description: "Approve the current source and target commits for landing",
              params: { ...SupervisorTaskParams, reference: Flag.string("reference") },
            }),
            Spec.make("land", {
              description: "Land approved work after current checks pass",
              params: SupervisorTaskParams,
            }),
            Spec.make("cancel", {
              description: "Cancel delivery and reconcile any active validation",
              params: SupervisorTaskParams,
            }),
            Spec.make("reconcile", {
              description: "Verify the outcome of an interrupted publish or landing",
              params: { ...SupervisorTaskParams, pr: Flag.string("pr").pipe(Flag.optional) },
            }),
            Spec.make("cleanup", {
              description: "Remove a clean worktree after verified landing",
              params: SupervisorTaskParams,
            }),
          ],
        }),
        Spec.make("validate", {
          description: "Operate the task's no-mistakes validation",
          commands: [
            Spec.make("start", {
              description: "Start validation for prepared work",
              params: {
                ...SupervisorTaskParams,
                intent: Flag.string("intent"),
                generation: Flag.integer("generation").pipe(Flag.optional),
              },
            }),
            Spec.make("status", {
              description: "Show the bound validation run",
              params: { ...SupervisorTaskParams, generation: Flag.integer("generation").pipe(Flag.optional) },
            }),
            Spec.make("abort", {
              description: "Abort the bound validation run and verify it stopped",
              params: { ...SupervisorTaskParams, generation: Flag.integer("generation").pipe(Flag.optional) },
            }),
            Spec.make("respond", {
              description: "Respond to a validation gate",
              params: {
                ...SupervisorTaskParams,
                action: Flag.choice("action", ["approve", "fix", "skip"]),
                finding: Flag.string("finding").pipe(Flag.atMost(100)),
                instructions: Flag.string("instructions").pipe(Flag.optional),
                reference: Flag.string("reference").pipe(Flag.optional),
                generation: Flag.integer("generation").pipe(Flag.optional),
              },
            }),
          ],
        }),
        Spec.make("task", {
          description: "Create a supervised task",
          params: {
            brief: Argument.string("brief").pipe(Argument.withDescription("Work to assign")),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            name: Flag.string("name").pipe(Flag.withDescription("Short task name"), Flag.optional),
            kind: Flag.choice("kind", ["ship", "scout"]).pipe(
              Flag.withDescription("Task kind"),
              Flag.withDefault("ship"),
            ),
            project: Flag.string("project").pipe(Flag.withDescription("Registered project ID"), Flag.optional),
            base: Flag.string("base").pipe(Flag.withDescription("Git base ref"), Flag.optional),
            model: Flag.string("model").pipe(Flag.withDescription("Worker model as provider/model"), Flag.optional),
            agent: Flag.string("agent").pipe(Flag.withDescription("Worker agent"), Flag.optional),
            dependsOn: Flag.string("depends-on").pipe(
              Flag.withDescription("Wait until work ID is done"),
              Flag.atMost(100),
            ),
            afterLanded: Flag.string("after-landed").pipe(
              Flag.withDescription("Wait until work ID is landed"),
              Flag.atMost(100),
            ),
            hold: Flag.string("hold").pipe(Flag.withDescription("Hold until released"), Flag.optional),
            until: Flag.string("until").pipe(Flag.withDescription("Hold expiry as ISO date/time"), Flag.optional),
            notBefore: Flag.string("not-before").pipe(
              Flag.withDescription("Earliest dispatch as ISO date/time"),
              Flag.optional,
            ),
            resource: Flag.string("resource").pipe(Flag.withDescription("Exclusive resource key"), Flag.atMost(100)),
            priority: Flag.integer("priority").pipe(Flag.optional),
            mode: Flag.choice("mode", ["no-mistakes", "direct-PR", "local-only"]).pipe(Flag.optional),
            merge: Flag.choice("merge", ["auto", "manual"]).pipe(Flag.optional),
            classification: Flag.choice("classification", ["internal", "product", "mixed", "uncertain"]).pipe(
              Flag.optional,
            ),
          },
        }),
        Spec.make("hold", {
          description: "Hold queued work",
          params: {
            id: Argument.string("id"),
            reason: Argument.string("reason"),
            until: Flag.string("until").pipe(Flag.optional),
            home: Flag.string("home").pipe(Flag.optional),
          },
        }),
        Spec.make("release", {
          description: "Release held work",
          params: {
            id: Argument.string("id"),
            home: Flag.string("home").pipe(Flag.optional),
          },
        }),
        Spec.make("retry", {
          description: "Retry a work item",
          params: {
            id: Argument.string("id"),
            home: Flag.string("home").pipe(Flag.optional),
          },
        }),
        Spec.make("dispatch", {
          description: "Dispatch eligible work",
          params: {
            id: Argument.string("id"),
            home: Flag.string("home").pipe(Flag.optional),
          },
        }),
        Spec.make("interrupt", {
          description: "Interrupt a running task",
          params: {
            id: Argument.string("id"),
            home: Flag.string("home").pipe(Flag.optional),
          },
        }),
        Spec.make("resume", {
          description: "Resume an interrupted task",
          params: {
            id: Argument.string("id"),
            message: Argument.string("message").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
          },
        }),
        Spec.make("show", {
          description: "Show a task's latest report",
          params: {
            task: Argument.string("task"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
          },
        }),
        Spec.make("steer", {
          description: "Send guidance to a task",
          params: {
            task: Argument.string("task"),
            message: Argument.string("message"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            queue: Flag.boolean("queue").pipe(
              Flag.withDescription("Deliver after current work"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("cancel", {
          description: "Cancel a task",
          params: {
            task: Argument.string("task"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
          },
        }),
        Spec.make("recover", {
          description: "Recover a task after uncertain delivery",
          params: {
            task: Argument.string("task"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
          },
        }),
        Spec.make("complete", {
          description: "Mark a verified task complete",
          params: {
            task: Argument.string("task"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
          },
        }),
        Spec.make("cleanup", {
          description: "Clean up a landed task",
          params: {
            task: Argument.string("task"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            landed: Flag.string("landed").pipe(Flag.withDescription("Landed Git ref or commit")),
          },
        }),
        Spec.make("decisions", {
          description: "List open decisions",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            task: Flag.string("task").pipe(Flag.withDescription("Show one task"), Flag.optional),
          },
        }),
        Spec.make("answer", {
          description: "Answer a worker decision",
          params: {
            task: Argument.string("task"),
            decision: Argument.string("decision"),
            text: Argument.string("text"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
          },
        }),
        Spec.make("approve", {
          description: "Answer a worker permission request",
          params: {
            task: Argument.string("task"),
            request: Argument.string("request"),
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional),
            deny: Flag.boolean("deny").pipe(Flag.withDescription("Deny this request"), Flag.withDefault(false)),
          },
        }),
        Spec.make("doctor", {
          description: "Check supervisor setup and recovery",
          params: { home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory"), Flag.optional) },
        }),
        Spec.make("daemon", {
          description: "Internal pilot process",
          params: { home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory")) },
        }),
        Spec.make("native", {
          description: "Internal pilot server process",
          params: { port: Flag.integer("port").pipe(Flag.withDescription("Local native server port")) },
        }),
        Spec.make("serve", {
          description: "Start a supervisor bound to an explicit native server",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory")),
            endpoint: Flag.string("endpoint").pipe(Flag.withDescription("Native server HTTP endpoint")),
            port: Flag.integer("port").pipe(
              Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65_535 }))),
              Flag.withDescription("Local supervisor port (0 chooses a free port)"),
              Flag.withDefault(0),
            ),
          },
        }),
        Spec.make("request", {
          description: "Send one JSON operation to the local supervisor",
          params: {
            home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory")),
            file: Flag.string("file").pipe(
              Flag.withDescription("JSON request file (stdin when omitted)"),
              Flag.optional,
            ),
          },
        }),
        Spec.make("voice", {
          description: "Configure speech, read status, or capture a spoken request",
          params: {
            action: Argument.choice("action", ["configure", "snapshot", "enqueue", "serve", "talk", "test"]),
            file: Argument.string("file").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            region: Flag.string("region").pipe(Flag.optional),
            model: Flag.string("model").pipe(Flag.optional),
            profile: Flag.string("profile").pipe(Flag.optional),
            voice: Flag.string("voice").pipe(Flag.optional),
            scope: Flag.choice("scope", ["counts", "full"]).pipe(Flag.optional),
            deny: Flag.string("deny").pipe(Flag.atMost(100)),
            clearDeny: Flag.boolean("clear-deny").pipe(Flag.withDefault(false)),
            python: Flag.string("python").pipe(Flag.optional),
            host: Flag.string("host").pipe(Flag.optional),
            interactionID: Flag.string("interaction-id").pipe(Flag.optional),
            request: Flag.string("request").pipe(Flag.optional),
            inputDevice: Flag.string("input-device").pipe(Flag.optional),
            outputDevice: Flag.string("output-device").pipe(Flag.optional),
            runs: Flag.integer("runs").pipe(Flag.withDefault(1)),
          },
        }),
        Spec.make("channel", {
          description: "Manage the public Relay channels and explicit transport actions",
          params: {
            action: Argument.choice("action", ["list", "configure", "poll", "flush"]),
            id: Argument.string("id").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            kind: Flag.choice("kind", ["local", "relay", "voice", "command"]).pipe(Flag.optional),
            endpoint: Flag.string("endpoint").pipe(Flag.optional),
            directory: Flag.string("directory").pipe(
              Flag.withDescription("ShuvBro state/inbox directory for voice notes"),
              Flag.optional,
            ),
            automaticReplies: Flag.boolean("auto-replies").pipe(
              Flag.withDescription("Allow prepared replies to be posted automatically"),
              Flag.withDefault(false),
            ),
            enabled: Flag.choice("enabled", ["on", "off"]).pipe(Flag.optional),
          },
        }),
        Spec.make("inbox", {
          description: "List, record, acknowledge, or dismiss supervisor inbox notes",
          params: {
            action: Argument.choice("action", ["list", "note", "ack", "dismiss", "reconcile-dismiss"]),
            id: Argument.string("id").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            text: Flag.string("text").pipe(Flag.optional),
            source: Flag.choice("source", ["operator", "relay", "voice"]).pipe(Flag.optional),
            state: Flag.choice("state", ["pending", "notified", "delivered", "handled"]).pipe(Flag.optional),
            origin: Flag.choice("origin", ["x", "discord", "local"]).pipe(Flag.optional),
            requestID: Flag.string("request-id").pipe(Flag.optional),
            replyMaxChars: Flag.integer("reply-max-chars").pipe(Flag.optional),
            outcome: Flag.choice("outcome", ["sent", "not-sent"]).pipe(Flag.optional),
          },
        }),
        Spec.make("reply", {
          description: "List, promise, and prepare replies, or reconcile uncertain delivery",
          params: {
            action: Argument.choice("action", [
              "list",
              "show",
              "promise",
              "send",
              "reconcile",
              "ack",
              "retire",
              "rechain",
            ]),
            id: Argument.string("id").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            sourceID: Flag.string("source").pipe(Flag.optional),
            workID: Flag.string("work-id").pipe(Flag.optional),
            taskID: Flag.string("task-id").pipe(Flag.optional),
            handoffID: Flag.string("handoff-id").pipe(Flag.optional),
            newID: Flag.string("new-id").pipe(Flag.optional),
            reason: Flag.string("reason").pipe(Flag.optional),
            text: Flag.string("text").pipe(Flag.optional),
            imagePath: Flag.string("image").pipe(Flag.optional),
            dueAt: Flag.integer("due-at").pipe(Flag.optional),
            outcome: Flag.choice("outcome", ["sent", "not-sent"]).pipe(Flag.optional),
          },
        }),
        Spec.make("away", {
          description: "Confirm an away posture or review return catch-up",
          params: {
            action: Argument.choice("action", ["get", "enter", "propose", "confirm", "return", "check", "reclassify"]),
            id: Argument.string("id").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            words: Flag.string("words").pipe(Flag.optional),
            clauseActions: Flag.string("action").pipe(Flag.atMost(100)),
            objects: Flag.string("object").pipe(Flag.atMost(100)),
            conditions: Flag.string("when").pipe(Flag.atMost(100)),
            stops: Flag.string("stop").pipe(Flag.atMost(100)),
            expectedReturn: Flag.string("expected-return").pipe(Flag.optional),
            spend: Flag.string("spend").pipe(Flag.optional),
            expectedReason: Flag.string("expected-reason").pipe(Flag.optional),
            kind: Flag.choice("kind", ["external-wait", "user-decision"]).pipe(Flag.optional),
            reason: Flag.string("reason").pipe(Flag.optional),
            reference: Flag.string("reference").pipe(Flag.optional),
          },
        }),
        Spec.make("knowledge", {
          description: "Manage scoped supervisor knowledge",
          params: {
            action: Argument.choice("action", [
              "list",
              "get",
              "put",
              "stow",
              "archive",
              "shared-status",
              "cascade",
              "startup",
              "budget",
            ]),
            id: Argument.string("id").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            scope: Flag.choice("scope", ["preferences", "shared", "fleet", "project", "task"]).pipe(Flag.optional),
            scopeID: Flag.string("scope-id").pipe(Flag.optional),
            title: Flag.string("title").pipe(Flag.optional),
            content: Flag.string("content").pipe(Flag.optional),
            tier: Flag.choice("tier", ["pinned", "aging", "perishable"]).pipe(Flag.optional),
            evidence: Flag.string("evidence").pipe(Flag.optional),
            expiresAt: Flag.integer("expires-at").pipe(Flag.optional),
            expiryCondition: Flag.string("expiry-condition").pipe(Flag.optional),
            plan: Flag.string("plan").pipe(Flag.optional),
            budgetTokens: Flag.integer("budget-tokens").pipe(Flag.optional),
          },
        }),
        Spec.make("delegate", {
          description: "List and manage registered delegate supervisors",
          params: {
            action: Argument.choice("action", ["list", "add", "update", "archive", "provision", "status", "send"]),
            id: Argument.string("id").pipe(Argument.optional),
            home: Flag.string("home").pipe(Flag.optional),
            delegateHome: Flag.string("delegate-home").pipe(Flag.optional),
            sourceProjectID: Flag.string("source-project").pipe(Flag.optional),
            host: Flag.string("host").pipe(Flag.optional),
            scope: Flag.string("scope").pipe(Flag.optional),
            projectID: Flag.string("project-id").pipe(Flag.optional),
            project: Flag.string("project").pipe(Flag.optional),
            enabled: Flag.choice("enabled", ["on", "off"]).pipe(Flag.optional),
            model: Flag.string("model").pipe(Flag.optional),
            providerURL: Flag.string("provider-url").pipe(Flag.optional),
            text: Flag.string("text").pipe(Flag.optional),
            delivery: Flag.choice("delivery", ["steer", "queue"]).pipe(Flag.optional),
          },
        }),
        Spec.make("handoff", {
          description: "Create or inspect a durable delegated work handoff",
          params: {
            action: Argument.choice("action", ["create", "status", "retry", "cancel"]),
            id: Argument.string("id"),
            home: Flag.string("home").pipe(Flag.optional),
            delegateID: Flag.string("delegate").pipe(Flag.optional),
            workIDs: Flag.string("work").pipe(Flag.atMost(100)),
          },
        }),
        Spec.make("bridge", {
          description: "Forward one stdin JSON operation to this host's supervisor",
          params: { home: Flag.string("home").pipe(Flag.withDescription("Supervisor state directory")) },
        }),
      ],
    }),
    Spec.make("reload", {
      description: "Reload configuration",
    }),
    Spec.make("pair", {
      description: "Print one-time links to connect a browser or app",
      connectionFlags: "unsupported",
      params: {
        url: Flag.string("url").pipe(
          Flag.withDescription("Use an external HTTP(S) server URL in pairing links"),
          Flag.mapTryCatch(
            (value) => {
              const url = new URL(value)
              if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
                throw new Error("Invalid pairing URL")
              return url.href.replace(/\/+$/, "")
            },
            () => "Expected an HTTP(S) server URL without credentials, query parameters, or a fragment",
          ),
          Flag.optional,
        ),
      },
    }),
    Spec.make("serve", {
      description: "Start the v2 API and web server",
      connectionFlags: "unsupported",
      params: {
        hostname: Flag.string("hostname").pipe(Flag.optional),
        port: Flag.integer("port").pipe(Flag.optional),
        cors: Flag.string("cors").pipe(
          Flag.withSchema(Schema.NonEmptyString),
          Flag.withDescription("Additional allowed CORS origin (repeat for multiple origins)"),
          Flag.atLeast(0),
        ),
        service: Flag.boolean("service").pipe(Flag.withDefault(false)),
        stdio: Flag.boolean("stdio").pipe(Flag.withDefault(false)),
      },
    }),
  ],
})

export const Commands = Root
