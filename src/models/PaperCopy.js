const mongoose = require("mongoose");

// =====================================================================
// PAPER COPY
// =====================================================================
// One stored copy of a test paper (every question and option, in English and
// Hindi, in the order the student sees them). New attempts point to a copy
// instead of carrying their own ~70–150 KB embedded copy.
//
// A copy is identified by the test plus a fingerprint (hash) of its content.
// If the admin edits the test, the fingerprint changes and a new copy is
// stored, so attempts made earlier keep exactly the questions they were given.
// Copies are never edited or deleted by the app.
//
// The shape of `sections` is the same as Attempt.testSnapshot.sections (the
// old embedded copy), so both are read the same way.
// =====================================================================

const paperCopySchema = new mongoose.Schema(
    {
        testId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SetPaper",
            required: true
        },

        // sha256 of the copy's content (see utils/paperCopy.js)
        fingerprint: {
            type: String,
            required: true
        },

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
    { timestamps: true }
);

// one copy per test per content version
paperCopySchema.index({ testId: 1, fingerprint: 1 }, { unique: true });

module.exports = mongoose.model("PaperCopy", paperCopySchema);
