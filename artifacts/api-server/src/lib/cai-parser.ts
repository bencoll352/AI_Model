import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

export interface CaiUser {
  id?: string;
  username?: string;
  name?: string;
}

export interface CaiPersona {
  external_id?: string;
  title?: string;
  definition?: string;
  avatar_file_name?: string;
}

export interface CaiTurnCandidate {
  candidate_id?: string;
  text?: string;
  create_time?: string;
}

export interface CaiTurnAuthor {
  author_id?: string;
  name?: string;
  is_human?: boolean;
}

export interface CaiTurn {
  turn_key?: { chat_id?: string; turn_id?: string };
  author?: CaiTurnAuthor;
  candidates?: CaiTurnCandidate[];
  create_time?: string;
}

export interface CaiChat {
  chat_id?: string;
  character_id?: string;
  character_name?: string;
  memory?: string;
  turns?: CaiTurn[];
  create_time?: string;
}

export interface CaiCharacterData {
  external_id?: string;
  name?: string;
  title?: string;
  description?: string;
  definition?: string;
  greeting?: string;
  avatar_file_name?: string;
  categories?: string[];
}

export interface CaiCharacterEntry {
  character: CaiCharacterData;
  avatar?: string;
  chats?: CaiChat[];
}

export interface CaiExport {
  format?: string;
  version?: number;
  exportedAt?: string;
  source?: string;
  user?: CaiUser;
  personas?: CaiPersona[];
  characters?: CaiCharacterEntry[];
}

export interface ParsedConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ParsedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  characterExternalId?: string;
  personaId?: number;
  memory?: string;
  messages: ParsedConversationMessage[];
}

export interface ParsedCharacter {
  externalId: string;
  name: string;
  description: string;
  prompt: string;
  voiceText: string;
  voiceId: string;
  imageUrl: string;
  chats: ParsedConversation[];
}

export interface ParseResult {
  source: string;
  exportedAt: string;
  user: CaiUser | null;
  personas: CaiPersona[];
  characters: ParsedCharacter[];
  totalChats: number;
  totalMessages: number;
}

/**
 * Decodes a base64 Data URL and writes it to media directory
 */
export function saveBase64Avatar(dataUrl: string | undefined, mediaDir: string, prefix = "cai-avatar"): string | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;

  try {
    const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) return null;

    let ext = match[1].toLowerCase();
    if (ext === "jpeg") ext = "jpg";
    if (ext.includes("svg")) ext = "svg";

    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const filename = `${prefix}-${randomUUID()}.${ext}`;
    const filePath = path.join(mediaDir, filename);
    writeFileSync(filePath, buffer);

    return `/api/lu/media/${filename}`;
  } catch (err) {
    logger.warn({ err }, "Failed to decode and save base64 avatar");
    return null;
  }
}

/**
 * Parses Character.AI export JSON into normalized character and conversation models
 */
export function parseCaiExport(data: unknown, mediaDir: string): ParseResult {
  const exportData = (typeof data === "string" ? JSON.parse(data) : data) as CaiExport;

  const charactersList = Array.isArray(exportData.characters) ? exportData.characters : [];
  const parsedCharacters: ParsedCharacter[] = [];
  let totalChatsCount = 0;
  let totalMessagesCount = 0;

  for (const entry of charactersList) {
    const char = entry.character || {};
    const externalId = char.external_id || randomUUID();
    const name = (char.name || "Character").trim();

    // Descriptions in CAI can be short title + long description
    const descParts = [char.title, char.description].filter(Boolean).map((s) => String(s).trim());
    const description = descParts.length > 0 ? descParts.join(" — ") : "Imported from Character.AI";

    // System prompt from definition
    let prompt = (char.definition || "").trim();
    if (!prompt && char.description) {
      prompt = `Character description: ${char.description}`;
    }

    // Greeting message
    const voiceText = (char.greeting || `Hello, I am ${name}. Nice to meet you!`).trim();

    // Process Avatar
    let imageUrl = saveBase64Avatar(entry.avatar, mediaDir);
    if (!imageUrl) {
      imageUrl = "/api/lu/media/default-persona.svg";
    }

    // Process Chats
    const rawChats = Array.isArray(entry.chats) ? entry.chats : [];
    const parsedChats: ParsedConversation[] = [];

    for (const chat of rawChats) {
      const chatId = chat.chat_id || randomUUID();
      const createdAt = chat.create_time || new Date().toISOString();
      const messages: ParsedConversationMessage[] = [];

      const turns = Array.isArray(chat.turns) ? chat.turns : [];
      for (const turn of turns) {
        const turnId = turn.turn_key?.turn_id || randomUUID();
        const isHuman = turn.author?.is_human === true;
        const role = isHuman ? "user" : "assistant";

        // Candidate message text
        const candidate = Array.isArray(turn.candidates) && turn.candidates[0];
        const content = (candidate && candidate.text) ? candidate.text : "";
        if (!content.trim()) continue;

        messages.push({
          id: `${chatId}-${turnId}`,
          role,
          content,
          createdAt: turn.create_time || createdAt,
        });
      }

      // If there are messages, sort chronologically
      messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // If the character has a greeting and the first message is from user, optionally prepend greeting
      if (voiceText && messages.length > 0 && messages[0].role === "user") {
        messages.unshift({
          id: `${chatId}-greeting`,
          role: "assistant",
          content: voiceText,
          createdAt,
        });
      }

      totalMessagesCount += messages.length;
      totalChatsCount++;

      const lastMessage = messages[messages.length - 1];
      const updatedAt = lastMessage ? lastMessage.createdAt : createdAt;

      parsedChats.push({
        id: chatId,
        title: `${name} (${new Date(createdAt).toLocaleDateString()})`,
        createdAt,
        updatedAt,
        characterExternalId: externalId,
        memory: chat.memory || "",
        messages,
      });
    }

    parsedCharacters.push({
      externalId,
      name,
      description,
      prompt,
      voiceText,
      voiceId: "Alba",
      imageUrl,
      chats: parsedChats,
    });
  }

  return {
    source: exportData.source || "character.ai",
    exportedAt: exportData.exportedAt || new Date().toISOString(),
    user: exportData.user || null,
    personas: Array.isArray(exportData.personas) ? exportData.personas : [],
    characters: parsedCharacters,
    totalChats: totalChatsCount,
    totalMessages: totalMessagesCount,
  };
}
