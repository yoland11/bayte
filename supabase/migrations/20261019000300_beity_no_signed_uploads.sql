-- PREPARED: staging-only test authorization. No object bytes/paths change.
begin;
-- Signed-upload issuance uses INSERT permission, not SELECT. Direct JWT uploads
-- continue working, but a browser cannot mint a detached write capability.
create policy beity_no_detached_upload_tokens on storage.objects as restrictive
for insert to authenticated with check (
 bucket_id not in ('transaction-attachments','project-assets')
 or not storage.allow_any_operation(array['object.sign_upload_url'])
);
commit;
