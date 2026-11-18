const mongoose = require("mongoose");

// =====================================================================
// CUSTOM PRACTICE SET
// =====================================================================
// A student's own practice set, built from their bookmarks. Completely
// separate from admin tests (SetPaper) and attempts (Attempt): no marks, no
// rank, nothing visible in the admin panel.
//
// Rules:
//  - exactly ONE set per student (unique userId)
//  - 25..100 questions, only from the student's own bookmarks
//  - one timer for the whole set: secondsPerQuestion x number of questions
//  - set is locked (no add/remove/clear/timer change) while a run is
//    in progress or paused
//  - starting again replaces the previous run (result); clearing the set
//    deletes the run too
// =====================================================================

const LIMITS = Object.freeze({
  MIN_QUESTIONS: 25,
  MAX_QUESTIONS: 100,
  DEFAULT_SECONDS_PER_QUESTION: 36,
  MIN_SECONDS_PER_QUESTION: 10,
  MAX_SECONDS_PER_QUESTION: 180
});

// Copy of a question taken when the run starts, so an admin edit in the
// middle of a test can't change what the student is looking at. Options are
// shuffled and relabelled A, B, C… for this run; correctKey is the correct
// option's label AFTER shuffling. correctKey/explanation are never sent to
// the browser until the run is submitted.
const runQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    questionNumber: Number,
    question: { english: String, hindi: String },
    options: [
      {
        _id: false,
        key: String,
        text: { english: String, hindi: String }
      }
    ],
    correctKey: String,
    explanation: { english: String, hindi: String },
    subjectName: String,
    topicName: String
  },
  { _id: false }
);

// What the student did on each question in this run.
//  visited = the question was opened at least once (Skipped vs Unseen)
const runAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOption: { type: String, default: null },
    markedForReview: { type: Boolean, default: false },
    timeSpent: { type: Number, default: 0 }, // seconds, summed across visits
    visited: { type: Boolean, default: false }
  },
  { _id: false }
);

const runSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["in_progress", "paused", "submitted"],
      default: "in_progress"
    },
    secondsPerQuestion: Number,
    totalSeconds: Number,
    remainingSeconds: Number,
    startedAt: Date,
    pausedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    autoSubmitted: { type: Boolean, default: false },
    currentQuestionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    questions: [runQuestionSchema],
    answers: [runAnswerSchema]
  },
  { _id: false }
);

const customSetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true // one set per student
    },

    // the set itself, in the order the student added the questions
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],

    secondsPerQuestion: {
      type: Number,
      default: LIMITS.DEFAULT_SECONDS_PER_QUESTION,
      min: LIMITS.MIN_SECONDS_PER_QUESTION,
      max: LIMITS.MAX_SECONDS_PER_QUESTION
    },

    // the current/last test taken on this set (null = never started or cleared)
    run: { type: runSchema, default: null }
  },
  { timestamps: true }
);

// true while a test is running or paused → set can't be edited
customSetSchema.methods.isLocked = function () {
  return Boolean(this.run && this.run.status !== "submitted");
};

const CustomSet = mongoose.model("CustomSet", customSetSchema);
CustomSet.LIMITS = LIMITS;

module.exports = CustomSet;
