const mongoose = require("mongoose");

// The unique index on answers (one row per question per attempt). Mongoose
// builds it when the app starts; this waits for that and says clearly in the
// log whether it worked. A failure (e.g. duplicate rows already in the
// database) never stops the server — answer saves still work without it.
const ANSWER_INDEX = "attemptanswers { attemptId, questionId, userId } (unique)";

async function checkAnswerIndex() {
  const AttemptAnswer = require("../models/AttemptAnswer");
  try {
    await AttemptAnswer.init();
    console.log(`Index ready: ${ANSWER_INDEX}`);
  } catch (err) {
    console.error(`INDEX ERROR: could not create ${ANSWER_INDEX}: ${err.message}`);
    try {
      const [dup] = await AttemptAnswer.aggregate([
        {
          $group: {
            _id: { a: "$attemptId", q: "$questionId", u: "$userId" },
            n: { $sum: 1 }
          }
        },
        { $match: { n: { $gt: 1 } } },
        { $count: "questions" }
      ]);
      console.error(
        `INDEX ERROR: ${dup?.questions || 0} question(s) have more than one answer row. ` +
        "Remove the extra rows, then restart the server to build the index."
      );
    } catch {
      /* the count is only extra help */
    }
    console.error("INDEX ERROR: the server keeps running; answer saves still work without this index.");
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

  await checkAnswerIndex();
};

module.exports = connectDB;
