// Backend/src/utils/poolStats.js
//
// Per-question statistics of a test's ranking pool (every completed ranked
// attempt): how many answered each question, how many were correct, and their
// times. The result page needs them for every view, and computing them reads
// one index entry per answer of every participant.
//
// A completed attempt's answers never change, so the same set of completed
// ranked attempts always gives the same statistics. They are kept in memory
// for a short time, keyed by EXACTLY that set of attempts and questions: when
// another student finishes, the set (and the key) changes and the statistics
// are computed afresh. Views of the same result at the same moment share one
// computation.

const crypto = require("crypto");

const AttemptAnswer = require("../models/AttemptAnswer");

const TTL_MS = 60 * 1000;
const LIMIT = 50;
const cache = new Map(); // key → { at, rows: Promise<rows> }

const keyOf = (attemptIds, questionIds) =>
  crypto
    .createHash("sha256")
    .update(attemptIds.map(String).sort().join(","))
    .update("|")
    .update(questionIds.map(String).sort().join(","))
    .digest("hex");

function compute(attemptIds, questionIds) {
  return AttemptAnswer.aggregate([
    {
      $match: {
        attemptId: { $in: attemptIds },
        questionId: { $in: questionIds },
        answerStatus: "answered"
      }
    },
    {
      $group: {
        _id: "$questionId",
        total: { $sum: 1 },
        correct: { $sum: { $cond: ["$isCorrect", 1, 0] } },
        times: { $push: "$timeSpent" }
      }
    }
  ]).exec();
}

// rows: [{ _id: questionId, total, correct, times: [...] }]
async function poolAnswerStats(attemptIds, questionIds) {
  const key = keyOf(attemptIds, questionIds);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.rows;

  const rows = compute(attemptIds, questionIds);
  cache.delete(key); // re-insert at the end (oldest first)
  cache.set(key, { at: now, rows });
  // never keep a failure (and only remove this computation's own entry)
  rows.catch(() => {
    if (cache.get(key)?.rows === rows) cache.delete(key);
  });

  // drop expired entries, then the oldest beyond the limit
  for (const [k, v] of cache) {
    if (now - v.at >= TTL_MS || cache.size > LIMIT) cache.delete(k);
    else break;
  }

  return rows;
}

module.exports = { poolAnswerStats };
