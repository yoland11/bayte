-- OPERATOR SECURITY CHANGE. Staging only until explicitly approved for production.
-- Install BEFORE the five pending migrations. No financial row is changed.
begin;
set local lock_timeout='5s';
-- Wait for earlier writers; lock timeout aborts rather than pretending to freeze.
lock table public.profiles,public.projects,public.transactions,public.clients,
 public.categories,public.construction_stages,public.attachments,storage.objects in share mode;
-- Legacy Auth/bootstrap functions run as SECURITY DEFINER and bypass RLS.
-- A temporary trigger also stops those application-table writes until handoff.
create function public.beity_cutover_reject_write() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'Beity maintenance write freeze' using errcode='42501'; end $$;
revoke all on function public.beity_cutover_reject_write() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['profiles','projects','transactions','clients','categories','construction_stages','attachments'] loop
  execute format('create trigger beity_cutover_freeze before insert or update or delete on public.%I for each row execute function public.beity_cutover_reject_write()',t);
  execute format('create policy beity_cutover_insert on public.%I as restrictive for insert to anon,authenticated with check(false)',t);
  execute format('create policy beity_cutover_update on public.%I as restrictive for update to anon,authenticated using(false) with check(false)',t);
  execute format('create policy beity_cutover_delete on public.%I as restrictive for delete to anon,authenticated using(false)',t);
 end loop;
end $$;
revoke all on function public.ensure_bayti_workspace() from public,anon,authenticated;
create policy beity_cutover_storage_insert on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id not in ('transaction-attachments','project-assets'));
create policy beity_cutover_storage_update on storage.objects as restrictive for update to anon,authenticated
using(bucket_id not in ('transaction-attachments','project-assets')) with check(bucket_id not in ('transaction-attachments','project-assets'));
create policy beity_cutover_storage_delete on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id not in ('transaction-attachments','project-assets'));
commit;
