-- PREPARED: only staging is authorized. Existing object bytes/paths are preserved.
begin;
do $$ begin
 if to_regprocedure('storage.allow_any_operation(text[])') is null then
  raise exception 'Storage operation-aware helpers are required before this migration';
 end if;
end $$;
-- SELECT also authorizes signing. Keep normal authenticated reads, uploads,
-- deletes and SQL validation, but deny detached download/upload capabilities.
create policy beity_no_detached_file_tokens on storage.objects as restrictive
for select to authenticated using (
 bucket_id not in ('transaction-attachments','project-assets')
 or not storage.allow_any_operation(array['object.sign','object.sign_many','object.sign_upload_url','render.image_sign'])
);
commit;
