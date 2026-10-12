-- V3 (app commit 678a5ee, 2026-10-05; client answers 2026-10-06).
-- Keeps every existing row: departments get codes, designations become the
-- independent positions list, employees switch to codes and lose their email,
-- Sick and Earned leave become Casual, and split leave gets its link.

-- ---------------------------------------------------------------------------
-- Departments: add codes (from the name, e.g. "Graphic Designer" ->
-- graphic_designer) and the three default departments.
-- ---------------------------------------------------------------------------
ALTER TABLE `departments` ADD COLUMN `code` VARCHAR(50) NULL;

UPDATE `departments`
SET `code` = LEFT(TRIM(BOTH '_' FROM REGEXP_REPLACE(LOWER(`name`), '[^a-z0-9]+', '_')), 50);
UPDATE `departments` SET `code` = CONCAT('department_', `id`) WHERE `code` IS NULL OR `code` = '';

INSERT INTO `departments` (`code`, `name`, `created_at`, `updated_at`)
SELECT 'accountant', 'Accountant', NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `departments` WHERE `code` = 'accountant' OR `name` = 'Accountant');
INSERT INTO `departments` (`code`, `name`, `created_at`, `updated_at`)
SELECT 'graphic_designer', 'Graphic Designer', NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `departments` WHERE `code` = 'graphic_designer' OR `name` = 'Graphic Designer');
INSERT INTO `departments` (`code`, `name`, `created_at`, `updated_at`)
SELECT 'tailor', 'Tailor', NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `departments` WHERE `code` = 'tailor' OR `name` = 'Tailor');

ALTER TABLE `departments` MODIFY `code` VARCHAR(50) NOT NULL;
CREATE UNIQUE INDEX `departments_code_key` ON `departments`(`code`);

-- ---------------------------------------------------------------------------
-- Positions: one list, independent of departments. Filled from the existing
-- designations (one position per distinct name) plus the three defaults.
-- ---------------------------------------------------------------------------
CREATE TABLE `positions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `positions_code_key`(`code`),
    UNIQUE INDEX `positions_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `positions` (`code`, `name`, `created_at`, `updated_at`)
SELECT x.`code`, MIN(x.`name`), NOW(3), NOW(3)
FROM (
    SELECT LEFT(TRIM(BOTH '_' FROM REGEXP_REPLACE(LOWER(`name`), '[^a-z0-9]+', '_')), 50) AS `code`, `name`
    FROM `designations`
) x
WHERE x.`code` <> ''
GROUP BY x.`code`;

INSERT INTO `positions` (`code`, `name`, `created_at`, `updated_at`)
SELECT 'accountant', 'Accountant', NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `positions` WHERE `code` = 'accountant' OR `name` = 'Accountant');
INSERT INTO `positions` (`code`, `name`, `created_at`, `updated_at`)
SELECT 'graphic_designer', 'Graphic Designer', NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `positions` WHERE `code` = 'graphic_designer' OR `name` = 'Graphic Designer');
INSERT INTO `positions` (`code`, `name`, `created_at`, `updated_at`)
SELECT 'tailor', 'Tailor', NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `positions` WHERE `code` = 'tailor' OR `name` = 'Tailor');

-- ---------------------------------------------------------------------------
-- Employees: department and position codes; no email.
-- ---------------------------------------------------------------------------
ALTER TABLE `employees`
    ADD COLUMN `department` VARCHAR(50) NULL,
    ADD COLUMN `position` VARCHAR(50) NULL;

UPDATE `employees` e JOIN `departments` d ON d.`id` = e.`department_id`
SET e.`department` = d.`code`;

UPDATE `employees` e
JOIN `designations` g ON g.`id` = e.`designation_id`
JOIN `positions` p ON p.`code` = LEFT(TRIM(BOTH '_' FROM REGEXP_REPLACE(LOWER(g.`name`), '[^a-z0-9]+', '_')), 50)
SET e.`position` = p.`code`;

-- A designation whose name had no letters or digits has no position: such
-- employees get the first position, for an admin to correct.
UPDATE `employees`
SET `position` = (SELECT `code` FROM `positions` ORDER BY `id` LIMIT 1)
WHERE `position` IS NULL;

ALTER TABLE `employees` DROP FOREIGN KEY `employees_department_id_fkey`;
ALTER TABLE `employees` DROP FOREIGN KEY `employees_designation_id_fkey`;
DROP INDEX `employees_department_id_idx` ON `employees`;
DROP INDEX `employees_designation_id_idx` ON `employees`;
DROP INDEX `employees_email_key` ON `employees`;

ALTER TABLE `employees`
    DROP COLUMN `department_id`,
    DROP COLUMN `designation_id`,
    DROP COLUMN `email`,
    MODIFY `department` VARCHAR(50) NOT NULL,
    MODIFY `position` VARCHAR(50) NOT NULL;

CREATE INDEX `employees_department_idx` ON `employees`(`department`);
CREATE INDEX `employees_position_idx` ON `employees`(`position`);
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_fkey` FOREIGN KEY (`department`) REFERENCES `departments`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `employees` ADD CONSTRAINT `employees_position_fkey` FOREIGN KEY (`position`) REFERENCES `positions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE `designations`;

-- ---------------------------------------------------------------------------
-- Leave types: only Casual (paid, with a balance) and Unpaid. Every other
-- type's leave becomes Casual (client answer 2026-10-06: Sick and Earned ->
-- Casual); those types stay in the table, inactive.
-- ---------------------------------------------------------------------------
ALTER TABLE `leave_types` DROP CHECK `leave_types_quota_not_negative`;
ALTER TABLE `leave_types`
    ADD COLUMN `is_paid` BOOLEAN NOT NULL DEFAULT true,
    DROP COLUMN `annual_quota`;

INSERT INTO `leave_types` (`id`, `name`, `has_balance`, `is_paid`, `sort`, `is_active`, `created_at`, `updated_at`)
SELECT 'casual', 'Casual', true, true, 1, true, NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `leave_types` WHERE `id` = 'casual');
INSERT INTO `leave_types` (`id`, `name`, `has_balance`, `is_paid`, `sort`, `is_active`, `created_at`, `updated_at`)
SELECT 'unpaid', 'Unpaid', false, false, 2, true, NOW(3), NOW(3) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `leave_types` WHERE `id` = 'unpaid');

UPDATE `leave_types` SET `has_balance` = true, `is_paid` = true, `sort` = 1, `is_active` = true WHERE `id` = 'casual';
UPDATE `leave_types` SET `has_balance` = false, `is_paid` = false, `sort` = 2, `is_active` = true WHERE `id` = 'unpaid';
UPDATE `leaves` SET `leave_type_id` = 'casual' WHERE `leave_type_id` NOT IN ('casual', 'unpaid');
UPDATE `leave_types` SET `is_active` = false WHERE `id` NOT IN ('casual', 'unpaid');

-- ---------------------------------------------------------------------------
-- Split leave: the Unpaid part points at its Casual part.
-- ---------------------------------------------------------------------------
ALTER TABLE `leaves` ADD COLUMN `unpaid_part_of` INTEGER NULL;
CREATE UNIQUE INDEX `leaves_unpaid_part_of_key` ON `leaves`(`unpaid_part_of`);
ALTER TABLE `leaves` ADD CONSTRAINT `leaves_unpaid_part_of_fkey` FOREIGN KEY (`unpaid_part_of`) REFERENCES `leaves`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Opening balances and corrections of Casual leave.
-- ---------------------------------------------------------------------------
CREATE TABLE `leave_balance_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `days` DECIMAL(5, 1) NOT NULL,
    `effective_month` DATE NOT NULL,
    `reason` TEXT NOT NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_balance_adjustments_employee_id_effective_month_idx`(`employee_id`, `effective_month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `leave_balance_adjustments` ADD CONSTRAINT `leave_balance_adjustments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `leave_balance_adjustments` ADD CONSTRAINT `leave_balance_adjustments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `leave_balance_adjustments`
    ADD CONSTRAINT `leave_balance_adjustments_month_start` CHECK (DAY(`effective_month`) = 1),
    ADD CONSTRAINT `leave_balance_adjustments_half_steps` CHECK (MOD(`days` * 2, 1) = 0);
