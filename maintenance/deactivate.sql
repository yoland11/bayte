-- Use only after a verified compatible app is ready. No grant/policy is removed.
begin;
update public.beity_runtime_controls set maintenance=false where id;
select maintenance as writes_must_be_enabled from public.beity_runtime_controls where id;
commit;
