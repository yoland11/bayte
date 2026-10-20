-- The canonical workspace already exists. Auth lifecycle must not provision
-- financial workspaces, profiles or option rows for new devices/accounts.
-- Preserve the trigger attachment and all existing users/rows; replace only its body.
begin;
create or replace function public.handle_new_bayti_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  return new;
end;
$$;
revoke all on function public.handle_new_bayti_user() from public,anon,authenticated;
commit;
