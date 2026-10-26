CREATE TABLE `makeups_new` (
	`courseId` text NOT NULL,
	`experimentId` text NOT NULL,
	`classId` text DEFAULT '' NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`discount` integer NOT NULL,
	`updated` integer NOT NULL,
	CONSTRAINT `makeups_pk` PRIMARY KEY (`courseId`,`experimentId`,`classId`)
);
--> statement-breakpoint
INSERT INTO `makeups_new` (`courseId`,`experimentId`,`classId`,`start`,`end`,`discount`,`updated`) SELECT `courseId`,`experimentId`,'' ,`start`,`end`,`discount`,`updated` FROM `makeups`;
--> statement-breakpoint
DROP TABLE `makeups`;
--> statement-breakpoint
ALTER TABLE `makeups_new` RENAME TO `makeups`;
