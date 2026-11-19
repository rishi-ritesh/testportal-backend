const mongoose = require("mongoose");

const AttemptSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    testId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SetPaper",
        required: true
    },

    // Role of this attempt for THIS user on THIS test:
    //  - "ranked"   : the first attempt; the only one counted for ranking.
    //  - "practice" : unranked retake, used for improvement analysis.
    //                 Only ONE practice attempt exists at a time; starting
    //                 a new one overwrites the previous practice attempt.
    attemptType: {
        type: String,
        enum: ["ranked", "practice"],
        default: "ranked"
    },

    status: {
        type: String,
        enum: ["in_progress", "paused", "completed"],
        default: "in_progress"
    },

    startedAt: Date,
    lastActiveAt: Date,

    // ===== Section timer (client-driven, server-persisted) =====
    // Remaining seconds for the CURRENT section. The clock only advances while
    // the student is actively on the test screen; the client periodically saves
    // this value (and on tab close), so a refresh / power cut / accident resumes
    // from here with no time lost while away. Null = untimed section.
    // This is a PRACTICE product, so the timer is a helper, not a hard gate.
    sectionRemainingSeconds: {
        type: Number,
        default: null
    },

    // Set while the attempt is explicitly paused; drives the paused overlay.
    pausedAt: {
        type: Date,
        default: null
    },

    // The test screen that currently owns this attempt (one open screen at a
    // time). sessionSeenAt = its last heartbeat; null once the tab closed.
    sessionId: {
        type: String,
        default: null
    },

    sessionSeenAt: {
        type: Date,
        default: null
    },

    currentSectionIndex: {
        type: Number,
        default: 0
    },

    testSnapshot: {
        sections: [
            {
                sectionId: String,
                sectionName: String,
                questions: [
                    {
                        questionId: mongoose.Schema.Types.ObjectId,

                        question: {
                            english: String,
                            hindi: String
                        },

                        options: [
                            {
                                key: String,

                                text: {
                                    english: String,
                                    hindi: String
                                }
                            }
                        ],

                        subjectId: mongoose.Schema.Types.ObjectId,
                        subjectName: String,

                        topicId: mongoose.Schema.Types.ObjectId,
                        topicName: String,

                        questionNumber: Number,
                        sectionQuestionNumber: Number
                    }
                ]
            }
        ]
    },

    totalTimeSpent: {
        type: Number,
        default: 0
    },

    currentQuestionId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },

    // Final Calculated Result
    finalScore: {
        type: Number,
        default: 0
    },

    correctCount: {
        type: Number,
        default: 0
    },

    wrongCount: {
        type: Number,
        default: 0
    },

    attemptedCount: {
        type: Number,
        default: 0
    },

    accuracy: {
        type: Number,
        default: 0
    },

    rank: {
        type: Number,
        default: null
    },

    percentile: {
        type: Number,
        default: null
    },

    resultGenerated: {
        type: Boolean,
        default: false
    },

    submittedSections: [
        {
            sectionIndex: Number,

            submittedAt: Date
        }
    ]

}, { timestamps: true });

// At most one ranked and one practice attempt per student per test — two
// Start taps at the same moment (two tabs / devices) can't create two.
AttemptSchema.index(
    { userId: 1, testId: 1, attemptType: 1 },
    { unique: true }
);

module.exports = mongoose.model("Attempt", AttemptSchema);