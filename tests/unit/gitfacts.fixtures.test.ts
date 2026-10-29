import { describe, expect, it } from 'vitest';
import { isUncoveredEligible } from '../../src/core/gitfacts/units.ts';
import { validateBullet } from '../../src/core/validate/validate.ts';
import { allowedShasForPrompt } from '../../supabase/functions/_shared/core/prompt.ts';
import { parseModelOutput } from '../../supabase/functions/_shared/core/output-schema.ts';
import { FIXTURE_IDS, fixtureText, parseOk, pipeline, pipelineFromLog, traps } from '../helpers/fixtures.ts';

describe('synthetic fixture contracts (source-authored, runtime pending)', () => {
  it.each(FIXTURE_IDS)('%s contains 60–120 authors-free synthetic commits', (id) => {
    const raw = JSON.parse(fixtureText(id)) as { commits: unknown[] };
    expect(raw.commits.length).toBeGreaterThanOrEqual(60);
    expect(raw.commits.length).toBeLessThanOrEqual(120);
    const p = pipeline(id);
    expect(p.log.commits.length + p.log.rejected.length).toBe(raw.commits.length);
    expect(JSON.stringify(raw)).not.toMatch(/"(?:author|committer|email|name)"\s*:/i);
  });

  for (const trap of traps().traps) {
    it(`${trap.id}: ${trap.description}`, () => {
      const p = trap.fixture === null ? pipelineFromLog(parseOk(JSON.stringify(trap.inline))) : pipeline(trap.fixture);
      for (const expected of trap.expect) {
        switch (expected.kind) {
          case 'unit': {
            const fields = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'kind'));
            expect(p.units.find((u) => u.unit_key === expected.unit_key)).toMatchObject(fields);
            break;
          }
          case 'commit': {
            const fact = p.facts.commits.get(expected.sha);
            expect(fact).toBeDefined();
            if (expected.revert_state !== undefined) expect(fact?.revertState).toBe(expected.revert_state);
            if (expected.issue_refs !== undefined) expect(fact?.issueRefs).toEqual(expected.issue_refs);
            break;
          }
          case 'reject':
            expect(p.log.rejected).toContainEqual(expect.objectContaining({ sha: expected.sha, code: expected.code }));
            break;
          case 'possible_duplicate':
            for (const key of expected.unit_keys) expect(p.possibleDuplicates.has(key)).toBe(true);
            break;
          case 'revert_issue':
            expect(p.facts.revertIssues).toContainEqual(expect.objectContaining({ sha: expected.sha, issue: expected.issue }));
            break;
          case 'uncovered': {
            const unit = p.units.find((u) => u.unit_key === expected.unit_key);
            if (unit === undefined) throw new Error('missing expected uncovered unit');
            expect(isUncoveredEligible(unit)).toBe(expected.eligible);
            break;
          }
          case 'units_count':
            expect(p.units).toHaveLength(expected.count);
            expect(p.chunkCount).toBe(expected.chunk_count);
            break;
          case 'verdict': {
            if (expected.stage === 'request') {
              // The named trap is planted in the request that does not contain its cited commit.
              const chunk = p.units.find((u) => !u.shas.some((sha) => expected.bullet.cites.includes(sha)))?.chunk_index;
              const opposite = p.units.filter((u) => u.chunk_index === chunk && !u.shas.some((sha) => expected.bullet.cites.includes(sha)));
              const output = parseModelOutput({ bullets: [expected.bullet] }, allowedShasForPrompt(opposite));
              if (!output.ok) throw new Error(output.detail);
              expect(output.bullets).toEqual([]);
              expect(output.outsideRequest[0]).toMatchObject({ reason: expected.reason, evidence: 'not in request input' });
              break;
            }
            const verdict = validateBullet(expected.bullet, p.ctx);
            expect({ kept: verdict.kept, reason: verdict.reason }).toEqual({ kept: expected.kept, reason: expected.reason });
            for (const warning of expected.warnings ?? []) expect(verdict.warnings).toContain(warning);
            if (expected.rejected_code !== undefined) expect(verdict.evidence.cites).toContainEqual(expect.objectContaining({ rejectedCode: expected.rejected_code }));
            if (expected.basis !== undefined) expect(verdict.evidence.cites).toContainEqual(expect.objectContaining({ basis: expected.basis }));
            break;
          }
        }
      }
    });
  }
});
