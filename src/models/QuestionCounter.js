const mongoose = require("mongoose");

const questionCounterSchema = new mongoose.Schema({
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  count: {
    type: Number,
    default: 0
  }
});

// One counter per subject + topic
questionCounterSchema.index(
  { subjectId: 1, topicId: 1 },
  { unique: true }
);

module.exports = mongoose.model("QuestionCounter", questionCounterSchema);