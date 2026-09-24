# Prompts

The two system prompts behind a call, one folder each:

| Folder         | Who reads it                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `gpt-live/`    | GPT-Live, the real-time voice model. Sent once, when the call is created.                             |
| `voice-agent/` | The background agent in the voice session that thinks and acts for GPT-Live through the main session. |

## How a prompt is assembled

`src/server/prompt.ts` reads every `.md` file in the folder in file-name order, removes HTML comments, trims each
section and joins them with a blank line. Then it fills in the placeholders:

| Placeholder     | Value                                |
| --------------- | ------------------------------------ |
| `{{project}}`   | The project folder's name            |
| `{{directory}}` | The directory OpenCode is working in |

Extra instructions from the user's config (`instructions` for GPT-Live, `voiceAgentInstructions` for the voice agent)
are appended under "Additional instructions from the user:". Conversation history is added after that by the server
plugin.

## Editing

- One concern per file. Number the files to set their order, leaving room between numbers is fine.
- Use `<!-- comments -->` for notes to other contributors; they never reach the model.
- Prompts are read at the start of every call. Edit a file, start a new call, and the change is live; no restart.
- The voice agent can only use the tools registered in `src/server/index.ts`. `test/prompt.test.ts` fails if the
  prompt names a `gptlive_*` tool that does not exist.
- Keep GPT-Live's prompt short and spoken in tone; it steers a live conversation.

## Replacing a prompt

Users can replace either prompt with their own file or folder in the plugin options; relative paths resolve against
the project, and `~` expands to the home directory:

```jsonc
{
  "plugins": [
    {
      "package": "shuvcode.gpt-live",
      "options": {
        "prompts": { "gptLive": "~/.config/shuvcode/voice/gpt-live", "voiceAgent": ".opencode/voice-agent.md" },
      },
    },
  ],
}
```

A folder works exactly like the built-in ones, so the easiest start is to copy a folder from here and edit it. If a
custom prompt cannot be read or is empty, the call uses the built-in prompt and says so in the transcript.
