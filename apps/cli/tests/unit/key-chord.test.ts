import { describe, expect, it } from "vitest";
import { isReadOnlyKeyChord, normalizeKeyChord } from "../../src/capture/key-chord.js";

describe("keyboard chords", () => {
  it("normalizes aliases and canonical modifier order", () => {
    expect(normalizeKeyChord("Shift+Cmd+k", "darwin")).toEqual(["Shift", "Meta", "K"]);
    expect(normalizeKeyChord("esc", "darwin")).toEqual(["Escape"]);
  });

  it("resolves ControlOrMeta for the capture host", () => {
    expect(normalizeKeyChord("ControlOrMeta+K", "darwin")).toEqual(["Meta", "K"]);
    expect(normalizeKeyChord("ControlOrMeta+K", "linux")).toEqual(["Control", "K"]);
  });

  it("rejects malformed or multi-key chords", () => {
    expect(() => normalizeKeyChord("Meta++K")).toThrow(/Malformed/);
    expect(() => normalizeKeyChord("K+P")).toThrow(/more than one/);
  });

  it("classifies only conservative navigation and command-palette keys as read-only", () => {
    expect(isReadOnlyKeyChord(["Escape"])).toBe(true);
    expect(isReadOnlyKeyChord(["Meta", "K"])).toBe(true);
    expect(isReadOnlyKeyChord(["Enter"])).toBe(false);
    expect(isReadOnlyKeyChord(["Meta", "S"])).toBe(false);
  });
});
