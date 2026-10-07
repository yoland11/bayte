-- Idempotently create a Bayti workspace for a signed-in user whose Auth
-- session existed before the database trigger was installed.
create or replace function public.ensure_bayti_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_project_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required to create a Bayti workspace';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text, 0));

  insert into public.profiles (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  select id into current_project_id
  from public.projects
  where user_id = current_user_id
  order by created_at, id
  limit 1;

  if current_project_id is not null then
    return current_project_id;
  end if;

  insert into public.projects (user_id, name, description)
  values (current_user_id, 'مشروع البيت', 'المشروع الرئيسي')
  returning id into current_project_id;

  insert into public.categories (user_id, project_id, name) values
    (current_user_id, current_project_id, 'مواد بناء'),
    (current_user_id, current_project_id, 'إسمنت'),
    (current_user_id, current_project_id, 'حديد'),
    (current_user_id, current_project_id, 'طابوق'),
    (current_user_id, current_project_id, 'رمل وحصى'),
    (current_user_id, current_project_id, 'أجور عمال'),
    (current_user_id, current_project_id, 'كهرباء'),
    (current_user_id, current_project_id, 'سباكة'),
    (current_user_id, current_project_id, 'أبواب وشبابيك'),
    (current_user_id, current_project_id, 'نقل'),
    (current_user_id, current_project_id, 'تشطيبات'),
    (current_user_id, current_project_id, 'أخرى');

  insert into public.construction_stages (user_id, project_id, name) values
    (current_user_id, current_project_id, 'الأساس'),
    (current_user_id, current_project_id, 'الهيكل والبناء'),
    (current_user_id, current_project_id, 'السقف'),
    (current_user_id, current_project_id, 'الكهرباء'),
    (current_user_id, current_project_id, 'السباكة'),
    (current_user_id, current_project_id, 'الأبواب والشبابيك'),
    (current_user_id, current_project_id, 'التبليط'),
    (current_user_id, current_project_id, 'الصبغ'),
    (current_user_id, current_project_id, 'التشطيبات'),
    (current_user_id, current_project_id, 'أخرى');

  return current_project_id;
end;
$$;

revoke all on function public.ensure_bayti_workspace() from public, anon;
grant execute on function public.ensure_bayti_workspace() to authenticated;

notify pgrst, 'reload schema';
