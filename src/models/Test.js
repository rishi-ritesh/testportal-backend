const mongoose = require("mongoose");

const TestQuestionSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true
    },

    positiveMarks: {
      type: Number,
      required: true
    },

    negativeMarks: {
      type: Number,
      required: true
    }
  },
  { _id: false }
);

const TestSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    description: String,

    durationMinutes: {
      type: Number,
      required: true
    },

    questions: {
      type: [TestQuestionSchema],
      validate: {
        validator: function (arr) {
          const ids = arr.map(q => q.questionId.toString());
          return ids.length === new Set(ids).size;
        },
        message: "Duplicate question detected inside mock"
      }
    },

    isPublished: {
      type: Boolean,
      default: false
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Test", TestSchema);
