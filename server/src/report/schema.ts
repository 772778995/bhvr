import { z } from "zod";

export const ResearchReportSchema = z.object({
  id: z.string(),
  notebookId: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  generatedAt: z.date().nullable(),
  errorMessage: z.string().nullable(),
  updatedAt: z.date(),
});

export type ResearchReport = z.infer<typeof ResearchReportSchema>;
