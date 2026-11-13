import { z } from "zod";
import { guideSchema, sourceSchema } from "./study";

export const learningLevel = z.enum(["foundation", "explain", "apply"]);
export const agentBriefSchema = z
  .object({
    topic: z.string().trim().min(2).max(160),
    goal: z.string().trim().min(10).max(1200),
    level: learningLevel,
    sourceMode: z.enum(["research", "workspace"]),
    personalize: z.boolean(),
  })
  .strict();
export const agentEventSchema = z
  .object({
    at: z.string().datetime(),
    role: z.string().max(60),
    message: z.string().max(500),
  })
  .strict();
export const agentTaskSchema = z
  .object({
    id: z.string().uuid(),
    rootId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    brief: agentBriefSchema,
    status: z.enum([
      "queued",
      "researching",
      "writing",
      "reviewing",
      "ready",
      "accepted",
      "failed",
      "cancelled",
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    sources: z.array(sourceSchema).max(10),
    proposal: guideSchema.nullable(),
    proposalHash: z.string().max(64),
    events: z.array(agentEventSchema).max(40),
    error: z.string().max(800),
    model: z.string().max(200),
    questionHashes: z.record(z.string().max(300), z.string().length(64)),
    acceptedRevision: z.number().int().nonnegative().nullable(),
    adaptation: z.string().max(1000),
  })
  .strict();
export const agentStoreSchema = z
  .object({ version: z.literal(1), tasks: z.array(agentTaskSchema).max(80) })
  .strict();
export const agentCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      id: z.string().uuid(),
      brief: agentBriefSchema,
    })
    .strict(),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("retry"), id: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("accept"),
      id: z.string().uuid(),
      proposalHash: z.string().length(64),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("continue"),
      id: z.string().uuid(),
      newId: z.string().uuid(),
      level: z.enum(["auto", "foundation", "explain", "apply"]),
    })
    .strict(),
]);
export type AgentBrief = z.infer<typeof agentBriefSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type LearningLevel = z.infer<typeof learningLevel>;
export type AgentProgress = {
  total: number;
  attempted: number;
  independentCorrect: number;
  assisted: number;
  incorrect: number;
  level: LearningLevel;
  reason: string;
  readyForNext: boolean;
};
export type AgentTaskView = AgentTask & { progress: AgentProgress };
export type AgentSnapshot = {
  enabled: boolean;
  revision: number;
  tasks: AgentTaskView[];
  model: {
    connected: boolean;
    ready: boolean;
    model: string;
    models: { name: string; size: number }[];
  };
  active: boolean;
};
