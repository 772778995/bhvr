import type { ResearchTask } from "@/api/client";

export const statusLabels: Record<ResearchTask["status"], string> = {
  pending: "排队中",
  generating_questions: "生成问题中",
  asking: "提问中",
  summarizing: "汇编报告中",
  done: "已完成",
  error: "出错",
};

export const statusColors: Record<ResearchTask["status"], string> = {
  pending: "bg-gray-100 text-gray-700",
  generating_questions: "bg-yellow-100 text-yellow-800",
  asking: "bg-blue-100 text-blue-800",
  summarizing: "bg-purple-100 text-purple-800",
  done: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};
