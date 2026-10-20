# Actual encrypted-backup recovery rehearsal

This is an operator-controlled LOCAL disposable recovery workflow. Never point it at a linked project, production, or staging. It handles private financial/Auth records. Use an owned 0700 work directory outside the repository, 0600 configuration and inputs, disabled container logs, an internal Docker network, and loopback access only. Do not publish output, Docker inspect output, keys, hashes, restored rows or screenshots.

The completed rehearsal is documented in `docs/completion-final-actual-recovery-2026-10-20.json`. It restored actual operational records, not only synthetic fixtures. Provider migration histories and hosted control-plane/signing infrastructure are not a bit-for-bit restore.

## Private configuration

Set `BEITY_ACTUAL_RECOVERY_CONFIG` to a private absolute JSON file containing:

- `workdir`: owned 0700 directory outside the repository.
- `projectId`: unique `beity-actual-recovery-YYYYMMDD-suffix`.
- `sourceProjectRef`: `irnwbayhxawphkxmbnbx` (archive identity only).
- `port`: unused loopback port in 55000–55999.
- `backupDirectory`: verified encrypted archive directory.
- `keyPath`: independent private 32-byte recovery-key file.
- `pinHashPath`: approved private Argon2id hash file.
- `pinProvider`: private ES module exporting `readPin()`; acquire the existing PIN securely, never put it in this repository or logs.
- `evidencePath`: private output JSON path.

Initialize a NEW unlinked CLI project in `<workdir>/recovery-new` with the exact projectId. Start only the seven required services; do not start logging/analytics against restored records. Retain CLI-generated local opaque keys privately in `<workdir>/recovery-init.log`. Compile the current API/Realtime test entry as `<workdir>/server.mjs` using the same dependency versions as this release.

1. Run `python3 tests/recovery/actual/isolate.py` ONLY while the new database has zero Auth users. It refuses a populated target. It rebuilds this exact disposable container set with internal networking and disabled logs. Check image versions against archive metadata before importing; the verified rehearsal used GoTrue v2.197.0 and Storage API v1.80.2.
2. Compare source metadata against the initialized schema. The source required `realtime.messages.skip_broadcast boolean not null default false`; add it only to this isolated empty database when absent. Never alter an existing managed environment to force import.
3. Run `node tests/recovery/actual/restore-records.mjs`. It verifies checksums/AEAD and preserves source operational fields. It does not overwrite provider migration histories. Inspect only aggregate compatibility evidence.
4. Apply the eight pending Beity migrations locally in order. Ensure source-compatible service-role table privileges in this local CLI installation; preserve restrictive authenticated/anonymous RLS. Do not grant public access.
5. Start `node tests/recovery/actual/proxy.mjs` for loopback access to the internal services if Docker internal-network port publishing is unavailable. Start containers before the proxy when restarting Docker, to avoid host-port reservation conflicts.
6. Run `node tests/recovery/actual/functional.mjs`. It verifies original rows before changing ONLY disposable recovered credentials, uses local signing keys, rehydrates the actual Storage bytes, checks owner isolation, PIN sessions, Realtime, revocation and exact financial preservation. It creates/removes only its own disposable fixture. It is not a production procedure.
7. Test actual React startup against these local services without exporting private page content. Do not save screenshots of restored financial records.
8. Stop local bridges, then remove only containers, volumes and networks belonging to the exact disposable project. Preserve original encrypted archives and independently held recovery key. Do not use Docker prune.

## Limits

A successful rehearsal demonstrates operational recovery of the captured snapshot, not hosted PITR, provider root keys, external configuration or an automatic production restore. Storage rehydration preserves object bytes/path/ownership access; provider metadata can change. Original signed links and old JWTs are not portability promises. Keep a new pre-cutover encrypted backup and perform aggregate comparison again before an approved production transition.
