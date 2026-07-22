const mongoose = require("mongoose");

// A per-user saved question for later revision. Keyed on the real Question in
// the bank (not an attempt snapshot), so a question bookmarked from any attempt
// is viewable anytime and survives across attempts.
const BookmarkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true
    }
  },
  { timestamps: true }
);

// one bookmark per (user, question) — makes toggling safe and idempotent
BookmarkSchema.index({ userId: 1, questionId: 1 }, { unique: true });

module.exports = mongoose.model("Bookmark", BookmarkSchema);
