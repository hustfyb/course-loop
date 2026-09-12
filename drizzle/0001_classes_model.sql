-- 三角色模型迁移：课程(course, admin) 与课堂(class, teacher) 分离。
-- 旧数据保留策略：为每门旧课程生成一个默认课堂（沿用旧邀请码与班级规则），
-- enrollments/teams/members/submissions/files/jobs 的 courseId 迁移到对应 classId。
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`joinCode` text NOT NULL,
	`maxSize` integer DEFAULT 4 NOT NULL,
	`deadline` integer,
	`maxFormal` integer DEFAULT 2 NOT NULL,
	`autoPublish` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_joinCode_unique` ON `classes` (`joinCode`);--> statement-breakpoint
INSERT INTO `classes` (`id`,`courseId`,`owner`,`name`,`joinCode`,`maxSize`,`deadline`,`maxFormal`,`autoPublish`,`created`) SELECT 'class-'||`id`,`id`,`owner`,'默认课堂',`joinCode`,`maxSize`,`deadline`,`maxFormal`,`autoPublish`,`created` FROM `courses`;--> statement-breakpoint
ALTER TABLE `files` ADD COLUMN `classId` text;--> statement-breakpoint
UPDATE `files` SET `classId`=(SELECT 'class-'||`teams`.`courseId` FROM `teams` WHERE `teams`.`id`=`files`.`teamId`) WHERE `files`.`teamId` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD COLUMN `classId` text;--> statement-breakpoint
UPDATE `jobs` SET `classId`=(SELECT 'class-'||`teams`.`courseId` FROM `teams` WHERE `teams`.`id`=`jobs`.`teamId`) WHERE `jobs`.`teamId` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_enrollments` (
	`classId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`classId`, `userId`),
	FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_enrollments` SELECT 'class-'||`courseId`,`userId` FROM `enrollments`;--> statement-breakpoint
DROP TABLE `enrollments`;--> statement-breakpoint
ALTER TABLE `__new_enrollments` RENAME TO `enrollments`;--> statement-breakpoint
CREATE TABLE `__new_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`classId` text NOT NULL,
	`leader` text NOT NULL,
	`name` text NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leader`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_teams` SELECT `id`,'class-'||`courseId`,`leader`,`name`,`locked`,`created` FROM `teams`;--> statement-breakpoint
DROP TABLE `teams`;--> statement-breakpoint
ALTER TABLE `__new_teams` RENAME TO `teams`;--> statement-breakpoint
CREATE TABLE `__new_members` (
	`classId` text NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`slot` integer NOT NULL,
	PRIMARY KEY(`classId`, `userId`),
	FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_members` SELECT 'class-'||`courseId`,`teamId`,`userId`,`slot` FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
CREATE UNIQUE INDEX `member_seat` ON `members` (`teamId`,`slot`);--> statement-breakpoint
CREATE TABLE `__new_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`classId` text NOT NULL,
	`teamId` text NOT NULL,
	`experimentId` text NOT NULL,
	`releaseId` text NOT NULL,
	`mode` text NOT NULL,
	`ordinal` integer NOT NULL,
	`members` text NOT NULL,
	`fileIds` text NOT NULL,
	`note` text NOT NULL,
	`jobId` text NOT NULL,
	`created` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_submissions` SELECT `id`,'class-'||`courseId`,`teamId`,`experimentId`,`releaseId`,`mode`,`ordinal`,`members`,`fileIds`,`note`,`jobId`,`created` FROM `submissions`;--> statement-breakpoint
DROP TABLE `submissions`;--> statement-breakpoint
ALTER TABLE `__new_submissions` RENAME TO `submissions`;--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_jobId_unique` ON `submissions` (`jobId`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_version` ON `submissions` (`teamId`,`experimentId`,`mode`,`ordinal`);--> statement-breakpoint
DROP INDEX `courses_joinCode_unique`;--> statement-breakpoint
ALTER TABLE `courses` DROP COLUMN `joinCode`;--> statement-breakpoint
ALTER TABLE `courses` DROP COLUMN `maxSize`;--> statement-breakpoint
ALTER TABLE `courses` DROP COLUMN `deadline`;--> statement-breakpoint
ALTER TABLE `courses` DROP COLUMN `maxFormal`;--> statement-breakpoint
ALTER TABLE `courses` DROP COLUMN `autoPublish`;--> statement-breakpoint
UPDATE `users` SET `role`='admin' WHERE `role`='teacher';--> statement-breakpoint
PRAGMA foreign_keys=ON;
