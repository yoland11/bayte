begin;
update public.beity_runtime_controls set maintenance=true where id;
select maintenance as writes_must_be_disabled from public.beity_runtime_controls where id;
commit;
