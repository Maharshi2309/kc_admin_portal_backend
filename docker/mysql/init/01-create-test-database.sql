-- Runs once, when the development container's data volume is first created.
-- Integration tests use this database so they never touch development data.
CREATE DATABASE IF NOT EXISTS kc_admin_portal_test;
GRANT ALL PRIVILEGES ON kc_admin_portal_test.* TO 'kc'@'%';
-- Prisma creates a temporary "shadow" database when generating migrations.
GRANT CREATE, DROP ON *.* TO 'kc'@'%';
