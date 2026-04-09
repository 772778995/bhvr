import { Hono } from "hono";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import db from "../../db/index.js";
import { summaryPresets } from "../../db/schema.js";

const presets = new Hono();

const READONLY_BUILTIN_ID = "builtin-research-report";

const createPresetSchema = z.object({
  name: z.string().min(1).max(20),
  description: z.string().max(50).optional(),
  prompt: z.string().min(1),
});

const updatePresetSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  description: z.string().max(50).optional(),
  prompt: z.string().min(1).optional(),
});

// GET /api/presets — list all presets ordered by creation time
presets.get("/", async (c) => {
  const all = await db.query.summaryPresets.findMany({
    orderBy: [asc(summaryPresets.createdAt)],
  });
  return c.json(all);
});

// GET /api/presets/:id — get single preset (for editor preview)
presets.get("/:id", async (c) => {
  const { id } = c.req.param();
  const preset = await db.query.summaryPresets.findFirst({
    where: eq(summaryPresets.id, id),
  });
  if (!preset) return c.json({ error: "Preset not found" }, 404);
  return c.json(preset);
});

// POST /api/presets — create a new user preset
presets.post("/", async (c) => {
  let body: z.infer<typeof createPresetSchema>;
  try {
    body = createPresetSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "Invalid request body", details: err }, 400);
  }

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(summaryPresets).values({
    id,
    name: body.name,
    description: body.description ?? null,
    prompt: body.prompt,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.summaryPresets.findFirst({
    where: eq(summaryPresets.id, id),
  });
  return c.json(created, 201);
});

// PUT /api/presets/:id — update a preset
// builtin-research-report is read-only; other built-ins allow editing name/description/prompt
presets.put("/:id", async (c) => {
  const { id } = c.req.param();

  if (id === READONLY_BUILTIN_ID) {
    return c.json({ error: "This built-in preset cannot be edited" }, 403);
  }

  const preset = await db.query.summaryPresets.findFirst({
    where: eq(summaryPresets.id, id),
  });
  if (!preset) return c.json({ error: "Preset not found" }, 404);

  let body: z.infer<typeof updatePresetSchema>;
  try {
    body = updatePresetSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "Invalid request body", details: err }, 400);
  }

  const updates: Partial<typeof preset> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.prompt !== undefined) updates.prompt = body.prompt;

  await db.update(summaryPresets).set(updates).where(eq(summaryPresets.id, id));

  const updated = await db.query.summaryPresets.findFirst({
    where: eq(summaryPresets.id, id),
  });
  return c.json(updated);
});

// DELETE /api/presets/:id — delete a user preset (built-ins are protected)
presets.delete("/:id", async (c) => {
  const { id } = c.req.param();

  const preset = await db.query.summaryPresets.findFirst({
    where: eq(summaryPresets.id, id),
  });
  if (!preset) return c.json({ error: "Preset not found" }, 404);

  if (preset.isBuiltin) {
    return c.json({ error: "Built-in presets cannot be deleted" }, 403);
  }

  await db.delete(summaryPresets).where(eq(summaryPresets.id, id));
  return c.json({ message: "Preset deleted" });
});

export default presets;
