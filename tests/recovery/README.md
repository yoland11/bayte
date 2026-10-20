# Isolated Supabase service recovery rehearsal

`full-stack.mjs` operates only against two disposable local stacks, with API ports 55121/55221 and database ports 55122/55222. It rejects hosted URLs, mismatched API/DB ports, incorrect project IDs and a linked remote project. It never loads `.env.local` or production credentials.

1. Initialize separate private Supabase workdirs named `recovery-source` and `recovery-target`, with project IDs `beity-recovery-source-20261020` and `beity-recovery-target-20261020`, and the exact application migrations. Start local Auth, Postgres, REST and Storage services. Save each `supabase status --output json` result privately as `source-status.json` / `target-status.json`; these files contain local secrets and must not be committed or printed.
2. Source fixtures are synthetic; canonical fixture uses the application's fixed UID and workspace. An unrelated synthetic user proves RLS isolation. The owned local source grants `service_role` CRUD on the application tables explicitly, because the CLI's current default auto-exposure differs from the hosted project's existing ACL. This is recorded as recovery ACL, not a production permission bypass or RLS change.
3. The runner takes an authorized native local data dump of `auth`, `public`, `storage`, excluding the already initialized provider migration-history tables. Existing application schema/policies/functions are reconstructed on each stack from the same migrations. Provider configuration/versions and application ACL are required recovery inputs, not implicit data-dump contents.
4. It saves a separately encrypted backup of the native SQL and object bytes with AES-256-GCM, then restores into the independently initialized empty target. The source test account's UUID and exact bcrypt hash must match after restore. It removes only the fresh target's seeded runtime-control and bucket rows inside the restore transaction, after verifying the target has no accounts, transactions or objects. The runner refuses a populated target; it does not reset it automatically.
5. Storage metadata alone must initially fail to retrieve bytes. Explicit object-byte rehydration then makes authenticated retrieval match SHA-256. RLS must reject foreign/anonymous users and revoked sessions. New PIN server login, uploads and deletes must work without changing financial fixture rows.
6. The service stacks can be stopped through their exact private workdirs after evidence capture. Never run these reset/stop commands against a linked production or staging project. Retrying after target restore requires a separately verified disposable-target reset; do not remove unknown containers or volumes.

Run only after constructing the two local stacks:

```sh
BEITY_ALLOW_LOCAL_RECOVERY=beity-recovery-20261020 \
BEITY_LOCAL_RECOVERY_DIR=/absolute/private/workdir \
BEITY_LOCAL_RECOVERY_HANDLERS=/absolute/private/current-handlers.mjs \
BEITY_LOCAL_RECOVERY_EVIDENCE=/absolute/report.json \
node tests/recovery/full-stack.mjs
```

## Interpretation

A passing result proves functional synthetic Auth + database + Storage recovery, including preserved IDs/password hash and file bytes. It is **not** a claim that the exact production backup has been restored into identical hosted services. Hosted versions, provider settings, JWT/encryption roots, Auth permissions, external integrations and recovery of the exact financial snapshot must be verified independently or explicitly accepted as limitations. No recovery test changes production settings or grants.

Supported provider guidance:

- https://supabase.com/docs/guides/local-development/restoring-downloaded-backup
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- https://supabase.com/docs/guides/self-hosting/restore-from-platform
