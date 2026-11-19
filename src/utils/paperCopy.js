// Backend/src/utils/paperCopy.js
//
// Attempts used to embed a full copy of the paper (Attempt.testSnapshot).
// New attempts store the copy once in PaperCopy and point to it
// (Attempt.paperCopyId). Every reader goes through paperOf(attempt), which
// works for BOTH kinds — old attempts are never migrated or changed.

const crypto = require("crypto");
const mongoose = require("mongoose");

const PaperCopy = require("../models/PaperCopy");

// sha256 of the copy's content. The sections are built in a fixed order and
// with fixed keys, so the same paper always gives the same fingerprint; any
// edit (wording, options, order, subject/topic) gives a new one.
function fingerprintOf(sections) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sections))
    .digest("hex");
}

// Store this paper copy once (or find the identical one already stored) and
// return its id.
async function storePaperCopy(testId, sections) {
  const fingerprint = fingerprintOf(sections);
  const filter = { testId, fingerprint };

  try {
    const copy = await PaperCopy.findOneAndUpdate(
      filter,
      { $setOnInsert: { testId, fingerprint, sections } },
      { upsert: true, new: true, projection: { _id: 1 } }
    );
    return copy._id;
  } catch (err) {
    // two attempts stored the same new copy at the same moment → use it
    if (err.code !== 11000) throw err;
    const copy = await PaperCopy.findOne(filter).select("_id");
    return copy._id;
  }
}

// Copies never change, so recently used ones are kept in memory.
const CACHE_LIMIT = 100;
const cache = new Map(); // paperCopyId → { sections }

async function loadCopy(id) {
  const key = String(id);
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key); // keep most-recently-used last
    cache.set(key, hit);
    return hit;
  }
  const doc = await PaperCopy.findById(id).select("sections").lean();
  const paper = { sections: doc?.sections || [] };
  if (doc) {
    cache.set(key, paper);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  return paper;
}

// The paper an attempt was given: { sections: [...] }.
//   new attempts → the shared PaperCopy
//   old attempts → their own embedded testSnapshot (unchanged)
async function paperOf(attempt) {
  if (attempt?.paperCopyId) return loadCopy(attempt.paperCopyId);
  return { sections: attempt?.testSnapshot?.sections || [] };
}

// Question count per PaperCopy id (for lists), without loading the papers.
async function questionCounts(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await PaperCopy.aggregate([
    { $match: { _id: { $in: unique.map((id) => new mongoose.Types.ObjectId(id)) } } },
    {
      $project: {
        n: {
          $sum: {
            $map: { input: "$sections", as: "s", in: { $size: "$$s.questions" } }
          }
        }
      }
    }
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

module.exports = { fingerprintOf, storePaperCopy, paperOf, questionCounts };
