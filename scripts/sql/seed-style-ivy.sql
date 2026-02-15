-- Ensure canonical Ivy style exists in base styles lookup.
-- Run manually against the database.

BEGIN;

INSERT INTO styles (name)
VALUES ('ivy')
ON CONFLICT (name) DO NOTHING;

COMMIT;
