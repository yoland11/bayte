-- OPERATOR SECURITY CHANGE. Never remove bootstrap freeze before permanent gate is active.
begin;
set local lock_timeout='5s';
lock table public.profiles,public.projects,public.transactions,public.clients,
 public.categories,public.construction_stages,public.attachments,
 public.transaction_save_operations,public.beity_runtime_controls,storage.objects in share mode;
do $$ declare t text; p text; begin
 if not exists(select 1 from public.beity_runtime_controls where id and maintenance) then
  raise exception 'Permanent maintenance must be active before handoff';
 end if;
 foreach t in array array['profiles','projects','transactions','clients','categories','construction_stages','attachments','transaction_save_operations'] loop
  if not exists(select 1 from pg_class where oid=format('public.%I',t)::regclass and relrowsecurity) then raise exception 'RLS required'; end if;
  foreach p in array array['beity_maintenance_insert','beity_maintenance_update','beity_maintenance_delete'] loop
   if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=p and permissive='RESTRICTIVE') then raise exception 'Permanent policy missing'; end if;
  end loop;
 end loop;
 foreach p in array array['beity_maintenance_storage_insert','beity_maintenance_storage_update','beity_maintenance_storage_delete'] loop
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname=p and permissive='RESTRICTIVE') then raise exception 'Permanent Storage gate missing'; end if;
 end loop;
 foreach t in array array['profiles','projects','transactions','clients','categories','construction_stages','attachments'] loop
  execute format('drop trigger beity_cutover_freeze on public.%I',t);
  execute format('drop policy beity_cutover_insert on public.%I',t);
  execute format('drop policy beity_cutover_update on public.%I',t);
  execute format('drop policy beity_cutover_delete on public.%I',t);
 end loop;
end $$;
drop function public.beity_cutover_reject_write();
drop policy beity_cutover_storage_insert on storage.objects;
drop policy beity_cutover_storage_update on storage.objects;
drop policy beity_cutover_storage_delete on storage.objects;
commit;
