import mongoose from "mongoose";

mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));
import express from "express";
const app = express();

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(3000, () => console.log("Server started on port 3000"));
