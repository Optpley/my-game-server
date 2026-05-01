const mongoose = require("mongoose");

const GameSchema = new mongoose.Schema({
  players: [
    {
      username: String,
      avatarUrl: String,
      bet: Number
    }
  ],
  status: {
    type: String,
    default: "waiting" // waiting | started | finished
  },
  timerEndsAt: {
    type: Number,
    default: null
  },
  winner: {
    username: String,
    avatarUrl: String,
    winAmount: Number
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Game", GameSchema);
