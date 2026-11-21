// Backend/src/controllers/stats.controller.js
//
// Read-only numbers for the admin dashboard. Counts use the same filters as
// the admin list pages (active records only; students split into active and
// blocked).

const User = require("../models/User");
const Question = require("../models/Question");
const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const SetPaper = require("../models/SetPaper");
const Package = require("../models/Package");
const Attempt = require("../models/Attempt");

// "Today" is the calendar day in India (UTC+5:30), whatever the server's
// own time zone is.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayIndia(now = Date.now()) {
  const india = now + IST_OFFSET_MS;
  return new Date(india - (india % DAY_MS) - IST_OFFSET_MS);
}

// GET /api/admin/stats
exports.getStats = async (req, res) => {
  try {
    const now = Date.now();
    const today = startOfTodayIndia(now);
    const weekAgo = new Date(now - 7 * DAY_MS);

    // a completed attempt is not changed after it is submitted, so its
    // updatedAt is the time it was completed (as in My Attempts)
    const completedSince = (since) =>
      Attempt.countDocuments({ status: "completed", updatedAt: { $gte: since } });

    const [
      activeStudents,
      blockedStudents,
      questions,
      subjects,
      topics,
      sets,
      packages,
      completedToday,
      completedLast7Days
    ] = await Promise.all([
      User.countDocuments({ role: "student", isActive: { $ne: false } }),
      User.countDocuments({ role: "student", isActive: false }),
      Question.countDocuments({ isActive: true }),
      Subject.countDocuments({ isActive: true }),
      Topic.countDocuments({ isActive: true }),
      SetPaper.countDocuments({ isActive: true }),
      Package.countDocuments({ isActive: true }),
      completedSince(today),
      completedSince(weekAgo)
    ]);

    res.json({
      students: { active: activeStudents, blocked: blockedStudents },
      questions: { active: questions },
      subjects,
      topics,
      sets,
      packages,
      attemptsCompleted: { today: completedToday, last7Days: completedLast7Days },
      todayStartsAt: today.toISOString(),
      generatedAt: new Date(now).toISOString()
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
