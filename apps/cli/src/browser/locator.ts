import type { Locator, Page } from "playwright";
import { z } from "zod";

const nonempty = z.string().trim().min(1);

export const locatorMethodSchema = z.discriminatedUnion("by", [
  z.object({
    by: z.literal("role"),
    role: nonempty,
    name: nonempty.optional(),
    exact: z.boolean().optional(),
  }),
  z.object({ by: z.literal("text"), text: nonempty, exact: z.boolean().optional() }),
  z.object({ by: z.literal("label"), label: nonempty, exact: z.boolean().optional() }),
  z.object({ by: z.literal("placeholder"), placeholder: nonempty, exact: z.boolean().optional() }),
  z.object({ by: z.literal("test-id"), testId: nonempty }),
  z.object({ by: z.literal("css"), selector: nonempty }),
]);

export type LocatorMethod = z.infer<typeof locatorMethodSchema>;

export function locatorForMethod(page: Page, method: LocatorMethod): Locator {
  switch (method.by) {
    case "role":
      return page.getByRole(method.role as Parameters<Page["getByRole"]>[0], {
        ...(method.name === undefined ? {} : { name: method.name }),
        ...(method.exact === undefined ? {} : { exact: method.exact }),
      });
    case "text":
      return page.getByText(method.text, { exact: method.exact ?? false });
    case "label":
      return page.getByLabel(method.label, { exact: method.exact ?? false });
    case "placeholder":
      return page.getByPlaceholder(method.placeholder, { exact: method.exact ?? false });
    case "test-id":
      return page.getByTestId(method.testId);
    case "css":
      return page.locator(method.selector);
  }
}

function cssAttributeValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\a ")}"`;
}

/** Prefer the visible label a user actually clicks for checkbox and radio controls. */
export async function resolveVisibleClickTarget(page: Page, locator: Locator): Promise<Locator> {
  const control = await locator
    .evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) return undefined;
      if (element.type !== "checkbox" && element.type !== "radio") return undefined;
      const label = element.labels?.[0];
      if (!label) return undefined;
      return { id: element.id, wrapsControl: label.contains(element) };
    })
    .catch(() => undefined);
  if (!control) return locator;

  const label = control.wrapsControl
    ? locator.locator("xpath=ancestor::label[1]")
    : control.id
      ? page.locator(`label[for=${cssAttributeValue(control.id)}]`)
      : undefined;
  if (!label || (await label.count()) !== 1 || !(await label.isVisible())) return locator;
  return label;
}

export async function resolveUniqueLocator(
  page: Page,
  methods: LocatorMethod[],
  options: { timeoutMs?: number; description: string },
): Promise<{ locator: Locator; method: LocatorMethod }> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  const candidates = methods.map((method) => ({ method, locator: locatorForMethod(page, method) }));
  let failures: string[] = [];
  do {
    failures = [];
    let allAmbiguous = true;
    for (const { method, locator } of candidates) {
      const count = await locator.count();
      allAmbiguous &&= count > 1;
      if (count === 1 && (await locator.isVisible())) return { locator, method };
      failures.push(
        `${method.by} matched ${count} elements${count === 1 ? "; target is not visible" : "; expected exactly one"}`,
      );
    }
    const remaining = deadline - Date.now();
    if (allAmbiguous || remaining <= 0) break;
    await page.waitForTimeout(Math.min(50, remaining));
  } while (Date.now() <= deadline);
  throw new Error(`${options.description} (no unique visible target within ${timeoutMs}ms)`, {
    cause: new Error(failures.join("\n")),
  });
}
