create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.runs (
  id uuid primary key default gen_random_uuid(), owner uuid not null default auth.uid() references auth.users(id),
  repo_label text not null, from_ref text not null, to_ref text not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'), parse_report jsonb not null,
  has_unit_omissions boolean not null default false, config_version text not null,
  omissions_ack_at timestamptz, status text not null default 'draft' check (status in ('draft','sealed')),
  unit_count integer not null default 0, chunk_count integer not null default 0,
  revision_sha256 text, budget_usd numeric not null default 0.50 check (budget_usd > 0 and budget_usd <= 5.00),
  reserved_usd numeric not null default 0 check (reserved_usd >= 0), spent_usd numeric not null default 0 check (spent_usd >= 0),
  created_at timestamptz not null default now(), unique (id,owner)
);
create table public.run_units (
  run_id uuid not null, owner uuid not null default auth.uid(), ordinal integer not null check (ordinal >= 0),
  chunk_index integer not null check (chunk_index >= 0), unit_key text not null, shas text[] not null,
  pr_number integer, type text not null, scope text, breaking boolean not null,
  subjects text[] not null, body text not null, paths text[] not null, noise_reason text,
  revert_state text not null check (revert_state in ('active','cancelled','target_outside_range','target_ambiguous')),
  primary key (run_id,ordinal), unique (run_id,unit_key),
  foreign key (run_id,owner) references public.runs(id,owner)
);
-- A generation snapshot is an owner cache, never a server validation attestation.
-- Preserve the entire initial review and request lineage, including empty generations.
create table public.bullets (
  run_id uuid primary key, owner uuid not null default auth.uid(),
  initial_review jsonb not null, request_drops jsonb not null, violations jsonb not null,
  created_at timestamptz not null default now(), foreign key (run_id,owner) references public.runs(id,owner)
);
create table public.rulings (
  client_event_id uuid primary key, run_id uuid not null, owner uuid not null default auth.uid(),
  action text not null check (action in ('restore','edit','remove','add','approve')),
  target_key text not null, payload jsonb not null, fingerprint text not null, config_version text not null,
  approval_hash text, reason text, actor uuid not null default auth.uid(), created_at timestamptz not null,
  foreign key (run_id,owner) references public.runs(id,owner)
);

