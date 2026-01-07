import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { normalizeBackgrounds, resolveTheme, selectedForeground } from "../src/cli/cmd/tui/context/theme-utils";

describe("TUI Theme", () => {
  describe("normalizeBackgrounds", () => {
    test("should make background fully transparent when transparent is true", () => {
      const resolved: any = {
        background: RGBA.fromInts(255, 255, 255, 255),
      };
      normalizeBackgrounds(resolved, true, "dark");
      expect(resolved.background!.a).toBe(0);
    });

    test("should fallback to backgroundMenu if background is not opaque", () => {
      const resolved: any = {
        background: RGBA.fromInts(0, 0, 0, 0),
        backgroundMenu: RGBA.fromInts(30, 30, 30, 255),
      };
      normalizeBackgrounds(resolved, false, "dark");
      expect(Math.round(resolved.background!.r * 255)).toBe(30);
      expect(resolved.background!.a).toBe(1);
    });

    test("should fallback to backgroundElement if menu is not opaque", () => {
      const resolved: any = {
        background: RGBA.fromInts(0, 0, 0, 0),
        backgroundMenu: RGBA.fromInts(0, 0, 0, 0),
        backgroundElement: RGBA.fromInts(40, 40, 40, 255),
      };
      normalizeBackgrounds(resolved, false, "dark");
      expect(Math.round(resolved.background!.r * 255)).toBe(40);
      expect(resolved.background!.a).toBe(1);
    });

    test("should derive from primary as last resort (dark mode)", () => {
      const resolved: any = {
        primary: RGBA.fromInts(100, 200, 255, 255),
      };
      normalizeBackgrounds(resolved, false, "dark");
      expect(Math.round(resolved.background!.r * 255)).toBe(10);
      expect(Math.round(resolved.background!.g * 255)).toBe(20);
      expect(Math.round(resolved.background!.b * 255)).toBe(26);
      expect(resolved.background!.a).toBe(1);
    });

    test("should derive from primary as last resort (light mode)", () => {
      const resolved: any = {
        primary: RGBA.fromInts(100, 200, 255, 255),
      };
      normalizeBackgrounds(resolved, false, "light");
      expect(Math.round(resolved.background!.r * 255)).toBe(247);
      expect(resolved.background!.a).toBe(1);
    });

    test("should force all backgrounds to be opaque when transparency is off", () => {
      const resolved: any = {
        primary: RGBA.fromInts(255, 255, 255, 255),
        background: RGBA.fromInts(30, 30, 30, 255), // already opaque
        backgroundPanel: RGBA.fromInts(40, 40, 40, 128), // semi-transparent
      };
      normalizeBackgrounds(resolved, false, "dark");
      expect(resolved.background!.a).toBe(1);
      expect(resolved.backgroundPanel!.a).toBe(1);
      expect(Math.round(resolved.backgroundPanel!.r * 255)).toBe(40);
    });
  });

  describe("resolveTheme", () => {
    test("should handle lucent-orng with transparency off", () => {
      const lucentOrngJson = {
        theme: {
          primary: "#ff8c00",
          background: "transparent",
          backgroundPanel: "#1a1a1a80",
          backgroundElement: "#2a2a2a80",
          text: "#ffffff",
          secondary: "#ffffff",
          accent: "#ffffff",
          error: "#ffffff",
          warning: "#ffffff",
          success: "#ffffff",
          info: "#ffffff",
          textMuted: "#ffffff",
          border: "#ffffff",
          borderActive: "#ffffff",
          borderSubtle: "#ffffff",
          diffAdded: "#ffffff",
          diffRemoved: "#ffffff",
          diffContext: "#ffffff",
          diffHunkHeader: "#ffffff",
          diffHighlightAdded: "#ffffff",
          diffHighlightRemoved: "#ffffff",
          diffAddedBg: "#ffffff",
          diffRemovedBg: "#ffffff",
          diffContextBg: "#ffffff",
          diffLineNumber: "#ffffff",
          diffAddedLineNumberBg: "#ffffff",
          diffRemovedLineNumberBg: "#ffffff",
          markdownText: "#ffffff",
          markdownHeading: "#ffffff",
          markdownLink: "#ffffff",
          markdownLinkText: "#ffffff",
          markdownCode: "#ffffff",
          markdownBlockQuote: "#ffffff",
          markdownEmph: "#ffffff",
          markdownStrong: "#ffffff",
          markdownHorizontalRule: "#ffffff",
          markdownListItem: "#ffffff",
          markdownListEnumeration: "#ffffff",
          markdownImage: "#ffffff",
          markdownImageText: "#ffffff",
          markdownCodeBlock: "#ffffff",
          syntaxComment: "#ffffff",
          syntaxKeyword: "#ffffff",
          syntaxFunction: "#ffffff",
          syntaxVariable: "#ffffff",
          syntaxString: "#ffffff",
          syntaxNumber: "#ffffff",
          syntaxType: "#ffffff",
          syntaxOperator: "#ffffff",
          syntaxPunctuation: "#ffffff",
        }
      } as any;

      const theme = resolveTheme(lucentOrngJson, "dark", false);
      expect(theme.background.a).toBe(1);
      expect(theme.transparent).toBe(false);
    });
  });

  describe("selectedForeground", () => {
    test("should verify readable contrast when transparency is off", () => {
      const theme = {
        primary: RGBA.fromInts(0, 255, 255, 255), // Cyan
        background: RGBA.fromInts(30, 30, 30, 255), // Dark
        _hasSelectedListItemText: false,
        transparent: false,
      } as any;

      const fg = selectedForeground(theme);
      expect(fg.r).toBe(theme.background.r);
      expect(fg.a).toBe(1);
    });

    test("should use contrast when transparency is on", () => {
      const theme = {
        primary: RGBA.fromInts(255, 255, 255, 255), // White
        background: RGBA.fromInts(0, 0, 0, 0), // Fully transparent
        _hasSelectedListItemText: false,
        transparent: true,
      } as any;

      const fg = selectedForeground(theme);
      // White primary -> luminance 1 > 0.5 -> black
      expect(Math.round(fg.r * 255)).toBe(0);
      expect(Math.round(fg.g * 255)).toBe(0);
      expect(Math.round(fg.b * 255)).toBe(0);
    });
  });
});
