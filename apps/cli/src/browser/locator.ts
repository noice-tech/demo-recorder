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
  const failures: string[] = [];
  for (const method of methods) {
    const locator = locatorForMethod(page, method);
    try {
      await locator.first().waitFor({ state: "attached", timeout: timeoutMs });
      const count = await locator.count();
      if (count !== 1) {
        failures.push(`${method.by} matched ${count} elements; expected exactly one`);
        continue;
      }
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return { locator, method };
    } catch (error) {
      failures.push(`${method.by}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`${options.description} (${methods.map((method) => method.by).join(", ")})`, {
    cause: new Error(failures.join("\n")),
  });
}
