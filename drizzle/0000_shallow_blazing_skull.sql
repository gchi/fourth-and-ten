CREATE TABLE `ballots` (
	`user` text NOT NULL,
	`round` text NOT NULL,
	`name` text NOT NULL,
	`votes` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`user`, `round`)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`budget` integer NOT NULL,
	`top_n` integer NOT NULL,
	`round` text NOT NULL,
	`deadline` text NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL
);
