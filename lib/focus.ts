import { z } from "zod";

export const SPECIES = [
  {
    id: "oak",
    name: "Quiet oak",
    cost: 0,
    color: "#52775a",
    description: "A familiar place to begin.",
  },
  {
    id: "cherry",
    name: "Cherry blossom",
    cost: 30,
    color: "#cc8e9f",
    description: "A little color for your next chapter.",
  },
  {
    id: "pine",
    name: "Mountain pine",
    cost: 60,
    color: "#426f6e",
    description: "Steady growth, at your pace.",
  },
] as const;
const species = z.enum(["oak", "cherry", "pine"]);
const stamp = z.number().finite().nonnegative();
const session = z
  .object({
    id: z.string().uuid(),
    task: z.string().max(120),
    kind: z.enum(["focus", "break"]),
    species,
    targetMinutes: z
      .number()
      .int()
      .min(5)
      .max(120)
      .refine((n) => n % 5 === 0),
    startedAt: stamp,
    updatedAt: stamp,
    elapsedMs: stamp.max(7_200_000),
    status: z.enum(["running", "paused"]),
  })
  .strict();
export const focusSchema = z
  .object({
    version: z.literal(1),
    coins: z.number().int().nonnegative(),
    unlocked: z.array(species).min(1).max(3),
    selected: species,
    reducedMotion: z.boolean(),
    active: session.nullable(),
    history: z
      .array(
        session
          .omit({ updatedAt: true, status: true })
          .extend({
            endedAt: stamp,
            outcome: z.enum(["completed", "ended"]),
            coins: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      !s.unlocked.includes(s.selected) ||
      new Set(s.unlocked).size !== s.unlocked.length ||
      new Set(s.history.map((h) => h.id)).size !== s.history.length ||
      (s.active &&
        (!s.unlocked.includes(s.active.species) ||
          s.history.some((h) => h.id === s.active?.id)))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid focus history or species selection.",
      });
    }
  });
export type FocusState = z.infer<typeof focusSchema>;
export type FocusSession = NonNullable<FocusState["active"]>;
export const emptyFocus = (): FocusState => ({
  version: 1,
  coins: 0,
  unlocked: ["oak"],
  selected: "oak",
  reducedMotion: false,
  active: null,
  history: [],
});
export const focusCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      id: z.string().uuid(),
      minutes: z
        .number()
        .int()
        .min(5)
        .max(120)
        .refine((n) => n % 5 === 0),
      task: z.string().trim().max(120),
      kind: z.enum(["focus", "break"]),
    })
    .strict(),
  ...((["pause", "resume", "finish"] as const).map((type) =>
    z.object({ type: z.literal(type), id: z.string().uuid() }).strict(),
  ) as [
    z.ZodObject<{ type: z.ZodLiteral<"pause">; id: z.ZodString }>,
    z.ZodObject<{ type: z.ZodLiteral<"resume">; id: z.ZodString }>,
    z.ZodObject<{ type: z.ZodLiteral<"finish">; id: z.ZodString }>,
  ]),
  z.object({ type: z.literal("species"), species }).strict(),
  z.object({ type: z.literal("motion"), value: z.boolean() }).strict(),
]);

function finish(
  state: FocusState,
  now: number,
  outcome: "completed" | "ended",
): FocusState {
  const active = state.active;
  if (!active) return state;
  if (state.history.length >= 10000)
    throw new Error(
      "Your focus journal is full. Export a backup before starting more sessions.",
    );
  const { updatedAt: _updated, status: _status, ...record } = active;
  const coins =
    active.kind === "focus" ? Math.floor(active.elapsedMs / 60_000) : 0;
  return {
    ...state,
    active: null,
    coins: state.coins + coins,
    history: [...state.history, { ...record, endedAt: now, outcome, coins }],
  };
}

// Long gaps (sleep, closed app, or a clock change) pause at the last durable checkpoint.
export function reconcileFocus(state: FocusState, now: number): FocusState {
  const active = state.active;
  if (!active || active.status === "paused") return state;
  const delta = now - active.updatedAt;
  if (delta < 0 || delta > 20000)
    return {
      ...state,
      active: { ...active, status: "paused", updatedAt: now },
    };
  const elapsedMs = Math.min(
    active.targetMinutes * 60_000,
    active.elapsedMs + delta,
  );
  const next = { ...state, active: { ...active, elapsedMs, updatedAt: now } };
  return elapsedMs >= active.targetMinutes * 60_000
    ? finish(next, now, "completed")
    : next;
}

export function applyFocusCommand(
  state: FocusState,
  input: unknown,
  now: number,
): FocusState {
  const command = focusCommandSchema.parse(input);
  const current = reconcileFocus(state, now);
  if (command.type === "start") {
    if (
      current.active?.id === command.id ||
      current.history.some((h) => h.id === command.id)
    )
      return current;
    if (current.active)
      throw new Error("Finish the current session before starting another.");
    if (current.history.length >= 10000)
      throw new Error(
        "Your focus journal is full. Export a backup before starting more sessions.",
      );
    return {
      ...current,
      active: {
        id: command.id,
        task: command.task,
        kind: command.kind,
        species: current.selected,
        targetMinutes: command.minutes,
        startedAt: now,
        updatedAt: now,
        elapsedMs: 0,
        status: "running",
      },
    };
  }
  if (command.type === "motion")
    return { ...current, reducedMotion: command.value };
  if (command.type === "species") {
    if (current.active)
      throw new Error("Choose your next tree after this session.");
    const tree = SPECIES.find((s) => s.id === command.species)!;
    if (current.unlocked.includes(tree.id))
      return { ...current, selected: tree.id };
    if (current.coins < tree.cost)
      throw new Error(
        "Keep growing at your own pace. You need more leaves to unlock this tree.",
      );
    return {
      ...current,
      selected: tree.id,
      coins: current.coins - tree.cost,
      unlocked: [...current.unlocked, tree.id],
    };
  }
  if (!current.active) {
    if (current.history.some((h) => h.id === command.id)) return current;
    throw new Error("This session is no longer active.");
  }
  if (current.active.id !== command.id)
    throw new Error("The session changed. Refresh before trying again.");
  if (command.type === "finish") return finish(current, now, "ended");
  return {
    ...current,
    active: {
      ...current.active,
      status: command.type === "pause" ? "paused" : "running",
      updatedAt: now,
    },
  };
}
