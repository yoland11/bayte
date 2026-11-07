-- Keep amount as cash paid/received; legacy rows have no separate invoice total.
begin;
alter table public.transactions
  add column total_amount numeric(14,2),
  drop constraint transactions_amount_check,
  add constraint beity_transactions_settlement_check check (
    amount >= 0 and coalesce(total_amount, amount) > 0
    and (total_amount is null or (total_amount <> 'NaN'::numeric and amount <= total_amount))
  );
create or replace function public.beity_save_transaction(p_operation_id uuid,p_transaction jsonb,p_attachment jsonb default null,p_remove_attachment boolean default false) returns jsonb
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
  if exists(select 1 from public.transactions where id=tid) then
    if not exists(select 1 from public.transactions where id=tid and user_id=u and project_id=pid and deleted_at is null
      and revision=(p_transaction->>'expected_revision')::bigint) then
      raise exception 'transaction revision conflict' using errcode='PT409';
    end if;
  elsif p_transaction->>'expected_revision' is not null then
    raise exception 'transaction revision conflict' using errcode='PT409';
  end if;
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
  insert into public.transactions as t(id,user_id,project_id,type,amount,total_amount,transaction_date,description,category_id,stage_id,client_id,person_name,notes,created_at,updated_at)
  values(tid,u,pid,p_transaction->>'type',(p_transaction->>'amount')::numeric,(p_transaction->>'total_amount')::numeric,(p_transaction->>'transaction_date')::date,p_transaction->>'description',nullif(p_transaction->>'category_id','')::uuid,nullif(p_transaction->>'stage_id','')::uuid,nullif(p_transaction->>'client_id','')::uuid,p_transaction->>'person_name',p_transaction->>'notes',(p_transaction->>'created_at')::timestamptz,now())
  on conflict(id) do update set type=excluded.type,amount=excluded.amount,
    total_amount=case when p_transaction ? 'total_amount' then excluded.total_amount
      when t.total_amount is distinct from t.amount then t.total_amount else null end,transaction_date=excluded.transaction_date,description=excluded.description,category_id=excluded.category_id,stage_id=excluded.stage_id,client_id=excluded.client_id,person_name=excluded.person_name,notes=excluded.notes,updated_at=now()
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
commit;
