import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  budget: integer("budget").notNull(),
  topN: integer("top_n").notNull(),
  round: text("round").notNull(),
  deadline: text("deadline").notNull(),
  locked: integer("locked").notNull().default(0),
});
export const ballots = sqliteTable("ballots", {
  user: text("user").notNull(),
  round: text("round").notNull(),
  name: text("name").notNull(),
  votes: text("votes").notNull().default("[]"),
  revision: integer("revision").notNull().default(0),
  updated: text("updated").notNull(),
}, (t) => [primaryKey({ columns: [t.user, t.round] })]);
