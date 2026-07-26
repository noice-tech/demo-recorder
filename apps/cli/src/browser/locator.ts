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
  if (method.by === "role") {
    return page.getByRole(method.role as Parameters<Page["getByRole"]>[0], {
      ...(method.name === undefined ? {} : { name: method.name }),
      ...(method.exact === undefined ? {} : { exact: method.exact }),
    });
  }
  if (method.by === "text") return page.getByText(method.text, { exact: method.exact ?? false });
  if (method.by === "label") return page.getByLabel(method.label, { exact: method.exact ?? false });
  if (method.by === "placeholder")
    return page.getByPlaceholder(method.placeholder, { exact: method.exact ?? false });
  if (method.by === "test-id") return page.getByTestId(method.testId);
  return page.locator(method.selector);
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
