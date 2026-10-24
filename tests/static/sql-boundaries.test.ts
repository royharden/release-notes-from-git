import { describe, expect, it } from 'vitest';
import { readText } from '../helpers/fixtures.ts';
const file = (suffix: string) => readText(`supabase/migrations/${suffix}.sql`).toLowerCase();
const core = file('20261101000100_core_tables');
const rls = file('20261101000200_rls_and_grants');
const seal = file('20261101000300_seal_and_rulings');
const ledger = file('20261101000400_budget_and_ledger');
describe('SQL security boundaries (source checks; not executed database proofs)', () => {
  it('RLS is enabled for all tables with owner predicates and composite ownership FKs', () => {
    const all = [core,rls,seal,ledger].join('\n');
    for (const table of ['runs','run_units','bullets','rulings','llm_requests','llm_calls','live_allowances']) expect(all).toContain(`alter table public.${table} enable row level security`);
    expect(core.match(/foreign key \(run_id,owner\) references public\.runs\(id,owner\)/g)).toHaveLength(3);
    expect(ledger).toContain('foreign key (request_key,run_id,owner)');
    expect(rls).toContain("r.status = 'draft'"); expect(rls).toContain('owner = auth.uid()');
  });
  it('client grants cannot alter protected run columns, units, rulings, snapshots or spend rows', () => {
    expect(rls.match(/grant update[^;]+to authenticated/g)).toEqual(['grant update (omissions_ack_at) on public.runs to authenticated']);
    expect([rls,ledger].join('\n')).not.toMatch(/grant (?:insert|update|delete)[^;]*on public\.(?:llm_calls|llm_requests|live_allowances)[^;]*to authenticated/);
    expect(rls).not.toMatch(/create policy[^;]+for (?:update|delete)[^;]+on public\.rulings/);
    expect(seal).toContain('rulings_immutable before update or delete'); expect(seal).toContain('new.actor := auth.uid()');
    expect(seal).toContain('for update'); expect(seal).toContain("parent_status is distinct from 'draft'");
    expect(core).toContain('budget_usd <= 5.00');
  });
  it('seal independently recomputes counts/chunk caps, acknowledgement, hash and redaction backstop', () => {
    for (const text of ['owner = auth.uid()','total > 400','chunks > 10','count(*) > 40','left(body,1500)','char_length(','> 60000','omissions_unacknowledged','redaction_backstop',"digest(digest_input,'sha256')"]) expect(seal).toContain(text);
    expect(seal).toContain('set search_path = public,extensions,pg_temp');
  });
  it('both RPCs are definer functions with fixed search_path and service-role-only execute', () => {
    for (const rpc of ['reserve_llm_attempt','settle_llm_attempt']) {
      expect(ledger).toMatch(new RegExp(`create function public\\.${rpc}[\\s\\S]*?security definer set search_path = public,pg_temp`));
      expect(ledger).toMatch(new RegExp(`revoke execute on function public\\.${rpc}[^;]+from public,anon,authenticated`));
      expect(ledger).toMatch(new RegExp(`grant execute on function public\\.${rpc}[^;]+to service_role`));
    }
  });
  it('locks run and allowance; both accounting rows settle once; unknown usage uses full bound', () => {
    expect(ledger).toContain('owner = p_owner for update'); expect(ledger).toContain('id = p_run_id and owner = p_owner for update');
    expect(ledger).toContain("'live_not_allowed'"); expect(ledger).toContain('a.spent_usd + a.reserved_usd + p_bound_usd > a.cap_usd');
    expect(ledger).toContain('r.spent_usd + r.reserved_usd + p_bound_usd > r.budget_usd');
    expect(ledger).toContain("if c.status = 'settled' then return to_jsonb(c)");
    expect(ledger.match(/reserved_usd = reserved_usd - c.reserved_usd,spent_usd = spent_usd \+ charged/g)).toHaveLength(2);
    expect(ledger).toContain('then c.reserved_usd else p_cost_usd end');
    expect(ledger).toContain('n > 2'); expect(ledger).toContain('>= 2 * r.chunk_count');
    expect(ledger).toContain("q.status = 'failed_unknown'");
  });
});
