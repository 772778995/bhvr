export type SourceIconToken =
  | "globe"
  | "file-text"
  | "text"
  | "youtube"
  | "drive"
  | "image"
  | "file";

export function iconForSourceType(type: string): SourceIconToken {
  switch (type) {
    case "web":
      return "globe";
    case "pdf":
      return "file-text";
    case "text":
      return "text";
    case "youtube":
      return "youtube";
    case "drive":
      return "drive";
    case "image":
      return "image";
    default:
      return "file";
  }
}
