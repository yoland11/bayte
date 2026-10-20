-- PREPARED: only staging is authorized. No existing financial rows change.
begin;
create table public.beity_runtime_controls (
 id boolean primary key default true check(id),
 maintenance boolean not null default false
);
insert into public.beity_runtime_controls(id,maintenance) values(true,false);
alter table public.beity_runtime_controls enable row level security;
revoke all on public.beity_runtime_controls from public,anon,authenticated;
grant select,update on public.beity_runtime_controls to service_role;
create function public.beity_writes_enabled() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce((select not maintenance from public.beity_runtime_controls where id),false)
$$;
revoke all on function public.beity_writes_enabled() from public,anon;
grant execute on function public.beity_writes_enabled() to authenticated;

do $$ declare t text; begin
 foreach t in array array['profiles','projects','transactions','clients','categories','construction_stages','attachments','transaction_save_operations'] loop
  execute format('create policy beity_maintenance_insert on public.%I as restrictive for insert to authenticated with check ((select public.beity_writes_enabled()))',t);
  execute format('create policy beity_maintenance_update on public.%I as restrictive for update to authenticated using ((select public.beity_writes_enabled())) with check ((select public.beity_writes_enabled()))',t);
  execute format('create policy beity_maintenance_delete on public.%I as restrictive for delete to authenticated using ((select public.beity_writes_enabled()))',t);
 end loop;
end $$;
create policy beity_maintenance_storage_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id not in ('transaction-attachments','project-assets') or (select public.beity_writes_enabled()));
create policy beity_maintenance_storage_update on storage.objects as restrictive for update to authenticated
using (bucket_id not in ('transaction-attachments','project-assets') or (select public.beity_writes_enabled()))
with check (bucket_id not in ('transaction-attachments','project-assets') or (select public.beity_writes_enabled()));
create policy beity_maintenance_storage_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id not in ('transaction-attachments','project-assets') or (select public.beity_writes_enabled()));

commit;
