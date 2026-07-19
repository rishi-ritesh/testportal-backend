// Bundle existing published set papers into Packages (Test Series) by type.
// Idempotent: re-running updates each package's membership in place.
//
// Usage:  node src/scripts/seedPackages.js

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");

const SetPaper = require("../models/SetPaper");
const Package = require("../models/Package");

// Package definitions — each matches a subset of set-paper titles.
const DEFS = [
  {
    name: "SSC CGL Tier-1 Sectional Mocks (2026)",
    type: "SSC CGL Tier 1",
    description: "Full-length SSC CGL Tier-1 mocks in the new 2026 sectional-timing pattern (15 min per section).",
    order: 1,
    match: (t) => /sectional mock/i.test(t)
  },
  {
    name: "SSC CGL Tier-1 Full Mocks",
    type: "SSC CGL Tier 1",
    description: "SSC CGL Tier-1 full mocks (single 60-minute timer).",
    order: 2,
    match: (t) => /^SSC CGL Tier-1 Mock Test/i.test(t)
  },
  {
    name: "English Practice",
    type: "English",
    description: "Topic-wise English practice sets.",
    order: 3,
    match: (t) => /english practice/i.test(t)
  }
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("✖ MONGO_URI is not set (check your .env).");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");

  const sets = await SetPaper.find({ isPublished: true, isActive: true }).select("title");

  for (const def of DEFS) {
    const matched = sets.filter((s) => def.match(s.title));

    if (matched.length === 0) {
      console.log(`· "${def.name}" — no matching sets, skipped.`);
      continue;
    }

    const pkg = await Package.findOneAndUpdate(
      { name: def.name },
      {
        $set: {
          type: def.type,
          description: def.description,
          order: def.order,
          setPapers: matched.map((s) => s._id),
          isPublished: true,
          isActive: true
        }
      },
      { new: true, upsert: true }
    );

    console.log(`✔ "${pkg.name}" [type: ${pkg.type}] — ${matched.length} mocks`);
    matched.forEach((s) => console.log(`    - ${s.title}`));
  }

  await mongoose.disconnect();
  console.log("\nDone.");
  process.exit(0);
}

run().catch(async (err) => {
  console.error("✖ Seed failed:", err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
