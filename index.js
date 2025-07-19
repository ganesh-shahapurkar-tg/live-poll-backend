const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pollRoutes = require("./routes/polls");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: "*", // In production, specify your React Native app's domain
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy (important for deployment)
app.set("trust proxy", true);

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Live Polling API is running!",
    version: "1.0.0",
    endpoints: {
      vote: "POST /vote",
      results: "GET /results/:pollId",
      poll: "GET /polls/:pollId",
    },
  });
});

// Routes
app.use("/", pollRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Live Polling API server running on port ${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/`);
});

module.exports = app;
