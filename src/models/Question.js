const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true
  },
  text: {
    en: {
      type: String,
      required: true
    },
    hi: {
      type: String,
      required: true
    }
  }
}, { _id: false });

const questionSchema = new mongoose.Schema(
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

    questionCode: {
      type: String,
      required: true,
      unique: true
    },

    question: {
      en: {
        type: String,
        required: true,
        trim: true
      },
      hi: {
        type: String,
        required: true,
        trim: true
      }
    },

    options: {
      type: [optionSchema],
      validate: {
        validator: function (value) {
          return value.length >= 2;
        },
        message: "Minimum 2 options required"
      }
    },

    correctAnswer: {
      type: String,
      required: true
    },

    explanation: {
      en: {
        type: String,
        required: true
      },
      hi: {
        type: String,
        required: true
      }
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Question", questionSchema);
