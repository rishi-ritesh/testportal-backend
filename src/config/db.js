const mongoose = require("mongoose");

// Unique indexes the app relies on. Mongoose builds them when the app starts;
// this waits for that and says clearly in the log whether each one worked.
// A failure (e.g. duplicate documents already in the database) never stops
// the server — the app still works without the index.
const UNIQUE_INDEXES = [
  {
    model: "AttemptAnswer",
    label: "attemptanswers { attemptId, questionId, userId } (unique)",
    // one answer row per question per attempt
    group: { a: "$attemptId", q: "$questionId", u: "$userId" },
    what: "question(s) have more than one answer row",
    fix: "Remove the extra rows"
  },
  {
    model: "Attempt",
    label: "attempts { userId, testId, attemptType } (unique)",
    // one ranked and one practice attempt per student per test
    group: { u: "$userId", t: "$testId", k: "$attemptType" },
    what: "student/test pair(s) have more than one attempt of the same type",
    fix: "Resolve the extra attempts by hand (see the release notes)"
  }
];

async function checkUniqueIndex({ model, label, group, what, fix }) {
  const Model = require(`../models/${model}`);
  try {
    await Model.init();
    console.log(`Index ready: ${label}`);
  } catch (err) {
    console.error(`INDEX ERROR: could not create ${label}: ${err.message}`);
    try {
      const [dup] = await Model.aggregate([
        { $group: { _id: group, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $count: "found" }
      ]);
      console.error(
        `INDEX ERROR: ${dup?.found || 0} ${what}. ` +
        `${fix}, then restart the server to build the index.`
      );
    } catch {
      /* the count is only extra help */
    }
    console.error("INDEX ERROR: the server keeps running without this index.");
  }
}

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  for (const index of UNIQUE_INDEXES) {
    await checkUniqueIndex(index);
  }
};

module.exports = connectDB;
