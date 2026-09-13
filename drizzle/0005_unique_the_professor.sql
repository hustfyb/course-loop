PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`classId` text NOT NULL,
	`teamId` text,
	`studentId` text,
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
INSERT INTO `__new_submissions`("id", "classId", "teamId", "studentId", "experimentId", "releaseId", "mode", "ordinal", "members", "fileIds", "note", "jobId", "created") SELECT "id", "classId", "teamId", NULL, "experimentId", "releaseId", "mode", "ordinal", "members", "fileIds", "note", "jobId", "created" FROM `submissions`;--> statement-breakpoint
DROP TABLE `submissions`;--> statement-breakpoint
ALTER TABLE `__new_submissions` RENAME TO `submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_jobId_unique` ON `submissions` (`jobId`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_version` ON `submissions` (`teamId`,`experimentId`,`mode`,`ordinal`);