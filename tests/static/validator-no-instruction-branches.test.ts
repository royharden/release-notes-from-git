import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readText } from '../helpers/fixtures.ts';

describe('validator has no instruction-text branch', () => {
  it('decision expressions never recognize instruction phrases from commit text', () => {
    const paths = ['src/core/validate/validate.ts', 'src/core/validate/evidence.ts'];
    for (const path of paths) {
      const source = ts.createSourceFile(path, readText(path), ts.ScriptTarget.Latest, true);
      const decisions: ts.Node[] = [];
      const collect = (node: ts.Node): void => {
        if (ts.isIfStatement(node) || ts.isWhileStatement(node)) decisions.push(node.expression);
        if (ts.isConditionalExpression(node)) decisions.push(node.condition);
        if (ts.isCaseClause(node)) decisions.push(node.expression);
        ts.forEachChild(node, collect);
      };
      collect(source);
      const forbidden = /ignore|instructions?|system.?prompt|every.?bug|do.?not.?follow|assistant|jailbreak/i;
      for (const decision of decisions) {
        const inspect = (node: ts.Node): void => {
          if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node)) expect(node.getText(source), path).not.toMatch(forbidden);
          ts.forEachChild(node, inspect);
        };
        inspect(decision);
      }
    }
  });
});
