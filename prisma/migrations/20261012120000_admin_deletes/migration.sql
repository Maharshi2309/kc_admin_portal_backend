-- Admin-only deletes (`/api/admin/...`): deleting a user or an employee keeps
-- their change history and clears its link instead of being blocked.
-- MySQL doesn't fire triggers for foreign key actions, so this works with the
-- optional append-only triggers (database/audit-triggers.sql) in place.

-- DropForeignKey
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_actor_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_employee_id_fkey`;

-- AlterTable
ALTER TABLE `audit_logs` MODIFY `actor_user_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
