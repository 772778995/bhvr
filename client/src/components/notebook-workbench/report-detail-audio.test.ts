import assert from "node:assert/strict";
import test from "node:test";
import { getAudioPlayerKey } from "./report-detail-audio";

test("getAudioPlayerKey changes when switching to a different audio entry", () => {
  const first = getAudioPlayerKey({
    id: "entry-a",
    fileUrl: "/api/files/audio-a.mp3",
    updatedAt: "2026-04-10T04:00:00.000Z",
  });

  const second = getAudioPlayerKey({
    id: "entry-b",
    fileUrl: "/api/files/audio-b.mp3",
    updatedAt: "2026-04-10T04:01:00.000Z",
  });

  assert.notEqual(first, second);
});

test("getAudioPlayerKey changes when an audio entry gets a new fileUrl", () => {
  const first = getAudioPlayerKey({
    id: "entry-a",
    fileUrl: "/api/files/audio-a.mp3",
    updatedAt: "2026-04-10T04:00:00.000Z",
  });

  const second = getAudioPlayerKey({
    id: "entry-a",
    fileUrl: "/api/files/audio-b.mp3",
    updatedAt: "2026-04-10T04:00:00.000Z",
  });

  assert.notEqual(first, second);
});
