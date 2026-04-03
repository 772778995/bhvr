import { z } from "zod";

export const ResearchReportSchema = z.object({
  notebookId: z.string(),
  content: z.string().nullable(),
  generatedAt: z.date().nullable(),
  errorMessage: z.string().nullable(),
  updatedAt: z.date(),
});

export type ResearchReport = z.infer<typeof ResearchReportSchema>;
