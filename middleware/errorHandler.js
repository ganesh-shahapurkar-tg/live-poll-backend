const errorHandler = (err, req, res, next) => {
  console.error("Error:", err.message);
  console.error("Error Code:", err.code);
  console.error("Error Stack:", err.stack);

  // Firebase errors (check if code exists and is a string)
  if (
    err.code &&
    typeof err.code === "string" &&
    err.code.includes("firebase")
  ) {
    return res.status(400).json({
      error: "Database error",
      message: err.message,
    });
  }

  // Firebase Admin SDK errors (different code format)
  if (
    err.code &&
    typeof err.code === "string" &&
    err.code.startsWith("auth/")
  ) {
    return res.status(401).json({
      error: "Authentication error",
      message: err.message,
    });
  }

  // Firebase Firestore errors
  if (err.code === 5 || err.code === "NOT_FOUND") {
    return res.status(404).json({
      error: "Resource not found",
      message: err.message,
    });
  }

  // Firebase permission errors
  if (err.code === 7 || err.code === "PERMISSION_DENIED") {
    return res.status(403).json({
      error: "Permission denied",
      message: "Insufficient permissions to access this resource",
    });
  }

  // Validation errors
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation error",
      message: err.message,
    });
  }

  // JSON parsing errors
  if (err.name === "SyntaxError" && err.message.includes("JSON")) {
    return res.status(400).json({
      error: "Invalid JSON",
      message: "Request body contains invalid JSON",
    });
  }

  // Default error
  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong"
        : err.message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

module.exports = errorHandler;
