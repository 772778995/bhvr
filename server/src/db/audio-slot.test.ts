import assert from "node:assert/strict";
import test from "node:test";
import {
  replaceAudioArtifactEntry,
  getEntryByArtifactId,
  listEntriesByNotebookId,
  insertArtifactEntry,
} from "./report-entries.js";

test("replaceAudioArtifactEntry reuses existing audio slot instead of creating multiple audio history rows", async () => {
  const notebookId = crypto.randomUUID();
  const oldArtifactId = crypto.randomUUID();
  const newArtifactId = crypto.randomUUID();

  await insertArtifactEntry({
    notebookId,
    artifactId: oldArtifactId,
    artifactType: "audio",
    state: "ready",
    title: "old audio",
  });

  await replaceAudioArtifactEntry({
    notebookId,
    artifactId: newArtifactId,
  });

  const entries = await listEntriesByNotebookId(notebookId);
  const audioEntries = entries.filter((entry) => entry.artifactType === "audio");

  assert.equal(audioEntries.length, 1);
  assert.equal(audioEntries[0]?.artifactId, newArtifactId);
  assert.equal(audioEntries[0]?.state, "creating");
  assert.equal(audioEntries[0]?.title, null);
  assert.equal(audioEntries[0]?.filePath, null);
  assert.equal(audioEntries[0]?.contentJson, null);

  const old = await getEntryByArtifactId(oldArtifactId);
  assert.equal(old, null);
});
