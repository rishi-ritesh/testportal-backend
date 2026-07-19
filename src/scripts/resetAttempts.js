// Dev-only helper: wipe attempt data so you can re-take the SAME test.
//
// It deletes documents from the `attempts` and `attemptanswers`
// collections ONLY. Your questions, subjects, topics, users and
// SetPapers are left untouched.
//
// Usage:
//   node src/scripts/resetAttempts.js                 # clears ALL attempts
//   node src/scripts/resetAttempts.js <testId>        # clears one test only
//   node src/scripts/resetAttempts.js --user <userId> # clears one user only
//
// (flags can be combined, e.g. `<testId> --user <userId>`)

require("dotenv").config();

const mongoose = require("mongoose");

const Attempt = require("../models/Attempt");
const AttemptAnswer = require("../models/AttemptAnswer");

const run = async () => {
  const args = process.argv.slice(2);

  // parse a positional testId and an optional --user <id>
  let testId = null;
  let userId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--user") {
      userId = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      testId = args[i];
    }
  }

  const filter = {};
  if (testId) filter.testId = testId;
  if (userId) filter.userId = userId;

  if (!process.env.MONGO_URI) {
    console.error("✖ MONGO_URI is not set (check your .env).");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");

  const scope =
    Object.keys(filter).length === 0
      ? "ALL attempts"
      : `filter ${JSON.stringify(filter)}`;

  // AttemptAnswers are keyed by attemptId, so when scoping by test/user
  // we first resolve the matching attempt ids.
  let answerFilter = {};

  if (Object.keys(filter).length > 0) {
    const attempts = await Attempt.find(filter).select("_id");
    const ids = attempts.map((a) => a._id);
    answerFilter = { attemptId: { $in: ids } };
  }

  const answersDeleted = await AttemptAnswer.deleteMany(answerFilter);
  const attemptsDeleted = await Attempt.deleteMany(filter);

  console.log(`✔ Reset ${scope}`);
  console.log(`  attempts deleted:       ${attemptsDeleted.deletedCount}`);
  console.log(`  attempt answers deleted: ${answersDeleted.deletedCount}`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("✖ Reset failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
