const mongoose = require("mongoose");

const AttemptAnswerSchema = new mongoose.Schema({

    // Attempt Reference
    attemptId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Attempt",
        required: true
    },

    // Student Reference
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Question Reference
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
        required: true
    },

    // Sequential Number in Test
    questionNumber: {
        type: Number,
        required: true
    },

    // Section Context
    sectionId: {
        type: String,
        required: true
    },

    sectionName: {
        type: String,
        required: true
    },

    // Subject Context
    subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
        required: true
    },

    subjectName: {
        type: String,
        required: true
    },

    // Topic Context
    topicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Topic",
        required: true
    },

    topicName: {
        type: String,
        required: true
    },

    // Selected Option
    selectedOption: {
        type: String,
        default: null
    },

    // Current Status
    answerStatus: {
        type: String,
        enum: [
            "answered",
            "skipped",
            "marked_for_review",
            "not_visited"
        ],
        default: "not_visited"
    },

    // Independent "mark for review" flag.
    // A question can be BOTH answered and marked — marking no longer
    // prevents scoring (matches Testbook/Oliveboard behaviour).
    markedForReview: {
        type: Boolean,
        default: false
    },

    fromQuestionNumber: Number,

    toQuestionNumber: Number,

    saveType: {
        type: String,
        enum: [
            "save_and_next",
            "direct_navigation",
            "mark_for_review",
            "clear_response",
            "answer_select", // option tapped (saved straight away)
            "timer" // time-only save (heartbeat / tab hidden)
        ]
    },

    // Sequence number of the last save applied from the test screen; older
    // or repeated saves for this question are ignored.
    clientSeq: {
        type: Number,
        default: null
    },

    // Evaluation
    correctAnswer: {
        type: String,
        required: true
    },

    isCorrect: {
        type: Boolean,
        required: true
    },

    marksAwarded: {
        type: Number,
        default: 0
    },

    // Time spent on THIS question (seconds)
    timeSpent: {
        type: Number,
        default: 0
    }

}, { timestamps: true });

// One row per question per attempt — two simultaneous first saves can't
// create duplicates.
AttemptAnswerSchema.index(
    { attemptId: 1, questionId: 1, userId: 1 },
    { unique: true }
);

// The result page's per-question statistics of the ranking pool are read
// from this index alone (no answer documents are loaded): see utils/poolStats.
AttemptAnswerSchema.index(
    { attemptId: 1, questionId: 1, answerStatus: 1, isCorrect: 1, timeSpent: 1 }
);

module.exports = mongoose.model(
    "AttemptAnswer",
    AttemptAnswerSchema
);