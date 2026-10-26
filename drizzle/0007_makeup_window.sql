CREATE TABLE `makeups` (
	`courseId` text NOT NULL,
	`experimentId` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`discount` integer NOT NULL,
	`updated` integer NOT NULL,
	CONSTRAINT `makeups_pk` PRIMARY KEY (`courseId`,`experimentId`)
);
--> statement-breakpoint
ALTER TABLE `submissions` ADD `makeup` integer NOT NULL DEFAULT 0;
