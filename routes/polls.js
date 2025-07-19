const express = require("express");
const { db } = require("../config/firebase");
const router = express.Router();
const QRCode = require("qrcode");

const LIVE_URL = "https://live-poll-backend-production.up.railway.app";

// POST /polls - Create a new poll
router.post("/polls", async (req, res, next) => {
  try {
    const { title, description, options, eventName, hostName } = req.body;

    // Validation
    if (!title || !options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        error: "Invalid poll data",
        message: "Title and at least 2 options are required",
      });
    }

    // Validate options format
    for (let i = 0; i < options.length; i++) {
      if (!options[i].text || options[i].text.trim() === "") {
        return res.status(400).json({
          error: "Invalid option",
          message: `Option ${i + 1} must have text`,
        });
      }
    }

    const pollData = {
      title: title.trim(),
      description: description?.trim() || "",
      eventName: eventName?.trim() || null,
      hostName: hostName?.trim() || null,
      options: options.map((option, index) => ({
        id: option.id || `option_${Date.now()}_${index}`,
        text: option.text.trim(),
      })),
      createdAt: new Date(),
      isActive: true,
      totalVotes: 0,
    };

    const pollRef = await db.collection("polls").add(pollData);

    res.status(201).json({
      success: true,
      message: "Poll created successfully",
      data: {
        pollId: pollRef.id,
        ...pollData,
        qrCodeUrl: `${LIVE_URL}/${pollRef.id}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /vote - Submit a vote for a poll option (Enhanced with duplicate prevention)
router.post("/vote", async (req, res, next) => {
  try {
    const { pollId, optionId, userId, deviceId } = req.body;

    // Validation
    if (!pollId || !optionId) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "pollId and optionId are required",
      });
    }

    // Check if poll exists and is active
    const pollRef = db.collection("polls").doc(pollId);
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({
        error: "Poll not found",
        message: "The specified poll does not exist",
      });
    }

    const pollData = pollDoc.data();

    // Check if poll is active
    if (!pollData.isActive) {
      return res.status(403).json({
        error: "Poll inactive",
        message: "This poll is no longer accepting votes",
      });
    }

    // Check if option exists in poll
    const optionExists = pollData.options?.some(
      (option) => option.id === optionId
    );
    if (!optionExists) {
      return res.status(400).json({
        error: "Invalid option",
        message: "The specified option does not exist for this poll",
      });
    }

    // Check for duplicate votes (by userId or deviceId or IP)
    const votesRef = db.collection("votes");
    let duplicateQuery = votesRef.where("pollId", "==", pollId);

    if (userId) {
      const userVoteCheck = await duplicateQuery
        .where("userId", "==", userId)
        .get();
      if (!userVoteCheck.empty) {
        return res.status(409).json({
          error: "Already voted",
          message: "You have already voted in this poll",
          data: { hasVoted: true },
        });
      }
    }

    if (deviceId) {
      const deviceVoteCheck = await duplicateQuery
        .where("deviceId", "==", deviceId)
        .get();
      if (!deviceVoteCheck.empty) {
        return res.status(409).json({
          error: "Already voted",
          message: "This device has already voted in this poll",
          data: { hasVoted: true },
        });
      }
    }

    // If no userId or deviceId, check by IP (less reliable but fallback)
    if (!userId && !deviceId) {
      const ipVoteCheck = await duplicateQuery
        .where("ipAddress", "==", req.ip)
        .get();
      if (!ipVoteCheck.empty) {
        return res.status(409).json({
          error: "Already voted",
          message: "This IP address has already voted in this poll",
          data: { hasVoted: true },
        });
      }
    }

    // Create vote document
    const voteData = {
      pollId,
      optionId,
      userId: userId || null,
      deviceId: deviceId || null,
      timestamp: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
    };

    // Add vote to votes collection
    await db.collection("votes").add(voteData);

    // Update total vote count in poll document
    await pollRef.update({
      totalVotes: (pollData.totalVotes || 0) + 1,
      lastVoteAt: new Date(),
    });

    // Get updated vote count for this option
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
        totalVotes: (pollData.totalVotes || 0) + 1,
        timestamp: voteData.timestamp,
        hasVoted: true,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /check-vote - Check if user has already voted
router.post("/check-vote", async (req, res, next) => {
  try {
    const { pollId, userId, deviceId } = req.body;

    if (!pollId) {
      return res.status(400).json({
        error: "Missing poll ID",
        message: "Poll ID is required",
      });
    }

    const votesRef = db.collection("votes");
    let hasVoted = false;
    let voteData = null;

    // Check by userId first
    if (userId) {
      const userVoteQuery = await votesRef
        .where("pollId", "==", pollId)
        .where("userId", "==", userId)
        .get();

      if (!userVoteQuery.empty) {
        hasVoted = true;
        voteData = userVoteQuery.docs[0].data();
      }
    }

    // Check by deviceId if no user vote found
    if (!hasVoted && deviceId) {
      const deviceVoteQuery = await votesRef
        .where("pollId", "==", pollId)
        .where("deviceId", "==", deviceId)
        .get();

      if (!deviceVoteQuery.empty) {
        hasVoted = true;
        voteData = deviceVoteQuery.docs[0].data();
      }
    }

    // Check by IP as fallback
    if (!hasVoted && !userId && !deviceId) {
      const ipVoteQuery = await votesRef
        .where("pollId", "==", pollId)
        .where("ipAddress", "==", req.ip)
        .get();

      if (!ipVoteQuery.empty) {
        hasVoted = true;
        voteData = ipVoteQuery.docs[0].data();
      }
    }

    res.json({
      success: true,
      data: {
        hasVoted,
        votedAt: voteData?.timestamp || null,
        votedOption: voteData?.optionId || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /results/:pollId - Get live poll results (Enhanced)
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

    // Format results with ranking
    const results = pollData.options
      .map((option) => ({
        id: option.id,
        text: option.text,
        votes: voteCounts[option.id] || 0,
        percentage:
          totalVotes > 0
            ? Math.round(((voteCounts[option.id] || 0) / totalVotes) * 100)
            : 0,
      }))
      .sort((a, b) => b.votes - a.votes); // Sort by votes descending

    // Add ranking
    results.forEach((option, index) => {
      option.rank = index + 1;
    });

    res.json({
      success: true,
      data: {
        pollId,
        title: pollData.title,
        description: pollData.description || "",
        eventName: pollData.eventName,
        hostName: pollData.hostName,
        totalVotes,
        results,
        isActive: pollData.isActive,
        createdAt: pollData.createdAt,
        lastUpdated: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /polls/:pollId - Get poll details (Enhanced)
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

    // Get total votes count
    const votesQuery = await db
      .collection("votes")
      .where("pollId", "==", pollId)
      .get();

    const totalVotes = votesQuery.size;

    res.json({
      success: true,
      data: {
        id: pollId,
        ...pollData,
        totalVotes,
        qrCodeUrl: `${LIVE_URL}/${pollId}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /polls - Get all polls (Enhanced)
router.get("/polls", async (req, res, next) => {
  try {
    const {
      isActive,
      limit = 20,
      offset = 0,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    let pollsQuery = db.collection("polls");

    // Filter by active status
    if (isActive !== undefined) {
      const activeFilter = isActive === "true";
      pollsQuery = pollsQuery.where("isActive", "==", activeFilter);
    }

    // Apply sorting
    pollsQuery = pollsQuery.orderBy(sortBy, sortOrder);

    // Apply pagination
    if (parseInt(offset) > 0) {
      pollsQuery = pollsQuery.offset(parseInt(offset));
    }
    pollsQuery = pollsQuery.limit(parseInt(limit));

    const pollsSnapshot = await pollsQuery.get();

    if (pollsSnapshot.empty) {
      return res.json({
        success: true,
        message: "No polls found",
        data: {
          polls: [],
          total: 0,
          hasMore: false,
        },
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
        eventName: pollData.eventName,
        hostName: pollData.hostName,
        totalVotes: votesQuery.size,
        optionCount: pollData.options ? pollData.options.length : 0,
        options: pollData.options,
        isActive: pollData.isActive || false,
        createdAt: pollData.createdAt,
        lastVoteAt: pollData.lastVoteAt,
        qrCodeUrl: `${LIVE_URL}/${pollId}`,
      });
    }

    res.json({
      success: true,
      data: {
        polls,
        total: polls.length,
        hasMore: polls.length === parseInt(limit),
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /polls/:pollId/qr - Generate QR code (Enhanced)
router.get("/polls/:pollId/qr", async (req, res, next) => {
  try {
    const { pollId } = req.params;
    const {
      format = "json",
      size = 200,
      domain = "live-poll-backend-production.up.railway.app",
    } = req.query;

    // Verify poll exists
    const pollRef = db.collection("polls").doc(pollId);
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({
        error: "Poll not found",
        message: "Cannot generate QR code for non-existent poll",
      });
    }

    const pollData = pollDoc.data();
    const qrUrl = `https://${domain}/poll/${pollId}`;

    // Generate QR code
    const qrOptions = {
      width: parseInt(size),
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    };

    if (format === "png") {
      // Return PNG image directly
      const qrCodeBuffer = await QRCode.toBuffer(qrUrl, qrOptions);
      res.set("Content-Type", "image/png");
      res.send(qrCodeBuffer);
    } else {
      // Return JSON with base64 data URL
      const qrCode = await QRCode.toDataURL(qrUrl, qrOptions);

      res.json({
        success: true,
        data: {
          pollId,
          pollTitle: pollData.title,
          qrCodeUrl: qrUrl,
          qrCodeImage: qrCode,
          generatedAt: new Date(),
        },
      });
    }
  } catch (error) {
    next(error);
  }
});

// PUT /polls/:pollId/toggle - Toggle poll active status
router.put("/polls/:pollId/toggle", async (req, res, next) => {
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
    const newStatus = !pollData.isActive;

    await pollRef.update({
      isActive: newStatus,
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      message: `Poll ${newStatus ? "activated" : "deactivated"} successfully`,
      data: {
        pollId,
        isActive: newStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /polls/:pollId/analytics - Get poll analytics
router.get("/polls/:pollId/analytics", async (req, res, next) => {
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

    // Get all votes with timestamps
    const votesQuery = await db
      .collection("votes")
      .where("pollId", "==", pollId)
      .orderBy("timestamp", "asc")
      .get();

    const votes = [];
    const hourlyVotes = {};
    const optionVotes = {};

    votesQuery.forEach((doc) => {
      const vote = doc.data();
      votes.push(vote);

      // Count votes by hour
      const hour = new Date(vote.timestamp.toDate()).toISOString().slice(0, 13);
      hourlyVotes[hour] = (hourlyVotes[hour] || 0) + 1;

      // Count votes by option
      optionVotes[vote.optionId] = (optionVotes[vote.optionId] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        pollId,
        pollTitle: pollData.title,
        totalVotes: votes.length,
        createdAt: pollData.createdAt,
        firstVoteAt: votes.length > 0 ? votes[0].timestamp : null,
        lastVoteAt: votes.length > 0 ? votes[votes.length - 1].timestamp : null,
        votesOverTime: hourlyVotes,
        votesByOption: optionVotes,
        uniqueUsers: [
          ...new Set(votes.filter((v) => v.userId).map((v) => v.userId)),
        ].length,
        uniqueDevices: [
          ...new Set(votes.filter((v) => v.deviceId).map((v) => v.deviceId)),
        ].length,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
