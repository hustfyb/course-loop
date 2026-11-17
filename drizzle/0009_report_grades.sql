CREATE TABLE `report_grades` (
	`submissionId` text PRIMARY KEY NOT NULL,
	`report` text NOT NULL,
	`published` integer NOT NULL DEFAULT 0,
	`updated` integer NOT NULL
);
