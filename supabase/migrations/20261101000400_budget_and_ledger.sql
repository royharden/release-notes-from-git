create table public.live_allowances (
  owner uuid primary key references auth.users(id), cap_usd numeric not null check (cap_usd >= 0 and cap_usd::text not in ('NaN','Infinity','-Infinity')),
  reserved_usd numeric not null default 0 check (reserved_usd >= 0), spent_usd numeric not null default 0 check (spent_usd >= 0)
);
create table public.llm_requests (
  request_key text primary key, run_id uuid not null, owner uuid not null, chunk_index integer not null,
  prompt_hash text not null, model_id text not null, provider text not null,
  status text not null check (status in ('in_flight','completed','failed_unknown','failed')),
  output jsonb, error_code text, created_at timestamptz not null default now(),
  foreign key (run_id,owner) references public.runs(id,owner), unique (request_key,run_id,owner)
);
create table public.llm_calls (
  id uuid primary key default gen_random_uuid(), request_key text not null, run_id uuid not null, owner uuid not null,
  attempt_no integer not null check (attempt_no between 1 and 2), chunk_index integer not null,
  provider text not null, model_id text not null, prompt_hash text not null,
  input_tokens bigint, output_tokens bigint, price_as_of date not null,
  reserved_usd numeric not null check (reserved_usd > 0), cost_usd numeric,
  latency_ms integer, status text not null default 'reserved' check (status in ('reserved','settled')), error_code text,
  created_at timestamptz not null default now(), unique (request_key,attempt_no),
  foreign key (request_key,run_id,owner) references public.llm_requests(request_key,run_id,owner),
  foreign key (run_id,owner) references public.runs(id,owner)
);
alter table public.live_allowances enable row level security;
alter table public.llm_requests enable row level security;
alter table public.llm_calls enable row level security;
revoke all on public.live_allowances,public.llm_requests,public.llm_calls from public,anon,authenticated;
grant select on public.live_allowances,public.llm_requests,public.llm_calls to authenticated;
grant all on public.live_allowances,public.llm_requests,public.llm_calls to service_role;
create policy allowance_read on public.live_allowances for select to authenticated using (owner = auth.uid());
create policy requests_read on public.llm_requests for select to authenticated using (owner = auth.uid());
create policy calls_read on public.llm_calls for select to authenticated using (owner = auth.uid());

create function public.reserve_llm_attempt(p_run_id uuid,p_owner uuid,p_request_key text,p_chunk_index integer,p_provider text,p_model_id text,p_prompt_hash text,p_price_as_of date,p_bound_usd numeric)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare r public.runs; a public.live_allowances; q public.llm_requests; n integer; call_id uuid;
begin
  select * into r from public.runs where id = p_run_id and owner = p_owner for update;
  if not found then return jsonb_build_object('error','run_not_found'); end if;
  if r.status <> 'sealed' or p_chunk_index < 0 or p_chunk_index >= r.chunk_count then return jsonb_build_object('error','invalid_run'); end if;
  select * into a from public.live_allowances where owner = p_owner for update;
  if not found then return jsonb_build_object('error','live_not_allowed'); end if;
  select * into q from public.llm_requests where request_key = p_request_key for update;
  if found then
    if q.run_id <> p_run_id or q.owner <> p_owner or q.chunk_index <> p_chunk_index or q.model_id <> p_model_id or q.prompt_hash <> p_prompt_hash or q.provider <> p_provider then return jsonb_build_object('error','identity_conflict'); end if;
    if q.status = 'completed' then return jsonb_build_object('status','completed','output',q.output); end if;
    if q.status = 'in_flight' then return jsonb_build_object('error','pending'); end if;
    -- Unknown paid outcomes are never automatically retried.
    if q.status = 'failed_unknown' then return jsonb_build_object('error','failed_unknown'); end if;
  end if;
  select count(*) + 1 into n from public.llm_calls where request_key = p_request_key;
  if n > 2 or (select count(*) from public.llm_calls where run_id = p_run_id) >= 2 * r.chunk_count then return jsonb_build_object('error','attempt_limit'); end if;
  if p_bound_usd is null or p_bound_usd <= 0 or p_bound_usd::text in ('NaN','Infinity','-Infinity') then return jsonb_build_object('error','invalid_bound'); end if;
  if r.spent_usd + r.reserved_usd + p_bound_usd > r.budget_usd or a.spent_usd + a.reserved_usd + p_bound_usd > a.cap_usd then return jsonb_build_object('error','budget_exceeded'); end if;
  insert into public.llm_requests(request_key,run_id,owner,chunk_index,prompt_hash,model_id,provider,status)
    values(p_request_key,p_run_id,p_owner,p_chunk_index,p_prompt_hash,p_model_id,p_provider,'in_flight')
    on conflict (request_key) do update set status = 'in_flight',error_code = null;
  insert into public.llm_calls(request_key,run_id,owner,attempt_no,chunk_index,provider,model_id,prompt_hash,price_as_of,reserved_usd)
    values(p_request_key,p_run_id,p_owner,n,p_chunk_index,p_provider,p_model_id,p_prompt_hash,p_price_as_of,p_bound_usd) returning id into call_id;
  update public.runs set reserved_usd = reserved_usd + p_bound_usd where id = p_run_id;
  update public.live_allowances set reserved_usd = reserved_usd + p_bound_usd where owner = p_owner;
  return jsonb_build_object('status','reserved','attempt_id',call_id,'attempt_no',n);
end $$;

create function public.settle_llm_attempt(p_attempt_id uuid,p_input_tokens bigint,p_output_tokens bigint,p_cost_usd numeric,p_latency_ms integer,p_status text,p_error_code text,p_output jsonb)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare c public.llm_calls; identity_row public.llm_calls; charged numeric;
begin
  select * into identity_row from public.llm_calls where id = p_attempt_id;
  if not found then raise exception 'attempt_not_found'; end if;
  -- Same lock order as reserve: run, allowance, request, attempt. Avoid reserve/settle deadlocks.
  perform 1 from public.runs where id = identity_row.run_id for update;
  perform 1 from public.live_allowances where owner = identity_row.owner for update;
  perform 1 from public.llm_requests where request_key = identity_row.request_key for update;
  select * into c from public.llm_calls where id = p_attempt_id for update;
  if c.status = 'settled' then return to_jsonb(c); end if;
  if p_status not in ('completed','failed','failed_unknown') then raise exception 'invalid_settlement'; end if;
  -- A missing/invalid usage or cost is charged at the full reserved bound, never an undercount.
  charged := case when p_input_tokens is null or p_output_tokens is null or p_input_tokens < 0 or p_output_tokens < 0 or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd::text in ('NaN','Infinity','-Infinity') then c.reserved_usd else p_cost_usd end;
  update public.llm_calls set status = 'settled',input_tokens = p_input_tokens,output_tokens = p_output_tokens,
    cost_usd = charged,latency_ms = greatest(0,p_latency_ms),error_code = p_error_code where id = p_attempt_id returning * into c;
  update public.runs set reserved_usd = reserved_usd - c.reserved_usd,spent_usd = spent_usd + charged where id = c.run_id;
  update public.live_allowances set reserved_usd = reserved_usd - c.reserved_usd,spent_usd = spent_usd + charged where owner = c.owner;
  update public.llm_requests set status = p_status,output = p_output,error_code = p_error_code where request_key = c.request_key;
  return to_jsonb(c);
end $$;
revoke execute on function public.reserve_llm_attempt(uuid,uuid,text,integer,text,text,text,date,numeric) from public,anon,authenticated;
revoke execute on function public.settle_llm_attempt(uuid,bigint,bigint,numeric,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_llm_attempt(uuid,uuid,text,integer,text,text,text,date,numeric) to service_role;
grant execute on function public.settle_llm_attempt(uuid,bigint,bigint,numeric,integer,text,text,jsonb) to service_role;
