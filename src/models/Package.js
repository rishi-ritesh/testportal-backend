const mongoose = require("mongoose");

// A Package (a.k.a. Test Series) bundles multiple SetPapers under a Type,
// e.g. type "SSC CGL Tier 1" → the 10 sectional mocks. A SetPaper may
// belong to more than one package.
const packageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    // grouping key shown to students, e.g. "SSC CGL Tier 1", "Banking"
    type: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      default: ""
    },

    // mocks bundled in this package
    setPapers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SetPaper"
      }
    ],

    order: {
      type: Number,
      default: 0
    },

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

module.exports = mongoose.model("Package", packageSchema);
