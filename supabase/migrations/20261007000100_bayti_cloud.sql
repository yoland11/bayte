create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null default '',
  font_preferences jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, project_id),
  unique (user_id, project_id, name),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade
);

create table if not exists public.construction_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, project_id),
  unique (user_id, project_id, name),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null,
  description text not null check (length(trim(description)) > 0),
  category_id uuid,
  stage_id uuid,
  person_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, project_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade,
  foreign key (category_id, user_id, project_id) references public.categories(id, user_id, project_id),
  foreign key (stage_id, user_id, project_id) references public.construction_stages(id, user_id, project_id)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  transaction_id uuid not null,
  file_name text not null,
  file_path text not null unique,
  file_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_at timestamptz not null default now(),
  unique (transaction_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade,
  foreign key (transaction_id, user_id, project_id) references public.transactions(id, user_id, project_id) on delete cascade
);

create index if not exists transactions_user_project_date_idx on public.transactions(user_id, project_id, transaction_date desc, created_at desc);
create index if not exists transactions_user_project_category_idx on public.transactions(user_id, project_id, category_id);
create index if not exists transactions_user_project_stage_idx on public.transactions(user_id, project_id, stage_id);
create index if not exists attachments_transaction_idx on public.attachments(user_id, project_id, transaction_id);

do $$ declare table_name text;
begin
  foreach table_name in array array['profiles', 'projects', 'categories', 'construction_stages', 'transactions'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.categories enable row level security;
alter table public.construction_stages enable row level security;
alter table public.transactions enable row level security;
alter table public.attachments enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profiles_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "projects_select_own" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects_insert_own" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects_update_own" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "projects_delete_own" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create policy "categories_select_own" on public.categories for select to authenticated using ((select auth.uid()) = user_id);
create policy "categories_insert_own" on public.categories for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "categories_update_own" on public.categories for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories_delete_own" on public.categories for delete to authenticated using ((select auth.uid()) = user_id);

create policy "stages_select_own" on public.construction_stages for select to authenticated using ((select auth.uid()) = user_id);
create policy "stages_insert_own" on public.construction_stages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "stages_update_own" on public.construction_stages for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "stages_delete_own" on public.construction_stages for delete to authenticated using ((select auth.uid()) = user_id);

create policy "transactions_select_own" on public.transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "transactions_insert_own" on public.transactions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "transactions_update_own" on public.transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "transactions_delete_own" on public.transactions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "attachments_select_own" on public.attachments for select to authenticated using ((select auth.uid()) = user_id);
create policy "attachments_insert_own" on public.attachments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "attachments_update_own" on public.attachments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "attachments_delete_own" on public.attachments for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.profiles, public.projects, public.categories, public.construction_stages, public.transactions, public.attachments to authenticated;
revoke all on public.profiles, public.projects, public.categories, public.construction_stages, public.transactions, public.attachments from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transaction-attachments', 'transaction-attachments', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

create policy "transaction_files_select_own" on storage.objects for select to authenticated
using (bucket_id = 'transaction-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "transaction_files_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'transaction-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "transaction_files_update_own" on storage.objects for update to authenticated
using (bucket_id = 'transaction-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'transaction-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "transaction_files_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'transaction-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.handle_new_bayti_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare new_project_id uuid;
begin
  insert into public.profiles (user_id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', '')) on conflict (user_id) do nothing;
  insert into public.projects (user_id, name, description) values (new.id, 'مشروع البيت', 'المشروع الرئيسي') returning id into new_project_id;
  insert into public.categories (user_id, project_id, name) values
    (new.id, new_project_id, 'مواد بناء'), (new.id, new_project_id, 'إسمنت'), (new.id, new_project_id, 'حديد'),
    (new.id, new_project_id, 'طابوق'), (new.id, new_project_id, 'رمل وحصى'), (new.id, new_project_id, 'أجور عمال'),
    (new.id, new_project_id, 'كهرباء'), (new.id, new_project_id, 'سباكة'), (new.id, new_project_id, 'أبواب وشبابيك'),
    (new.id, new_project_id, 'نقل'), (new.id, new_project_id, 'تشطيبات'), (new.id, new_project_id, 'أخرى');
  insert into public.construction_stages (user_id, project_id, name) values
    (new.id, new_project_id, 'الأساس'), (new.id, new_project_id, 'الهيكل والبناء'), (new.id, new_project_id, 'السقف'),
    (new.id, new_project_id, 'الكهرباء'), (new.id, new_project_id, 'السباكة'), (new.id, new_project_id, 'الأبواب والشبابيك'),
    (new.id, new_project_id, 'التبليط'), (new.id, new_project_id, 'الصبغ'), (new.id, new_project_id, 'التشطيبات'), (new.id, new_project_id, 'أخرى');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_bayti on auth.users;
create trigger on_auth_user_created_bayti after insert on auth.users for each row execute function public.handle_new_bayti_user();
