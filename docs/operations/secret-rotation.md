# Secret Rotation Runbook

Rotate database credentials without manually editing SQL statements.

## Script

- `scripts/rotate-secrets.sh`

## What it does

1. Generates new secrets for:
   - `POSTGRES_PASSWORD`
   - `BRAIN_WRITER_PASSWORD`
   - `BRAIN_READER_PASSWORD`
2. Creates `.env` backup: `.env.bak.<timestamp>`
3. Updates `.env` values atomically
4. Runs `ALTER ROLE ... WITH PASSWORD ...` for the three DB roles
5. Optionally restarts dependent services

## Usage

Dry run (no changes):

```bash
scripts/rotate-secrets.sh --dry-run
```

Execute rotation and restart services:

```bash
scripts/rotate-secrets.sh --service-restart
```

Non-interactive mode:

```bash
scripts/rotate-secrets.sh --service-restart --non-interactive
```

## Post-rotation checks

```bash
./validate.sh
./test.sh
```

## Failure behavior

- If SQL role update fails, the script restores `.env` from backup.
- Check container logs for details:

```bash
docker compose logs db
```
