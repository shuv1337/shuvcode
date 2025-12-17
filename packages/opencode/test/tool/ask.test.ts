import { describe, expect, test } from "bun:test"
import { AskTool } from "../../src/tool/ask"

describe("tool.ask normalization", () => {
  // Get the schema from the tool for testing
  const getSchema = async () => {
    const tool = await AskTool.init()
    return tool.parameters
  }

  describe("options normalization", () => {
    test("accepts string array options and normalizes to {value, label} objects", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "select",
            id: "test",
            message: "Pick one",
            options: ["Option A", "Option B", "Option C"],
          },
        ],
      }
      const result = schema.parse(input)
      const q = result.questions[0] as { type: "select"; options: { value: string; label: string }[] }
      expect(q.options).toEqual([
        { value: "Option A", label: "Option A" },
        { value: "Option B", label: "Option B" },
        { value: "Option C", label: "Option C" },
      ])
    })

    test("accepts options with only value and fills label", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "select",
            id: "test",
            message: "Pick one",
            options: [{ value: "a" }, { value: "b" }],
          },
        ],
      }
      const result = schema.parse(input)
      const q = result.questions[0] as { type: "select"; options: { value: string; label: string }[] }
      expect(q.options).toEqual([
        { value: "a", label: "a" },
        { value: "b", label: "b" },
      ])
    })

    test("accepts options with only label and fills value", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "select",
            id: "test",
            message: "Pick one",
            options: [{ label: "First" }, { label: "Second" }],
          },
        ],
      }
      const result = schema.parse(input)
      const q = result.questions[0] as { type: "select"; options: { value: string; label: string }[] }
      expect(q.options).toEqual([
        { value: "First", label: "First" },
        { value: "Second", label: "Second" },
      ])
    })

    test("preserves hint in options", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "select",
            id: "test",
            message: "Pick one",
            options: [{ value: "a", label: "A", hint: "Choose this for X" }],
          },
        ],
      }
      const result = schema.parse(input)
      const q = result.questions[0] as { type: "select"; options: { value: string; label: string; hint?: string }[] }
      expect(q.options[0].hint).toBe("Choose this for X")
    })
  })

  describe("message alias normalization", () => {
    test("accepts 'text' as alias for 'message'", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "confirm",
            id: "test",
            text: "Do you want to proceed?",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].message).toBe("Do you want to proceed?")
    })

    test("accepts 'prompt' as alias for 'message'", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "confirm",
            id: "test",
            prompt: "Continue?",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].message).toBe("Continue?")
    })

    test("accepts 'question' as alias for 'message'", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "text",
            id: "test",
            question: "What is your name?",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].message).toBe("What is your name?")
    })

    test("prefers 'message' over aliases when present", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "confirm",
            id: "test",
            message: "Canonical message",
            text: "Alias text",
            prompt: "Alias prompt",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].message).toBe("Canonical message")
    })
  })

  describe("type normalization", () => {
    test("normalizes 'multiselect' to 'multi-select'", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "multiselect",
            id: "test",
            message: "Select multiple",
            options: ["A", "B"],
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("multi-select")
    })

    test("normalizes 'multi_select' to 'multi-select'", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "multi_select",
            id: "test",
            message: "Select multiple",
            options: ["A", "B"],
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("multi-select")
    })

    test("normalizes 'multi' to 'multi-select'", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "multi",
            id: "test",
            message: "Select multiple",
            options: ["A", "B"],
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("multi-select")
    })
  })

  describe("multi-select defaultValue normalization", () => {
    test("wraps string defaultValue into array for multi-select", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "multi-select",
            id: "test",
            message: "Select options",
            options: ["A", "B", "C"],
            defaultValue: "A",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].defaultValue).toEqual(["A"])
    })

    test("accepts array defaultValue for multi-select as-is", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "multi-select",
            id: "test",
            message: "Select options",
            options: ["A", "B", "C"],
            defaultValue: ["A", "B"],
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].defaultValue).toEqual(["A", "B"])
    })
  })

  describe("timeout normalization", () => {
    test("accepts string timeout and parses to number", async () => {
      const schema = await getSchema()
      const input = {
        questions: [{ type: "confirm", id: "test", message: "OK?" }],
        timeout: "60000",
      }
      const result = schema.parse(input)
      expect(result.timeout).toBe(60000)
    })

    test("accepts number timeout as-is", async () => {
      const schema = await getSchema()
      const input = {
        questions: [{ type: "confirm", id: "test", message: "OK?" }],
        timeout: 30000,
      }
      const result = schema.parse(input)
      expect(result.timeout).toBe(30000)
    })
  })

  describe("id auto-generation", () => {
    test("generates id if missing", async () => {
      const schema = await getSchema()
      const input = {
        questions: [{ type: "confirm", message: "OK?" }],
      }
      const result = schema.parse(input)
      expect(result.questions[0].id).toBeDefined()
      expect(result.questions[0].id.startsWith("q-")).toBe(true)
    })
  })

  describe("canonical question types", () => {
    test("accepts valid select question", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "select",
            id: "choice",
            message: "Pick one",
            options: [
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
            ],
            defaultValue: "a",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("select")
    })

    test("accepts valid multi-select question", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "multi-select",
            id: "choices",
            message: "Pick many",
            options: [
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
            ],
            defaultValue: ["a"],
            min: 1,
            max: 2,
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("multi-select")
    })

    test("accepts valid confirm question", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "confirm",
            id: "confirm",
            message: "Are you sure?",
            defaultValue: true,
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("confirm")
    })

    test("accepts valid text question", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          {
            type: "text",
            id: "name",
            message: "Enter your name",
            placeholder: "John Doe",
            defaultValue: "",
            validate: "^[a-zA-Z ]+$",
          },
        ],
      }
      const result = schema.parse(input)
      expect(result.questions[0].type).toBe("text")
    })
  })

  describe("multi-question support", () => {
    test("accepts multiple questions of different types", async () => {
      const schema = await getSchema()
      const input = {
        questions: [
          { type: "confirm", id: "q1", message: "Continue?" },
          { type: "select", id: "q2", message: "Pick one", options: ["A", "B"] },
          { type: "text", id: "q3", message: "Enter value" },
        ],
        title: "Setup Wizard",
      }
      const result = schema.parse(input)
      expect(result.questions.length).toBe(3)
      expect(result.title).toBe("Setup Wizard")
    })
  })

  describe("error handling", () => {
    test("fails on truly missing message (no aliases)", async () => {
      const schema = await getSchema()
      const input = {
        questions: [{ type: "confirm", id: "test" }],
      }
      expect(() => schema.parse(input)).toThrow()
    })

    test("fails on invalid question type after normalization", async () => {
      const schema = await getSchema()
      const input = {
        questions: [{ type: "invalid_type", id: "test", message: "Test" }],
      }
      expect(() => schema.parse(input)).toThrow()
    })
  })
})
