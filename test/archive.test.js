import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadArchive } from "../src/ingest/archive.js";
import { scoringFixture } from "./helpers.js";

test("archive ingestion defaults to Division C only", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scioly-rating-"));
  try {
    fs.writeFileSync(path.join(directory, "division-b.yaml"), scoringFixture({ division: "B" }));
    fs.writeFileSync(path.join(directory, "division-c.yaml"), scoringFixture({ division: "C" }));

    const { tournaments, errors } = loadArchive(directory);

    assert.deepEqual(errors, []);
    assert.equal(tournaments.length, 1);
    assert.equal(tournaments[0].division, "C");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
