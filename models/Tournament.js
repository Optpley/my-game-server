const mongoose = require("mongoose");

const PrizeSchema = new mongoose.Schema({
  title: String,          // название приза (например, "iPhone 16 Pro")
  imageUrl: String        // картинка приза (URL из /uploads)
});

const TournamentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true        // название турнира
  },
  games: [String],        // какие игры участвуют, например: ["ice_arena", "mix", "wheel"]
  prizes: [PrizeSchema],  // несколько призов
  startAt: Date,          // время начала
  endAt: Date,            // время конца
  isActive: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Tournament", TournamentSchema);

