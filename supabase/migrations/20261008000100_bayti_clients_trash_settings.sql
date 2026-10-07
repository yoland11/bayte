-- Additive features for client statements, recoverable transaction deletes, and project branding.
-- Existing financial records and project values are preserved.

alter table public.transactions add column if not exists client_id uuid;
alter table public.transactions add column if not exists deleted_at timestamptz;
alter table public.projects add column if not exists logo_path text;
alter table public.projects add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  profession text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, project_id),
  unique (user_id, project_id, name),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade
);

alter table public.transactions
  add constraint transactions_client_owner_project_fk
  foreign key (client_id, user_id, project_id)
  references public.clients(id, user_id, project_id);

create index if not exists transactions_user_project_client_idx
  on public.transactions(user_id, project_id, client_id);
create index if not exists transactions_user_project_deleted_idx
  on public.transactions(user_id, project_id, deleted_at)
  where deleted_at is not null;

drop trigger if exists set_updated_at on public.clients;
create trigger set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
create policy "clients_select_own" on public.clients for select to authenticated using ((select auth.uid()) = user_id);
create policy "clients_insert_own" on public.clients for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "clients_update_own" on public.clients for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "clients_delete_own" on public.clients for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.clients to authenticated;
revoke all on public.clients from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-assets', 'project-assets', false, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

create policy "project_assets_select_own" on storage.objects for select to authenticated
using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "project_assets_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "project_assets_update_own" on storage.objects for update to authenticated
using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "project_assets_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
