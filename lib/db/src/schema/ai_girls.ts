import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiGirlsTable = pgTable("ai_girls", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  image_url: text("image_url").notNull(),
  voice_url: text("voice_url").notNull(),
  prompt: text("prompt").default(""),
  voice_text: text("voice_text").default(""),
  voice_id: text("voice_id").default("Alba"),
  model: text("model").default(""),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const insertAiGirlSchema = createInsertSchema(aiGirlsTable).omit({
  id: true,
  created_at: true,
});

export type InsertAiGirl = z.infer<typeof insertAiGirlSchema>;
export type AiGirl = typeof aiGirlsTable.$inferSelect;
