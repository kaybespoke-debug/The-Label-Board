-- =====================================================================
-- Free the name "LAYI" for the real studio.
--
-- 20260904170000_seed_test_studios.sql created a fixture studio called
-- "LAYI" to give the console something multi-branch to render against.
-- LAYI is now the name of Kayode's actual label, which is about to be
-- invited as a real tenant, and two rows called LAYI in the subscriber
-- list is how you end up doing the wrong studio's billing.
--
-- So the fixture gets a name that reads as a fixture.
--
-- The SLUG stays as it is on purpose. It is referenced by
-- 20260904200000_clear_cross_studio_contamination.sql and by
-- supabase/tests/seed_sql.mjs, and a slug is an identifier rather than
-- a label: nothing shows it to a person, and changing it would only
-- break the things that look the fixture up by it.
--
-- Matched on the slug rather than the old name, so running this twice
-- does nothing the second time, and running it after somebody has
-- renamed the row by hand does not rename their row back.
-- =====================================================================

update public.businesses
   set name = 'Seed Multi Studio'
 where slug = 'layi-multi-studio'
   and name = 'LAYI';
