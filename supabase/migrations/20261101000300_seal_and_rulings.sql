create function public.guard_run_write() returns trigger language plpgsql set search_path = public,pg_temp as $$
begin
  -- SECURITY DEFINER RPCs execute as the migration owner; client JWT roles do not.
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      new.owner := auth.uid(); new.status := 'draft'; new.unit_count := 0; new.chunk_count := 0;
      new.revision_sha256 := null; new.reserved_usd := 0; new.spent_usd := 0; new.omissions_ack_at := null;
    elsif old.status <> 'draft' or (to_jsonb(new) - 'omissions_ack_at') is distinct from (to_jsonb(old) - 'omissions_ack_at') then
      raise exception 'protected_run_columns';
    end if;
  end if;
  return new;
end $$;
create trigger runs_guard before insert or update on public.runs for each row execute function public.guard_run_write();

create function public.guard_unit_write() returns trigger language plpgsql set search_path = public,pg_temp as $$
declare parent_status text;
begin
  -- Lock the parent even for inserts: concurrent seal cannot miss a newly inserted unit.
  select status into parent_status from public.runs where id = coalesce(new.run_id,old.run_id) for update;
  if tg_op <> 'INSERT' or parent_status is distinct from 'draft' then raise exception 'immutable_units'; end if;
  return new;
end $$;
create trigger units_immutable before insert or update or delete on public.run_units for each row execute function public.guard_unit_write();
create function public.reject_mutation() returns trigger language plpgsql set search_path = public,pg_temp as $$
begin raise exception 'append_only'; end $$;
create trigger rulings_immutable before update or delete on public.rulings for each row execute function public.reject_mutation();
create trigger bullets_immutable before update or delete on public.bullets for each row execute function public.reject_mutation();
create function public.bind_ruling_actor() returns trigger language plpgsql set search_path = public,pg_temp as $$
begin new.actor := auth.uid(); new.owner := auth.uid(); return new; end $$;
create trigger rulings_actor before insert on public.rulings for each row execute function public.bind_ruling_actor();

create function public.seal_run(p_run_id uuid) returns public.runs
language plpgsql security definer set search_path = public,extensions,pg_temp as $$
declare r public.runs; u record; total integer := 0; last_chunk integer := 0; chunks integer := 0; digest_input text;
begin
  select * into r from public.runs where id = p_run_id and owner = auth.uid() for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'draft' then raise exception 'already_sealed'; end if;
  if (coalesce((r.parse_report->>'rejected')::integer,0) > 0 or r.has_unit_omissions) and r.omissions_ack_at is null then raise exception 'omissions_unacknowledged'; end if;
  if (r.repo_label || r.from_ref || r.to_ref || r.parse_report::text) ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then raise exception 'redaction_backstop'; end if;
  for u in select * from public.run_units where run_id = p_run_id order by ordinal loop
    if u.ordinal <> total or u.chunk_index < last_chunk or u.chunk_index > last_chunk + case when total = 0 then 0 else 1 end then raise exception 'invalid_chunk_sequence'; end if;
    if cardinality(u.shas) = 0 or exists (select 1 from unnest(u.shas) s where s !~ '^([0-9a-f]{40}|[0-9a-f]{64})$') then raise exception 'invalid_shas'; end if;
    if to_jsonb(u)::text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then raise exception 'redaction_backstop'; end if;
    total := total + 1; last_chunk := u.chunk_index;
  end loop;
  if total > 400 then raise exception 'unit_limit'; end if;
  select count(distinct chunk_index) into chunks from public.run_units where run_id = p_run_id;
  if chunks > 10 or exists (
    select 1 from public.run_units where run_id = p_run_id group by chunk_index
    having count(*) > 40 or sum(char_length(array_to_string(subjects,E'\n') || E'\n' || left(body,1500) || E'\n' || array_to_string(paths,E'\n'))) > 60000
  ) then raise exception 'chunk_limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) - 'owner' - 'run_id' order by x.ordinal),'[]'::jsonb)::text into digest_input from public.run_units x where run_id = p_run_id;
  update public.runs set status = 'sealed', unit_count = total, chunk_count = chunks,
    revision_sha256 = encode(digest(digest_input,'sha256'),'hex') where id = p_run_id returning * into r;
  return r;
end $$;
revoke execute on function public.seal_run(uuid) from public,anon;
grant execute on function public.seal_run(uuid) to authenticated;

