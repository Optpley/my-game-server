const mongoose = require("mongoose");

const MixGameSchema = new mongoose.Schema({
  currentGame: {
    type: String,         // "dodge_rocks" или "color_wars"
    required: true
  },
  expiresAt: {
    type: Date,           // когда истекает (через 24 часа)
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("MixGame", MixGameSchema);

