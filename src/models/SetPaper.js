const mongoose = require("mongoose");

const questionRefSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true
  }
}, { _id: false });

const subjectSchema = new mongoose.Schema({
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Subject",
    required: true
  },
  maxQuestions: {
    type: Number,
    required: true
  },
  questions: [questionRefSchema]
}, { _id: false });

const sectionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  duration: {
    type: Number, // minutes
    required: true
  },
  positiveMarks: {
    type: Number,
    required: true
  },
  negativeMarks: {
    type: Number,
    required: true
  },
  subjects: [subjectSchema]
}, { _id: false });

const setPaperSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    sections: [sectionSchema],

    isPublished: {
      type: Boolean,
      default: false
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SetPaper", setPaperSchema);
