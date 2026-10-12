-- OPTIONAL hardening: makes the audit log append-only inside the database
-- too (DATABASE_V2.md §2.5). The API never updates or deletes audit rows;
-- these triggers also stop manual queries from rewriting history.
--
-- Not part of the migrations because creating triggers needs extra MySQL
-- privileges that shared hosting may not give. Run it once in the hosting's
-- SQL editor; if it's refused, the API still works without it.

CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only (UPDATE is not allowed)';

CREATE TRIGGER `audit_logs_no_delete` BEFORE DELETE ON `audit_logs`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only (DELETE is not allowed)';
