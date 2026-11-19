// Backend/src/utils/attemptStatus.js
//
// READ-ONLY: for one student, where they are on each mock (SetPaper), so the
// student pages can show Start / Resume / View Result / Re-attempt.
// Nothing here changes how attempts are started, resumed or replaced — that
// stays in attempt.controller.js (startAttempt / getNextAttemptInfo).
//
// For each test id:
//   status:   "not_started" | "in_progress" | "completed"
//   ranked:   { attemptId, status } | null   — the first (ranked) attempt
//   practice: { attemptId, status } | null   — the latest practice attempt
// (attempt status is the stored one: "in_progress", "paused" or "completed")

const Attempt = require("../models/Attempt");

async function attemptStatusByTest(userId, testIds) {
  const byTest = new Map();
  if (!userId || !testIds.length) return byTest;

  const attempts = await Attempt.find({
    userId,
    testId: { $in: testIds }
  })
    .select("testId attemptType status updatedAt")
    .sort({ updatedAt: -1 }) // newest first → the first one seen is the latest
    .lean();

  for (const a of attempts) {
    const key = String(a.testId);
    const entry = byTest.get(key) || { ranked: null, practice: null };
    const slot = a.attemptType === "practice" ? "practice" : "ranked";
    if (!entry[slot]) entry[slot] = { attemptId: a._id, status: a.status };
    byTest.set(key, entry);
  }

  return byTest;
}

// The summary for one test, from the map above.
function attemptSummary(byTest, testId) {
  const { ranked = null, practice = null } = byTest.get(String(testId)) || {};
  const open = [ranked, practice].find((a) => a && a.status !== "completed");

  let status = "not_started";
  if (open) status = "in_progress";
  else if (ranked || practice) status = "completed";

  return { status, ranked, practice };
}

module.exports = { attemptStatusByTest, attemptSummary };
