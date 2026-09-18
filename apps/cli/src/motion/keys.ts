const modifierAliases = new Map<string, "Control" | "Alt" | "Shift" | "Meta">([
  ["control", "Control"],
  ["ctrl", "Control"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"],
  ["meta", "Meta"],
  ["command", "Meta"],
  ["cmd", "Meta"],
]);

const keyAliases = new Map<string, string>([
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["return", "Enter"],
  ["enter", "Enter"],
  ["spacebar", "Space"],
  ["space", "Space"],
  ["arrowup", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
]);

const modifierOrder = ["Control", "Alt", "Shift", "Meta"] as const;
const readOnlySingleKeys = new Set([
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export function normalizeKeyChord(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const source = value.trim();
  if (!source) throw new Error("Keyboard shortcut cannot be empty");
  const parts = source === "+" ? [source] : source.split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) throw new Error(`Malformed keyboard shortcut: ${value}`);

  const modifiers = new Set<(typeof modifierOrder)[number]>();
  let ordinaryKey: string | undefined;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "controlormeta") {
      modifiers.add(platform === "darwin" ? "Meta" : "Control");
      continue;
    }
    const modifier = modifierAliases.get(lower);
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (ordinaryKey) throw new Error(`Keyboard shortcut has more than one ordinary key: ${value}`);
    ordinaryKey = keyAliases.get(lower) ?? (part.length === 1 ? part.toUpperCase() : part);
  }

  return [
    ...modifierOrder.filter((modifier) => modifiers.has(modifier)),
    ...(ordinaryKey ? [ordinaryKey] : []),
  ];
}

export function isReadOnlyKeyChord(keys: readonly string[]): boolean {
  if (keys.length === 1) return readOnlySingleKeys.has(keys[0] ?? "");
  const ordinaryKey = keys.at(-1);
  const modifiers = keys.slice(0, -1);
  return (
    ordinaryKey === "K" &&
    modifiers.length === 1 &&
    (modifiers[0] === "Meta" || modifiers[0] === "Control")
  );
}
