-- PREPARED FOR REVIEW. Apply to an isolated local database first.
-- No existing account, PIN, financial row or attachment is changed by this migration.
begin;

-- Supabase logout removes auth.sessions. JWT signature/expiry alone is insufficient.
create or replace function public.beity_session_active() returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from auth.sessions s
    where s.id = nullif(auth.jwt()->>'session_id','')::uuid and s.user_id = auth.uid())
$$;
revoke all on function public.beity_session_active() from public, anon;
grant execute on function public.beity_session_active() to authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','projects','transactions','clients','categories','construction_stages','attachments'] loop
    execute format('create policy beity_live_session on public.%I as restrictive for all to authenticated using ((select public.beity_session_active())) with check ((select public.beity_session_active()))', t);
  end loop;
end $$;
create policy beity_live_storage_session on storage.objects as restrictive for all to authenticated
using (bucket_id not in ('transaction-attachments','project-assets') or (select public.beity_session_active()))
with check (bucket_id not in ('transaction-attachments','project-assets') or (select public.beity_session_active()));

-- Reservations count all admitted attempts BEFORE Argon2 runs, including concurrent requests.
create table public.beity_pin_attempt_windows (
  identifier_hash text not null check (identifier_hash ~ '^[a-f0-9]{64}$'),
  window_seconds integer not null,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count >= 0),
  primary key (identifier_hash, window_seconds)
);
alter table public.beity_pin_attempt_windows enable row level security;
revoke all on public.beity_pin_attempt_windows from public, anon, authenticated;
create function public.beity_reserve_pin_attempt(p_identifier_hash text, p_network_hash text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare i integer; n integer; keys text[]; windows integer[] := array[900,86400,900,60]; limits integer[] := array[5,20,50,120];
begin
  if p_identifier_hash is null or p_network_hash is null or p_identifier_hash !~ '^[a-f0-9]{64}$' or p_network_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid rate-limit identifier'; end if;
  -- One short DB critical section makes multi-window reservations atomic across API workers.
  perform pg_advisory_xact_lock(hashtextextended('beity-pin-reservation',0));
  keys := array[p_identifier_hash,p_identifier_hash,p_network_hash,repeat('0',64)];
  for i in 1..4 loop
    insert into public.beity_pin_attempt_windows as w values(keys[i],windows[i],clock_timestamp(),1)
    on conflict(identifier_hash,window_seconds) do update set
      attempt_count = case when w.window_started_at <= clock_timestamp()-make_interval(secs=>windows[i]) then 1 else least(w.attempt_count+1,1000000) end,
      window_started_at = case when w.window_started_at <= clock_timestamp()-make_interval(secs=>windows[i]) then clock_timestamp() else w.window_started_at end
    returning attempt_count into n;
    if n > limits[i] then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.beity_reserve_pin_attempt(text,text) from public,anon,authenticated;
grant execute on function public.beity_reserve_pin_attempt(text,text) to service_role;

-- Durable idempotency receipts are committed in the SAME transaction as money and metadata.
create table public.transaction_save_operations (
  operation_id uuid primary key,
  user_id uuid not null references auth.users(id),
  transaction_id uuid not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.transaction_save_operations enable row level security;
create policy beity_save_operation_owner on public.transaction_save_operations for all to authenticated
using (user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy beity_save_operation_session on public.transaction_save_operations as restrictive for all to authenticated
using ((select public.beity_session_active())) with check ((select public.beity_session_active()));
grant select,insert,update on public.transaction_save_operations to authenticated;
revoke all on public.transaction_save_operations from public,anon;

create function public.beity_transaction_save_status(p_operation_id uuid,p_transaction jsonb default null,p_attachment jsonb default null,p_remove_attachment boolean default false) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog,public as $$
declare receipt public.transaction_save_operations%rowtype; fingerprint text;
begin
  select * into receipt from public.transaction_save_operations where operation_id=p_operation_id and user_id=auth.uid();
  if not found then return null; end if;
  if p_transaction is not null then
    fingerprint := encode(sha256(convert_to(jsonb_build_object('transaction',p_transaction,'attachment',p_attachment,'remove',p_remove_attachment)::text,'UTF8')),'hex');
    if receipt.request_hash<>fingerprint then raise exception 'idempotency key conflict' using errcode='22023'; end if;
  end if;
  return receipt.result;
end $$;
revoke all on function public.beity_transaction_save_status(uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.beity_transaction_save_status(uuid,jsonb,jsonb,boolean) to authenticated;

create function public.beity_save_transaction(p_operation_id uuid,p_transaction jsonb,p_attachment jsonb default null,p_remove_attachment boolean default false) returns jsonb
language plpgsql security invoker set search_path = pg_catalog,public as $$
declare
  u uuid := auth.uid(); tid uuid := (p_transaction->>'id')::uuid; pid uuid := (p_transaction->>'project_id')::uuid;
  fingerprint text := encode(sha256(convert_to(jsonb_build_object('transaction',p_transaction,'attachment',p_attachment,'remove',p_remove_attachment)::text,'UTF8')),'hex');
  previous public.attachments%rowtype; receipt public.transaction_save_operations%rowtype; v_result jsonb; path text; has_file boolean := p_attachment is not null and jsonb_typeof(p_attachment)<>'null';
begin
  if not public.beity_session_active() or u is null or p_operation_id is null or tid is null or pid is null or (p_transaction->>'user_id')::uuid is distinct from u then raise exception 'unauthorized save' using errcode='42501'; end if;
  if not exists(select 1 from public.projects where id=pid and user_id=u) then raise exception 'workspace unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(tid::text,0));
  insert into public.transaction_save_operations(operation_id,user_id,transaction_id,request_hash)
    values(p_operation_id,u,tid,fingerprint) on conflict(operation_id) do nothing;
  select * into receipt from public.transaction_save_operations where operation_id=p_operation_id for update;
  if not found or receipt.user_id<>u or receipt.request_hash<>fingerprint then raise exception 'idempotency key conflict' using errcode='22023'; end if;
  if receipt.result is not null then return receipt.result; end if;
  select * into previous from public.attachments where transaction_id=tid and project_id=pid;
  if has_file then
    path := p_attachment->>'file_path';
    if path is null or path not like u::text||'/'||pid::text||'/'||tid::text||'/'||p_operation_id::text||'-%'
      or (p_attachment->>'file_size')::bigint not between 1 and 10485760
      or (p_attachment->>'file_type') not in ('image/jpeg','image/png','image/webp','application/pdf')
      or not exists(select 1 from storage.objects where bucket_id='transaction-attachments' and name=path
        and (metadata->>'size')::bigint=(p_attachment->>'file_size')::bigint
        and metadata->>'mimetype'=p_attachment->>'file_type') then raise exception 'invalid staged attachment' using errcode='22023'; end if;
  end if;
  insert into public.transactions as t(id,user_id,project_id,type,amount,transaction_date,description,category_id,stage_id,client_id,person_name,notes,created_at,updated_at)
  values(tid,u,pid,p_transaction->>'type',(p_transaction->>'amount')::numeric,(p_transaction->>'transaction_date')::date,p_transaction->>'description',nullif(p_transaction->>'category_id','')::uuid,nullif(p_transaction->>'stage_id','')::uuid,nullif(p_transaction->>'client_id','')::uuid,p_transaction->>'person_name',p_transaction->>'notes',(p_transaction->>'created_at')::timestamptz,now())
  on conflict(id) do update set type=excluded.type,amount=excluded.amount,transaction_date=excluded.transaction_date,description=excluded.description,category_id=excluded.category_id,stage_id=excluded.stage_id,client_id=excluded.client_id,person_name=excluded.person_name,notes=excluded.notes,updated_at=now()
    where t.user_id=u and t.project_id=pid and t.deleted_at is null;
  if not found then raise exception 'transaction unavailable' using errcode='42501'; end if;
  if has_file then
    insert into public.attachments(id,user_id,project_id,transaction_id,file_name,file_path,file_type,file_size)
    values(p_operation_id,u,pid,tid,p_attachment->>'file_name',path,p_attachment->>'file_type',(p_attachment->>'file_size')::bigint)
    on conflict(transaction_id) do update set file_name=excluded.file_name,file_path=excluded.file_path,file_type=excluded.file_type,file_size=excluded.file_size;
  elsif p_remove_attachment then
    delete from public.attachments where transaction_id=tid and project_id=pid;
  end if;
  v_result := jsonb_build_object('saved',true,'cleanup_paths',case when previous.file_path is not null and (has_file or p_remove_attachment) and previous.file_path is distinct from path then jsonb_build_array(previous.file_path) else '[]'::jsonb end);
  update public.transaction_save_operations set result=v_result where operation_id=p_operation_id;
  return v_result;
end $$;
revoke all on function public.beity_save_transaction(uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.beity_save_transaction(uuid,jsonb,jsonb,boolean) to authenticated;
commit;
