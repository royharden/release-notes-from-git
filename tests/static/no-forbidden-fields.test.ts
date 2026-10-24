import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { MODEL_BULLET_FIELDS, MODEL_OUTPUT_FIELDS } from '../../supabase/functions/_shared/core/output-schema.ts';
import { SANITIZED_COMMIT_FIELDS } from '../../src/core/gitlog/schema.ts';
import { WIRE_UNIT_FIELDS } from '../../supabase/functions/_shared/core/units-wire.ts';
import { readText } from '../helpers/fixtures.ts';

describe('model and retained-data field contracts', () => {
  it('allows only text/category/cites for model bullets and bullets at the top level', () => {
    expect([...MODEL_BULLET_FIELDS].sort()).toEqual(['category', 'cites', 'text']);
    expect(MODEL_OUTPUT_FIELDS).toEqual(['bullets']);
    const source = ts.createSourceFile('output-schema.ts', readText('supabase/functions/_shared/core/output-schema.ts'), ts.ScriptTarget.Latest, true);
    const model = source.statements.find((n): n is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(n) && n.name.text === 'ModelBullet');
    expect(model?.members.map((m) => m.name?.getText(source)).sort()).toEqual(['category', 'cites', 'text']);
  });
  it('wire and stored TypeScript shapes contain no author/committer/name/email property', () => {
    const paths = ['supabase/functions/_shared/core/units-wire.ts', 'supabase/functions/_shared/core/output-schema.ts',
      'src/core/gitlog/schema.ts', 'src/core/gitfacts/facts.ts', 'src/core/rulings/types.ts', 'scripts/export-git-log.ts'];
    for (const path of paths) {
      const source = ts.createSourceFile(path, readText(path), ts.ScriptTarget.Latest, true);
      const fields: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isPropertySignature(node) && node.name !== undefined) fields.push(node.name.getText(source).replace(/['"]/g, ''));
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(fields.filter((field) => /author|committer|(?:^|_)e?mail(?:$|_)|^name$/i.test(field)), path).toEqual([]);
    }
    expect([...WIRE_UNIT_FIELDS, ...SANITIZED_COMMIT_FIELDS].some((field) => /author|email|committer|^name$/i.test(field))).toBe(false);
  });
});
