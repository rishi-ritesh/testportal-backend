// Reverse seedSscCglSectionalSets.js using its manifest.
// Deletes exactly the question + set documents that were created
// (English questions were reused, not created, so they are untouched).
//
// Usage:  node src/scripts/undoSscCglSectionalSets.js

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Question = require("../models/Question");
const SetPaper = require("../models/SetPaper");

const MANIFEST = path.join(__dirname, "sscCglSeed.manifest.json");

async function run() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`✖ Manifest not found: ${MANIFEST}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");

  const setsDeleted = await SetPaper.deleteMany({
    _id: { $in: manifest.setIds }
  });
  const questionsDeleted = await Question.deleteMany({
    _id: { $in: manifest.questionIds }
  });

  console.log(`✔ Deleted ${setsDeleted.deletedCount} sets and ${questionsDeleted.deletedCount} questions.`);

  // remove the manifest so a fresh seed starts clean
  fs.unlinkSync(MANIFEST);
  console.log("✔ Manifest removed.");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("✖ Undo failed:", err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
