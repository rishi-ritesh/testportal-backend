const mongoose = require("mongoose");

const Bookmark = require("../models/Bookmark");
const Question = require("../models/Question");
const CustomSet = require("../models/CustomSet");

// Toggle a bookmark on/off for the current user. Idempotent — safe to call
// repeatedly; returns the resulting state.
exports.toggleBookmark = async (req, res) => {
  try {
    const { questionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ message: "Invalid question id" });
    }

    const exists = await Question.exists({ _id: questionId, isActive: true });
    if (!exists) {
      return res.status(404).json({ message: "Question not found" });
    }

    const existing = await Bookmark.findOne({
      userId: req.user.id,
      questionId
    });

    if (existing) {
      // Bookmark lock: a question that's in the student's custom practice set
      // can't be unbookmarked until it's removed from the set.
      const inSet = await CustomSet.exists({
        userId: req.user.id,
        questionIds: questionId
      });
      if (inSet) {
        return res.status(409).json({
          code: "IN_CUSTOM_SET",
          bookmarked: true,
          message:
            "This question is in your custom practice set. Remove it from the set first."
        });
      }

      await Bookmark.deleteOne({ _id: existing._id });
      return res.json({ bookmarked: false });
    }

    await Bookmark.create({ userId: req.user.id, questionId });
    res.json({ bookmarked: true });
  } catch (err) {
    // race: another request created it first — treat as bookmarked
    if (err.code === 11000) return res.json({ bookmarked: true });
    res.status(500).json({ message: err.message });
  }
};

// Just the ids the user has bookmarked — cheap, used to seed the ★ state in the
// solutions view.
exports.getBookmarkIds = async (req, res) => {
  try {
    const rows = await Bookmark.find({ userId: req.user.id }).select("questionId");
    res.json(rows.map((r) => String(r.questionId)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Full saved questions (content included) for the Bookmarks page. Inactive /
// deleted questions are dropped. Bilingual fields are mapped to english/hindi
// to match how the rest of the student UI renders them.
exports.getBookmarks = async (req, res) => {
  try {
    const rows = await Bookmark.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .populate({
        path: "questionId",
        populate: [
          { path: "subjectId", select: "name" },
          { path: "topicId", select: "name" }
        ]
      });

    const customSet = await CustomSet.findOne({ userId: req.user.id }).select("questionIds");
    const inSet = new Set((customSet?.questionIds || []).map(String));

    const data = rows
      .filter((r) => r.questionId && r.questionId.isActive)
      .map((r) => {
        const q = r.questionId;
        return {
          questionId: q._id,
          questionCode: q.questionCode,
          subjectName: q.subjectId?.name || "",
          topicName: q.topicId?.name || "",
          questionText: {
            english: q.question?.en || "",
            hindi: q.question?.hi || ""
          },
          options: (q.options || []).map((o) => ({
            key: o.key,
            text: {
              english: o.text?.en || "",
              hindi: o.text?.hi || ""
            }
          })),
          correctAnswer: q.correctAnswer,
          explanation: {
            english: q.explanation?.en || "",
            hindi: q.explanation?.hi || ""
          },
          bookmarkedAt: r.createdAt,
          inCustomSet: inSet.has(String(q._id))
        };
      });

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
