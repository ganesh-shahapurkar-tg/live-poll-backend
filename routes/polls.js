const express = require("express");
const { db } = require("../config/firebase");
const router = express.Router();

// POST /vote - Submit a vote for a poll option
router.post("/vote", async (req, res, next) => {
  try {
    const { pollId, optionId, userId } = req.body;

    // Validation
    if (!pollId || !optionId) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "pollId and optionId are required",
      });
    }

    // Check if poll exists
    const pollRef = db.collection("polls").doc(pollId);
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({
        error: "Poll not found",
        message: "The specified poll does not exist",
      });
    }

    const pollData = pollDoc.data();

    // Check if option exists in poll
    const optionExists =
      pollData.options &&
      pollData.options.some((option) => option.id === optionId);
    if (!optionExists) {
      return res.status(400).json({
        error: "Invalid option",
        message: "The specified option does not exist for this poll",
      });
    }

    // Create vote document
    const voteData = {
      pollId,
      optionId,
      userId: userId || null,
      timestamp: new Date(),
      ipAddress: req.ip,
    };

    // Add vote to votes collection
    await db.collection("votes").add(voteData);

    // Update poll results (increment vote count for this option)
    const votesQuery = await db
      .collection("votes")
      .where("pollId", "==", pollId)
      .where("optionId", "==", optionId)
      .get();

    const voteCount = votesQuery.size;

    res.status(201).json({
      success: true,
      message: "Vote submitted successfully",
      data: {
        pollId,
        optionId,
        voteCount,
        timestamp: voteData.timestamp,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /results/:pollId - Get live poll results
router.get("/results/:pollId", async (req, res, next) => {
  try {
    const { pollId } = req.params;

    if (!pollId) {
      return res.status(400).json({
        error: "Missing poll ID",
        message: "Poll ID is required",
      });
    }

    // Get poll data
    const pollRef = db.collection("polls").doc(pollId);
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({
        error: "Poll not found",
        message: "The specified poll does not exist",
      });
    }

    const pollData = pollDoc.data();

    // Get all votes for this poll
    const votesQuery = await db
      .collection("votes")
      .where("pollId", "==", pollId)
      .get();

    // Calculate results
    const voteCounts = {};
    let totalVotes = 0;

    votesQuery.forEach((doc) => {
      const vote = doc.data();
      voteCounts[vote.optionId] = (voteCounts[vote.optionId] || 0) + 1;
      totalVotes++;
    });

    // Format results
    const results = pollData.options.map((option) => ({
      id: option.id,
      text: option.text,
      votes: voteCounts[option.id] || 0,
      percentage:
        totalVotes > 0
          ? Math.round(((voteCounts[option.id] || 0) / totalVotes) * 100)
          : 0,
    }));

    res.json({
      success: true,
      data: {
        pollId,
        title: pollData.title,
        description: pollData.description || "",
        totalVotes,
        results,
        lastUpdated: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /polls/:pollId - Get poll details (bonus endpoint)
router.get("/polls/:pollId", async (req, res, next) => {
  try {
    const { pollId } = req.params;

    const pollRef = db.collection("polls").doc(pollId);
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({
        error: "Poll not found",
        message: "The specified poll does not exist",
      });
    }

    const pollData = pollDoc.data();

    res.json({
      success: true,
      data: {
        id: pollId,
        ...pollData,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /polls - Get all polls (Simple version)
router.get("/polls", async (req, res, next) => {
  try {
    // Get all polls
    const pollsSnapshot = await db
      .collection("polls")
      .orderBy("createdAt", "desc")
      .get();

    if (pollsSnapshot.empty) {
      return res.json({
        success: true,
        message: "No polls found",
        data: [],
      });
    }

    // Format the polls data
    const polls = [];

    for (const doc of pollsSnapshot.docs) {
      const pollData = doc.data();
      const pollId = doc.id;

      // Get total votes for this poll
      const votesQuery = await db
        .collection("votes")
        .where("pollId", "==", pollId)
        .get();

      polls.push({
        id: pollId,
        title: pollData.title,
        description: pollData.description || "",
        totalVotes: votesQuery.size,
        optionCount: pollData.options ? pollData.options.length : 0,
        option: pollData.options,
        isActive: pollData.isActive || false,
        createdAt: pollData.createdAt,
      });
    }

    res.json({
      success: true,
      data: polls,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
