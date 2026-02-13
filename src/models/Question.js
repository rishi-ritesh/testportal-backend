const mongoose = require("mongoose");

const OptionSchema = new mongoose.Schema(
  {
    key: { type: String, enum: ["a", "b", "c", "d"], required: true },
    text: {
      en: { type: String, required: true },
      hi: { type: String, required: true }
    }
  },
  { _id: false }
);

const QuestionSchema = new mongoose.Schema(
  {
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true
    },

    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topic",
      required: true
    },

    question: {
      en: { type: String, required: true },
      hi: { type: String, required: true }
    },

    options: {
      type: [OptionSchema],
      validate: v => v.length === 4
    },

    correctAnswer: {
      type: String,
      enum: ["a", "b", "c", "d"],
      required: true
    },

    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "easy"
    },

    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

/* 🔥 GLOBAL DUPLICATE PREVENTION */
QuestionSchema.index(
  { subjectId: 1, topicId: 1, "question.en": 1 },
  { unique: true }
);

module.exports = mongoose.model("Question", QuestionSchema);
