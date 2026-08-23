export * as LocationMutation from "./location-mutation.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Environment } from "./environment"
import { Location } from "./location.js"
import { Project } from "./project.js"
import { AbsolutePath } from "./schema.js"

export const Kind = Schema.Literals(["file", "directory"])
export type Kind = typeof Kind.Type

/**
 * Mutation paths do not accept project references. Relative paths resolve
 * from the active Location. Paths outside it require separate
 * `external_directory` approval.
 */
export const ResolveInput = Schema.Struct({
  path: Schema.String,
  /** Selects the external approval boundary; it does not validate the target type. */
  kind: Kind.pipe(Schema.optional),
})
export type ResolveInput = typeof ResolveInput.Type

export interface ExternalDirectoryAuthorization {
  readonly action: "external_directory"
  /** Lexical directory used as the external approval boundary. */
  readonly directory: string
  /** `external_directory` permission resource. */
  readonly resource: string
  readonly save: string
}

export const externalDirectoryPermission = (input: ExternalDirectoryAuthorization) => ({
  action: input.action,
  resources: [input.resource],
  save: [input.save],
})

export interface Target {
  /** Absolute lexical path. */
  readonly absolute: string
  /** Permission resource: Location-relative for internal paths, absolute for external paths. */
  readonly resource: string
  readonly externalDirectory?: ExternalDirectoryAuthorization
}

export interface Interface {
  /**
   * Resolve a path and derive its permission resources. Relative paths resolve
   * from the Location. Paths outside it require separate `external_directory`
   * approval. This does not approve the mutation.
   */
  readonly resolve: (input: ResolveInput) => Effect.Effect<Target, FSUtil.Error | Environment.Failed>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationMutation") {}

const slash = (value: string) => value.replaceAll("\\", "/")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const environment = yield* Environment.Service
    const location = yield* Location.Service

    const resolve = Effect.fnUntraced(function* (input: ResolveInput) {
      const root = yield* environment.files.realpath(location.directory)
      const absolute = yield* environment.files.realpath(path.resolve(location.directory, input.path))
      if (FSUtil.contains(root, absolute)) {
        return {
          absolute,
          resource: slash(path.relative(root, absolute) || "."),
        } satisfies Target
      }
      const type =
        input.kind === "directory"
          ? "Directory"
          : input.kind === "file"
            ? "File"
            : (yield* fs.stat(absolute).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined)))
                ?.type
      const externalDirectory = type === "Directory" ? absolute : path.dirname(absolute)
      const externalResource = slash(path.join(externalDirectory, "*"))
      return {
        absolute,
        resource: slash(absolute),
        externalDirectory: {
          action: "external_directory",
          directory: externalDirectory,
          resource: externalResource,
          save: slash(
            path.join((yield* Project.root(fs, AbsolutePath.make(externalDirectory))) ?? externalDirectory, "*"),
          ),
        },
      } satisfies Target
    })

    return Service.of({ resolve })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [FSUtil.node, Environment.node, Location.node],
})
