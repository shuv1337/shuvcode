// Tests must not discover a developer's config, providers, or credentials through
// inherited environment variables. Share this with subprocess fixtures and preloads.
export function cleanProcessEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !/^(?:OPENCODE|SHUVCODE|AWS|AZURE|GOOGLE|GCP|GCLOUD|VERTEX|OPENAI|ANTHROPIC|GEMINI|XAI|CLOUDFLARE|CF_AIG|SNOWFLAKE|AICORE|GITLAB|NPM_CONFIG)_/i.test(
          entry[0],
        ) &&
        !/(?:^|_)(?:API_KEY|AUTHORIZATION|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i.test(entry[0]),
    ),
  )
}
