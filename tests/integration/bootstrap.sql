-- ONLY for a new disposable beity_test_* database on loopback.
-- Minimal Auth/Storage SQL contracts; this is NOT a running GoTrue/Storage service.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
-- Isolated SQL contract only; hosted tests exercise the real Storage provider.
create function storage.allow_any_operation(text[]) returns boolean language sql stable as $$select coalesce(current_setting('storage.operation',true)=any($1),false)$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb default '{}'::jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema auth,storage,public to anon,authenticated,service_role;
grant execute on all functions in schema auth,storage to anon,authenticated,service_role;
