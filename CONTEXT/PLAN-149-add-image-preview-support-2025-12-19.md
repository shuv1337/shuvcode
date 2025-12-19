# Project Plan: Add image preview support in desktop file viewer

This plan outlines the implementation of image preview support within the file viewer tabs of the desktop application. Currently, image files are displayed as raw base64 strings in the code viewer. This enhancement will detect image files and render them as actual images.

## Requirements

- **Detection**: Automatically identify image files based on their encoding (`base64`) and MIME type (`image/*`), **excluding SVG** (which should render as text/code).
- **Rendering**: Display the image using an `<img>` tag with a data URL.
- **Styling**:
  - Center images within the viewer.
  - Ensure they are properly scaled (contain within viewport).
  - Allow scrolling if the image is larger than the viewport.
  - Maintain consistent padding/margins with the rest of the file viewer.
- **Fallback**: Ensure text and code files continue to render correctly using the syntax highlighter.
- **Support**: Handle common image formats: PNG, JPG, JPEG, GIF, and WEBP.

### SVG Exclusion Rationale

SVG files are excluded from image preview because:

1. SVG is fundamentally XML text that benefits from syntax highlighting.
2. The existing codebase treats SVG as text consistently:
   - The Read tool explicitly excludes SVG from image attachment handling (`packages/opencode/src/tool/read.ts:96`):
     ```typescript
     const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml"
     ```
   - TUI prompt paste handles SVG as raw text, not as image (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:835-843`).
3. Rendering arbitrary SVG in a webview introduces potential security concerns (external resource loads, scripts).

The desktop file viewer should follow the same pattern used elsewhere in the codebase.

## Technical Specifications

### Data Model

The `FileContent` type from the SDK will be used for detection:

```typescript
// packages/sdk/js/src/v2/gen/types.gen.ts
export type FileContent = {
  type: "text"
  content: string
  encoding?: "base64"
  mimeType?: string
  // ... other fields
}
```

### Components and Logic

1.  **File Viewer (SolidJS)**:
    - Update `packages/desktop/src/pages/session.tsx` to include a `Switch` and `Match` logic before rendering the `codeComponent`.
    - Use `f().content?.encoding === "base64"` and `f().content?.mimeType?.startsWith("image/")` as the condition.
    - **Exclude SVG**: Add check `f().content?.mimeType !== "image/svg+xml"` to ensure SVG files render as text.

2.  **Image Container Styling**:
    - A flex container to center the image.
    - `max-width: 100%`, `max-height: 100%`, and `object-contain` for the image element.
    - `overflow: auto` for the container to support scrolling of large images.

### Detection Logic (Follow Read Tool Pattern)

The detection logic should mirror the pattern established in `packages/opencode/src/tool/read.ts:96`:

```typescript
// packages/opencode/src/tool/read.ts:96
const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml"
```

Desktop equivalent for file viewer:

```typescript
const isPreviewableImage = () => {
  const mimeType = f().content?.mimeType
  return f().content?.encoding === "base64" && mimeType?.startsWith("image/") && mimeType !== "image/svg+xml"
}
```

## Actionable Tasks

- [x] **Implementation Preparation**
  - [x] Verify existing `FileContent` usage in `packages/desktop/src/pages/session.tsx`
  - [x] Identify appropriate Tailwind classes for image container and element

- [x] **Core Implementation**
  - [x] Add `Switch`/`Match` logic in `packages/desktop/src/pages/session.tsx`
  - [x] Implement image rendering with data URL: `src={`data:${f().content?.mimeType};base64,${f().content?.content}`}`
  - [x] Apply styling for centering and containment:
    ```tsx
    <div class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 pb-40">
      <img
        src={`data:${f().content?.mimeType};base64,${f().content?.content}`}
        alt={f().path}
        class="max-w-full max-h-full object-contain shadow-lg rounded-sm"
      />
    </div>
    ```

- [ ] **Validation and Testing**
  - [ ] Test with PNG files (base64 encoded)
  - [ ] Test with JPEG files
  - [ ] Test with GIF files (check animation)
  - [ ] Test with SVG files (verify they render as **text/code with syntax highlighting**, NOT as image preview)
  - [ ] Verify that `.ts`, `.tsx`, `.md` files still render with syntax highlighting
  - [ ] Test with large images to ensure scrolling works as expected
  - [ ] Verify that non-image binary files (e.g., PDFs or executables) don't try to render as images (should fall back to raw or messaging)

## Code References

### Internal Files

- `packages/desktop/src/pages/session.tsx`: Main file viewer tab implementation.
- `packages/sdk/js/src/v2/gen/types.gen.ts`: `FileContent` and `FileNode` type definitions.
- `packages/ui/src/components/message-part.tsx`: Reference for image rendering in message attachments.
- `packages/opencode/src/file/index.ts`: Backend logic for reading files and encoding as base64.

### External References

- [Data URLs (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs)
- [SolidJS Switch/Match](https://www.solidjs.com/docs/latest/api#switchmatch)

## Implementation Order

1.  **Phase 1: Detection Logic**: Add the conditional check in `session.tsx`.
2.  **Phase 2: UI Implementation**: Render the `img` tag with basic styling.
3.  **Phase 3: Polishing**: Refine styles for centering, shadows, and scroll behavior.
4.  **Phase 4: Verification**: Test across multiple file types and sizes.

## Validation Criteria

1.  Opening an image file (PNG, JPG, GIF, WEBP) shows the image, not text.
2.  Opening a text file shows the code with syntax highlighting.
3.  **Opening an SVG file shows the XML source code with syntax highlighting** (NOT rendered as image).
4.  Large images can be scrolled.
5.  Small images are centered.
6.  Images fit within the viewer width/height by default (object-contain).

## Review Feedback Integration

This plan was updated based on plan review feedback:

- **SVG exclusion**: Aligned with existing codebase patterns in `read.ts` and TUI prompt paste. SVG is text/XML and benefits from syntax highlighting; rendering it as an image introduces security concerns without significant UX benefit.
- **Detection pattern**: Now explicitly references the canonical pattern from `packages/opencode/src/tool/read.ts:96` to ensure consistency across the codebase.

## Additional Implementation Notes

### Backend Fix for Text File Detection

During implementation, it was discovered that many text files (Dockerfile, Makefile, etc.) were being incorrectly base64 encoded because Bun detects them as `application/octet-stream`.

**Fix applied in `packages/opencode/src/file/index.ts`:**

1. Added `isBinaryContent()` function that checks for null bytes and high ratio of non-printable characters
2. Modified `shouldEncode()` to return `"check"` for `application/octet-stream` files instead of `true`
3. Updated `read()` function to inspect file content when `shouldEncode()` returns `"check"`:
   - If binary content detected → encode as base64
   - If text content detected → return as plain text with syntax highlighting support
