export interface AudioPlayerIdentity {
  id?: string | null;
  fileUrl?: string | null;
  updatedAt?: string | null;
}

export function getAudioPlayerKey(identity: AudioPlayerIdentity): string {
  return [identity.id ?? "", identity.fileUrl ?? "", identity.updatedAt ?? ""].join("::");
}
