const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },

  email: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  role: {
    type: String,
    enum: ["admin", "student"],
    default: "student"
  },

  preferences: {
    language: {
      type: String,
      enum: ["en", "hi"],
      default: "en"
    }
  }
});

module.exports = mongoose.model("User", UserSchema);
