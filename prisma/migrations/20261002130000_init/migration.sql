-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `employee_id` INTEGER NULL,
    `last_sign_in_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_employee_id_key`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `key` VARCHAR(64) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `sort` INTEGER NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `user_id` INTEGER NOT NULL,
    `permission_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_permissions_permission_key_idx`(`permission_key`),
    PRIMARY KEY (`user_id`, `permission_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `user_agent` VARCHAR(255) NULL,

    INDEX `sessions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `departments_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `designations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `department_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `designations_department_id_name_key`(`department_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `has_balance` BOOLEAN NOT NULL DEFAULT true,
    `annual_quota` DECIMAL(5, 1) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leave_types_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ec_number` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `mobile` CHAR(10) NOT NULL,
    `department_id` INTEGER NOT NULL,
    `designation_id` INTEGER NOT NULL,
    `joining_date` DATE NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_by` INTEGER NOT NULL,
    `updated_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_ec_number_key`(`ec_number`),
    UNIQUE INDEX `employees_email_key`(`email`),
    INDEX `employees_status_idx`(`status`),
    INDEX `employees_department_id_idx`(`department_id`),
    INDEX `employees_designation_id_idx`(`designation_id`),
    INDEX `employees_joining_date_idx`(`joining_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_work_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `start_time` TIME(0) NOT NULL,
    `end_time` TIME(0) NOT NULL,
    `break_minutes` INTEGER NOT NULL DEFAULT 0,
    `break_start` TIME(0) NULL,
    `break_end` TIME(0) NULL,
    `weekly_off_days` JSON NOT NULL,
    `expected_minutes` INTEGER NOT NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_work_schedules_employee_id_effective_from_idx`(`employee_id`, `effective_from` DESC),
    UNIQUE INDEX `employee_work_schedules_employee_id_effective_from_key`(`employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `punch_in` DATETIME(3) NULL,
    `punch_out` DATETIME(3) NULL,
    `punched_in_by` INTEGER NULL,
    `punched_out_by` INTEGER NULL,
    `status` ENUM('present', 'late', 'half_day', 'on_leave', 'absent', 'weekly_off', 'holiday') NOT NULL,
    `note` VARCHAR(100) NULL,
    `day_kind` ENUM('working', 'holiday_worked', 'week_off_worked') NOT NULL DEFAULT 'working',
    `schedule_id` INTEGER NULL,
    `expected_minutes` INTEGER NOT NULL DEFAULT 0,
    `worked_minutes` INTEGER NULL,
    `overtime_minutes` INTEGER NOT NULL DEFAULT 0,
    `corrected_by` INTEGER NULL,
    `corrected_at` DATETIME(3) NULL,
    `reason` ENUM('forgot_to_punch', 'device_issue', 'on_field_duty', 'wrong_time_recorded', 'other') NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_records_date_idx`(`date`),
    UNIQUE INDEX `attendance_records_employee_id_date_key`(`employee_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leaves` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `leave_type_id` VARCHAR(32) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `is_half_day` BOOLEAN NOT NULL DEFAULT false,
    `days` DECIMAL(5, 1) NOT NULL,
    `reason` ENUM('personal_work', 'family_function', 'medical', 'travel', 'other') NOT NULL,
    `remarks` TEXT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL,
    `created_by` INTEGER NOT NULL,
    `decided_by` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `cancelled_by` INTEGER NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leaves_employee_id_start_date_end_date_idx`(`employee_id`, `start_date`, `end_date`),
    INDEX `leaves_status_idx`(`status`),
    INDEX `leaves_leave_type_id_idx`(`leave_type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_holidays` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `live_date` DATE NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `created_by` INTEGER NOT NULL,
    `updated_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` INTEGER NULL,

    UNIQUE INDEX `company_holidays_live_date_key`(`live_date`),
    INDEX `company_holidays_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_user_id` INTEGER NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(32) NOT NULL,
    `entity_id` VARCHAR(64) NOT NULL,
    `employee_id` INTEGER NULL,
    `affected_date` DATE NULL,
    `summary` VARCHAR(255) NOT NULL,
    `changes` JSON NOT NULL,
    `reason` VARCHAR(32) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_employee_id_affected_date_idx`(`employee_id`, `affected_date`),
    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_logs_created_at_idx`(`created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_permission_key_fkey` FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `designations` ADD CONSTRAINT `designations_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_designation_id_fkey` FOREIGN KEY (`designation_id`) REFERENCES `designations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_work_schedules` ADD CONSTRAINT `employee_work_schedules_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_work_schedules` ADD CONSTRAINT `employee_work_schedules_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `employee_work_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_punched_in_by_fkey` FOREIGN KEY (`punched_in_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_punched_out_by_fkey` FOREIGN KEY (`punched_out_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_corrected_by_fkey` FOREIGN KEY (`corrected_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leaves` ADD CONSTRAINT `leaves_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leaves` ADD CONSTRAINT `leaves_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leaves` ADD CONSTRAINT `leaves_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leaves` ADD CONSTRAINT `leaves_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leaves` ADD CONSTRAINT `leaves_cancelled_by_fkey` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_holidays` ADD CONSTRAINT `company_holidays_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_holidays` ADD CONSTRAINT `company_holidays_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_holidays` ADD CONSTRAINT `company_holidays_deleted_by_fkey` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data rules the database enforces too (MySQL 8.0.16+ enforces CHECK).
-- ---------------------------------------------------------------------------

ALTER TABLE `leave_types`
  ADD CONSTRAINT `leave_types_id_slug` CHECK (REGEXP_LIKE(`id`, '^[a-z][a-z0-9_-]*$', 'c')),
  ADD CONSTRAINT `leave_types_quota_not_negative` CHECK (`annual_quota` IS NULL OR `annual_quota` >= 0);

ALTER TABLE `employees`
  ADD CONSTRAINT `employees_ec_number_format` CHECK (REGEXP_LIKE(`ec_number`, '^KC[0-9]+$', 'c')),
  ADD CONSTRAINT `employees_mobile_digits` CHECK (REGEXP_LIKE(`mobile`, '^[0-9]{10}$'));

ALTER TABLE `employee_work_schedules`
  ADD CONSTRAINT `schedules_end_after_start` CHECK (`end_time` > `start_time`),
  ADD CONSTRAINT `schedules_break_not_negative` CHECK (`break_minutes` >= 0),
  ADD CONSTRAINT `schedules_expected_positive` CHECK (`expected_minutes` > 0),
  ADD CONSTRAINT `schedules_expected_matches` CHECK (
    `expected_minutes` * 60 = TIME_TO_SEC(`end_time`) - TIME_TO_SEC(`start_time`) - `break_minutes` * 60
  ),
  ADD CONSTRAINT `schedules_break_window` CHECK (
    (`break_start` IS NULL AND `break_end` IS NULL)
    OR (
      `break_start` IS NOT NULL AND `break_end` IS NOT NULL
      AND `break_start` >= `start_time` AND `break_end` <= `end_time`
      AND TIME_TO_SEC(`break_end`) - TIME_TO_SEC(`break_start`) = `break_minutes` * 60
    )
  ),
  ADD CONSTRAINT `schedules_weekly_off_days` CHECK (
    JSON_TYPE(`weekly_off_days`) = 'ARRAY' AND JSON_LENGTH(`weekly_off_days`) < 7
  ),
  ADD CONSTRAINT `schedules_effective_range` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`);

ALTER TABLE `attendance_records`
  ADD CONSTRAINT `attendance_punch_order` CHECK (`punch_out` IS NULL OR (`punch_in` IS NOT NULL AND `punch_out` > `punch_in`)),
  ADD CONSTRAINT `attendance_minutes_not_negative` CHECK (
    `expected_minutes` >= 0 AND `overtime_minutes` >= 0 AND (`worked_minutes` IS NULL OR `worked_minutes` >= 0)
  );

ALTER TABLE `leaves`
  ADD CONSTRAINT `leaves_date_order` CHECK (`end_date` >= `start_date`),
  ADD CONSTRAINT `leaves_half_day_single` CHECK (NOT `is_half_day` OR `end_date` = `start_date`),
  ADD CONSTRAINT `leaves_days_not_negative` CHECK (`days` >= 0);

ALTER TABLE `company_holidays`
  ADD CONSTRAINT `company_holidays_name_not_blank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
  ADD CONSTRAINT `company_holidays_live_date` CHECK (
    (`deleted_at` IS NULL AND `live_date` = `date`) OR (`deleted_at` IS NOT NULL AND `live_date` IS NULL)
  );
