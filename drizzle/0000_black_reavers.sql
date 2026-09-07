CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`submissionId` text NOT NULL,
	`userId` text NOT NULL,
	`content` text NOT NULL,
	`jobId` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_person` ON `answers` (`submissionId`,`userId`);--> statement-breakpoint
CREATE TABLE `appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`submissionId` text NOT NULL,
	`userId` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`term` text NOT NULL,
	`draft` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`publishedId` text,
	`joinCode` text NOT NULL,
	`maxSize` integer DEFAULT 4 NOT NULL,
	`deadline` integer,
	`maxFormal` integer DEFAULT 2 NOT NULL,
	`autoPublish` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_joinCode_unique` ON `courses` (`joinCode`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`courseId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`courseId`, `userId`),
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`courseId` text NOT NULL,
	`teamId` text,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grades` (
	`submissionId` text PRIMARY KEY NOT NULL,
	`report` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invites_email` ON `invites` (`email`,`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`courseId` text,
	`teamId` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result` text,
	`error` text,
	`lease` text,
	`expires` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_queue` ON `jobs` (`status`,`kind`,`created`);--> statement-breakpoint
CREATE TABLE `members` (
	`courseId` text NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`slot` integer NOT NULL,
	PRIMARY KEY(`courseId`, `userId`),
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_seat` ON `members` (`teamId`,`slot`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`fileIds` text DEFAULT '[]' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_course` ON `messages` (`courseId`,`created`);--> statement-breakpoint
CREATE TABLE `otps` (
	`email` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires` integer NOT NULL,
	`sent` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_version` ON `releases` (`courseId`,`revision`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_jobId_unique` ON `submissions` (`jobId`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_version` ON `submissions` (`teamId`,`experimentId`,`mode`,`ordinal`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`courseId` text NOT NULL,
	`leader` text NOT NULL,
	`name` text NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leader`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`studentNo` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);