-- =====================================================================
-- The schedule itself, kept apart from the work it schedules
-- =====================================================================
-- Separate from 20261004100000 for one reason: pg_cron is a compiled
-- extension and a bare Postgres does not have it. A CREATE EXTENSION at the
-- top of the file that defines the backup tables and functions takes the
-- whole file down with it wherever the extension is missing — and every
-- suite here builds the schema in PGlite, which has none. With the two
-- mixed, the suites silently tested none of it.
--
-- So the portable half — the tables, the round, the checksums — applies
-- everywhere and is fully tested, and this half is the one line of
-- environment that only a real project has.
--
-- CONDITIONAL, AND THAT IS A RISK WORTH NAMING. A migration that skips
-- itself where it cannot run is also a migration that skips itself where it
-- SHOULD have run and something was wrong. Nothing here would tell you. So
-- the check is not in this file: backup_harness asserts a job is registered
-- with the right schedule and command, and the production promotion asks
-- cron.job directly. If you are reading this because backups stopped, that
-- is the first thing to look at:
--
--     select jobname, schedule, active from cron.job;
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    /* unschedule first so re-running this migration does not leave two jobs
       doing the same work at the same minute */
    begin
      perform cron.unschedule('nightly-studio-backups');
    exception when others then null;
    end;

    /* 02:40 UTC: a quiet hour in Lagos and in London, and not on the hour,
       because everything else in the world runs on the hour. */
    perform cron.schedule('nightly-studio-backups', '40 2 * * *',
                          'select app.take_studio_backups(14)');
  else
    raise notice 'pg_cron is not available here, so the nightly backup is not scheduled. This is expected in a test database and is NOT expected in a project.';
  end if;
end $$;
