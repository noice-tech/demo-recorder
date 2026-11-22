// Adapted from the anti-slop Oxlint plugin, MIT License, Copyright (c) 2026 Dillon Mulroy.
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
]);

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
  let current: ESTree.Node = node;
  while (true) {
    const found = sourceCode
      .getCommentsBefore(current)
      .some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value));
    if (found) {
      return true;
    }
    if (safetyCommentOwners.has(current.type) || current.parent.type === "Program") {
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

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

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

function isTestFramework(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") {
    return false;
  }
  const isFrameworkName = expression.name === "vi" || expression.name === "jest";
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return isFrameworkName;
  }
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    const source = definition.parent.source.value;
    const specifier = definition.node;
    if (specifier.type !== "ImportSpecifier") {
      return false;
    }
    const name =
      specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
    return (
      (source === "vitest" && name === "vi") || (source === "@jest/globals" && name === "jest")
    );
  });
}

function mockedMethod(callee: ESTree.MemberExpression): string | null {
  const { property } = callee;
  if (!callee.computed) {
    return property.type === "Identifier" ? property.name : null;
  }
  return property.type === "Literal" && typeof property.value === "string" ? property.value : null;
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
        const method = mockedMethod(callee);
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
