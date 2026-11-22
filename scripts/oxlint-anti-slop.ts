// Adapted from the anti-slop Oxlint plugin by Dillon Mulroy, MIT License (see THIRD_PARTY_NOTICES.md).
import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isTypeAssertion(node: ESTree.Node): node is TypeAssertion {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function unwrapParentheses(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isOutermostAssertion(node: TypeAssertion): boolean {
  let current: ESTree.Expression = node;
  let parent = node.parent;
  while (parent.type === "ParenthesizedExpression" && parent.expression === current) {
    current = parent;
    parent = parent.parent;
  }
  return !isTypeAssertion(parent) || parent.expression !== current;
}

function isForbiddenChain(node: TypeAssertion): boolean {
  let count = 0;
  let hasNonConst = false;
  let current: ESTree.Expression = node;
  while (isTypeAssertion(current)) {
    count += 1;
    hasNonConst ||= !isConstAssertion(current);
    current = unwrapParentheses(current.expression);
  }
  const satisfiesBroadType =
    current.type === "TSSatisfiesExpression" &&
    (current.typeAnnotation.type === "TSUnknownKeyword" ||
      current.typeAnnotation.type === "TSAnyKeyword");
  return (count > 1 && hasNonConst) || (count > 0 && satisfiesBroadType);
}

const noChainedTypeAssertions = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow chained type assertions such as `x as unknown as T`." },
    messages: {
      chained:
        "This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.",
    },
  },
  createOnce(context) {
    const check = (node: TypeAssertion) => {
      if (isOutermostAssertion(node) && isForbiddenChain(node)) {
        context.report({ node, messageId: "chained" });
      }
    };
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
});

const safetyCommentOwners = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
]);

const isExport = (node: ESTree.Node) =>
  node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration";

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
  let current: ESTree.Node = node;
  while (true) {
    const found = sourceCode
      .getCommentsBefore(current)
      .some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value));
    if (found) {
      return true;
    }
    if (
      (safetyCommentOwners.has(current.type) && !isExport(current.parent)) ||
      current.parent.type === "Program"
    ) {
      return false;
    }
    current = current.parent;
  }
}

const requireSafetyCommentForTypeAssertion = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require a `SAFETY:` comment before every narrowing type assertion." },
    messages: {
      missing:
        "This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
  },
  createOnce(context) {
    const check = (node: TypeAssertion) => {
      // Widening to unknown cannot be wrong, so `JSON.parse(text) as unknown` needs no justification.
      if (isConstAssertion(node) || node.typeAnnotation.type === "TSUnknownKeyword") {
        return;
      }
      if (!hasSafetyComment(context.sourceCode, node)) {
        context.report({ node, messageId: "missing" });
      }
    };
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
});

const moduleMockMethods = new Set(["doMock", "mock", "setMock", "unstable_mockModule"]);
const frameworkExports = new Map([
  ["vitest", "vi"],
  ["@jest/globals", "jest"],
]);

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return null;
}

/** What an identifier was imported as, `*` for a namespace; undefined when it has no binding at all. */
function importOf(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): { source: string; name: string } | null | undefined {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) {
    return undefined;
  }
  for (const definition of variable.defs) {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      continue;
    }
    const source = definition.parent.source.value;
    const specifier = definition.node;
    if (specifier.type === "ImportNamespaceSpecifier") {
      return { source, name: "*" };
    }
    if (specifier.type === "ImportSpecifier") {
      const { imported } = specifier;
      return { source, name: imported.type === "Identifier" ? imported.name : imported.value };
    }
  }
  return null;
}

function memberName(member: ESTree.MemberExpression): string | null {
  const { property } = member;
  if (!member.computed) {
    return property.type === "Identifier" ? property.name : null;
  }
  return property.type === "Literal" && typeof property.value === "string" ? property.value : null;
}

/** `vi` or `jest`, as a global, a named import, or a member of a namespace import. */
function isTestFramework(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type === "Identifier") {
    const imported = importOf(sourceCode, expression);
    if (imported === undefined) {
      return expression.name === "vi" || expression.name === "jest";
    }
    return imported !== null && frameworkExports.get(imported.source) === imported.name;
  }
  if (expression.type !== "MemberExpression" || expression.object.type !== "Identifier") {
    return false;
  }
  const imported = importOf(sourceCode, expression.object);
  return imported?.name === "*" && frameworkExports.get(imported.source) === memberName(expression);
}

const noModuleMocking = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow Vitest and Jest module mocking." },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          !isTestFramework(context.sourceCode, callee.object)
        ) {
          return;
        }
        const method = memberName(callee);
        if (method !== null && moduleMockMethods.has(method)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});

export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertions,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertion,
    "no-module-mocking": noModuleMocking,
  },
});
