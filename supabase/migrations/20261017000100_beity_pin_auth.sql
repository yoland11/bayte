-- Centralized PIN brute-force limits for the server-only Vercel API.
-- This migration contains no PIN, credential, or financial data.
create table if not exists public.beity_pin_rate_limits (
  identifier_hash text primary key check (identifier_hash ~ '^[a-f0-9]{64}$'),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

-- New clients bind to the one canonical project id and must never create a
-- per-user workspace through the legacy bootstrap RPC.
revoke all on function public.ensure_bayti_workspace() from public, anon, authenticated;

alter table public.beity_pin_rate_limits enable row level security;
revoke all on table public.beity_pin_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.beity_pin_rate_limits to service_role;

create or replace function public.beity_check_pin_rate_limit(
  p_identifier_hash text,
  p_max_attempts integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_allowed boolean;
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$' or p_max_attempts < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate-limit arguments';
  end if;

  insert into public.beity_pin_rate_limits(identifier_hash)
  values (p_identifier_hash)
  on conflict (identifier_hash) do update set
    failed_attempts = case
      when public.beity_pin_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 0
      else public.beity_pin_rate_limits.failed_attempts
    end,
    window_started_at = case
      when public.beity_pin_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else public.beity_pin_rate_limits.window_started_at
    end,
    blocked_until = case
      when public.beity_pin_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then null
      else public.beity_pin_rate_limits.blocked_until
    end;

  select failed_attempts < p_max_attempts and (blocked_until is null or blocked_until <= now())
  into v_allowed
  from public.beity_pin_rate_limits
  where identifier_hash = p_identifier_hash;
  return coalesce(v_allowed, false);
end;
$$;

create or replace function public.beity_record_pin_failure(
  p_identifier_hash text,
  p_max_attempts integer,
  p_window_seconds integer
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$' or p_max_attempts < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate-limit arguments';
  end if;

  insert into public.beity_pin_rate_limits as limits(identifier_hash, failed_attempts, window_started_at, blocked_until)
  values (p_identifier_hash, 1, now(), null)
  on conflict (identifier_hash) do update set
    failed_attempts = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else limits.failed_attempts + 1
    end,
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else limits.window_started_at
    end,
    blocked_until = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then null
      when limits.failed_attempts + 1 >= p_max_attempts then now() + make_interval(secs => p_window_seconds)
      else limits.blocked_until
    end;
end;
$$;

create or replace function public.beity_reset_pin_rate_limit(p_identifier_hash text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  delete from public.beity_pin_rate_limits where identifier_hash = p_identifier_hash
$$;

revoke all on function public.beity_check_pin_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.beity_record_pin_failure(text, integer, integer) from public, anon, authenticated;
revoke all on function public.beity_reset_pin_rate_limit(text) from public, anon, authenticated;
grant execute on function public.beity_check_pin_rate_limit(text, integer, integer) to service_role;
grant execute on function public.beity_record_pin_failure(text, integer, integer) to service_role;
grant execute on function public.beity_reset_pin_rate_limit(text) to service_role;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['profiles', 'projects', 'transactions', 'clients', 'categories', 'construction_stages', 'attachments'] loop
      if to_regclass(format('public.%I', v_table)) is not null
        and not exists (
          select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
        ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
