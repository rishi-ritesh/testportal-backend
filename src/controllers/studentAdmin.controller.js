const mongoose = require("mongoose");

const User = require("../models/User");
const Attempt = require("../models/Attempt");
const AttemptAnswer = require("../models/AttemptAnswer");
const Bookmark = require("../models/Bookmark");

// List all students with a quick activity count. Admin-only (guarded by the
// route's auth + role middleware).
exports.getStudents = async (req, res) => {
  try {
    const students = await User.find({ role: "student" })
      .select("name email isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const ids = students.map((s) => s._id);

    const counts = await Attempt.aggregate([
      { $match: { userId: { $in: ids } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } }
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const data = students.map((s) => ({
      _id: s._id,
      name: s.name,
      email: s.email,
      // legacy users without the field are treated as active
      isActive: s.isActive !== false,
      createdAt: s.createdAt,
      attemptCount: countMap.get(String(s._id)) || 0
    }));

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Block / unblock a student (toggles isActive). Blocked students can't log in.
exports.toggleStudentActive = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    const student = await User.findOne({ _id: id, role: "student" });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // undefined (legacy) counts as active → toggling blocks them
    student.isActive = student.isActive === false;
    await student.save();

    res.json({
      isActive: student.isActive,
      message: student.isActive ? "Student unblocked" : "Student blocked"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Permanently delete a student and their data (attempts, answers, bookmarks).
exports.deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    const student = await User.findOne({ _id: id, role: "student" });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    await AttemptAnswer.deleteMany({ userId: id });
    await Attempt.deleteMany({ userId: id });
    await Bookmark.deleteMany({ userId: id });
    await User.deleteOne({ _id: id });

    res.json({ message: "Student and their data deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
