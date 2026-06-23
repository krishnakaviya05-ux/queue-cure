const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();

// Enable CORS for all REST endpoints to allow frontend connection from different ports
app.use(cors());
app.use(express.json());

// Serve static frontend files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// Initialize Socket.io with CORS settings to allow frontend connection
const io = new Server(server, {
  cors: {
    origin: "*", // Allows any origin to connect, change in production as needed
    methods: ["GET", "POST"]
  }
});

// In-memory Queue State
let currentToken = null; // Token currently being seen by doctor
let waitingList = [];    // List of patients waiting to be seen
let avgConsultationTime = 10; // Average consultation time in minutes (default 10)
let nextTokenId = 1;     // Next available token number (starts from 1)

// Concurrency lock to prevent simultaneous 'next' calls (e.g. two receptionists clicking at once)
let isCallingNext = false;

/**
 * Recalculates position and estimatedWait for all patients in the waitingList.
 * Estimated wait time is computed as: position * avgConsultationTime
 */
function recalculateWaitTimes() {
  waitingList = waitingList.map((patient, index) => {
    const position = index + 1;
    return {
      ...patient,
      position,
      estimatedWait: position * avgConsultationTime
    };
  });
}

/**
 * Returns the full queue state.
 */
function getQueueState() {
  return {
    currentToken,
    waitingList,
    avgConsultationTime,
    totalWaiting: waitingList.length
  };
}

/* 
 ==========================================
          SOCKET.IO CONNECTION
 ==========================================
*/
io.on('connection', (socket) => {
  console.log(`[Socket] New client connected: ${socket.id}`);

  // Emit current state to client upon initial connection
  socket.emit('queue-updated', {
    currentToken,
    waitingList,
    avgConsultationTime
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

/* 
 ==========================================
            REST API ENDPOINTS
 ==========================================
*/

/**
 * POST /api/patient/add
 * Body: { name: string }
 * Auto-generates next token number (starts from 1)
 * Adds patient to queue
 * Returns: { token, name, position }
 */
app.post('/api/patient/add', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: "Patient name is required" });
  }

  const trimmedName = name.trim();
  const token = nextTokenId++;
  const position = waitingList.length + 1;
  const estimatedWait = position * avgConsultationTime;

  const newPatient = {
    token,
    name: trimmedName,
    position,
    estimatedWait
  };

  waitingList.push(newPatient);

  console.log(`[Patient Added] Name: "${newPatient.name}", Token: ${newPatient.token}, Position: ${newPatient.position}`);

  /**
   * SOCKET EVENT: "patient-added"
   * Emitted to all connected clients when a new patient joins the queue.
   * Payload: { token, name, position, estimatedWait }
   */
  io.emit('patient-added', {
    token: newPatient.token,
    name: newPatient.name,
    position: newPatient.position,
    estimatedWait: newPatient.estimatedWait
  });

  /**
   * SOCKET EVENT: "queue-updated"
   * Emitted to all connected clients to keep full queue state synchronized.
   * Payload: { currentToken, waitingList, avgConsultationTime }
   */
  io.emit('queue-updated', {
    currentToken,
    waitingList,
    avgConsultationTime
  });

  return res.status(201).json({
    token: newPatient.token,
    name: newPatient.name,
    position: newPatient.position
  });
});

/**
 * GET /api/queue
 * Returns full queue state:
 * { 
 *   currentToken, 
 *   waitingList: [...], 
 *   avgConsultationTime (in minutes),
 *   totalWaiting 
 * }
 */
app.get('/api/queue', (req, res) => {
  return res.json(getQueueState());
});

/**
 * POST /api/queue/next
 * Calls next token (marks current as done / updates it)
 * Emits socket event to all clients
 * Returns updated queue state
 */
app.post('/api/queue/next', async (req, res) => {
  // Check locking flag to prevent simultaneous clicks from multiple receptionists
  if (isCallingNext) {
    return res.status(409).json({ error: "Request is already in progress. Please wait." });
  }

  isCallingNext = true;

  try {
    // Micro-delay to make simultaneous requests trigger the lock state
    await new Promise(resolve => setTimeout(resolve, 50));

    if (waitingList.length === 0) {
      return res.status(400).json({ error: "Queue is empty" });
    }

    const nextPatient = waitingList.shift();
    currentToken = nextPatient.token;

    // Recalculate positions and waiting times for remaining patients
    recalculateWaitTimes();

    console.log(`[Next Called] Doctor is now seeing Token: ${currentToken}`);

    /**
     * SOCKET EVENT: "queue-updated"
     * Emitted to all connected clients when a new patient is called.
     * Payload: { currentToken, waitingList, avgConsultationTime }
     */
    io.emit('queue-updated', {
      currentToken,
      waitingList,
      avgConsultationTime
    });

    return res.json(getQueueState());
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    isCallingNext = false;
  }
});

/**
 * POST /api/queue/set-time
 * Body: { avgTime: number } (in minutes)
 * Updates average consultation time
 * Recalculates all wait times
 * Emits updated queue to all clients
 */
app.post('/api/queue/set-time', (req, res) => {
  let { avgTime } = req.body;

  if (avgTime === undefined || typeof avgTime !== 'number') {
    return res.status(400).json({ error: "avgTime must be a number" });
  }

  // Handle avgConsultationTime of 0 (or negative) -> default to 1 minute minimum
  if (avgTime <= 0) {
    avgTime = 1;
  }

  avgConsultationTime = avgTime;

  // Recalculate wait times for all waiting patients based on new average time
  recalculateWaitTimes();

  console.log(`[Time Updated] Average consultation time updated to: ${avgConsultationTime} minutes`);

  /**
   * SOCKET EVENT: "queue-updated"
   * Emitted to all connected clients when the average consultation time changes.
   * Payload: { currentToken, waitingList, avgConsultationTime }
   */
  io.emit('queue-updated', {
    currentToken,
    waitingList,
    avgConsultationTime
  });

  return res.json(getQueueState());
});

// Export io instance (and app, server) so they can be used across files if needed
module.exports = { app, server, io };

// Start the server if file is executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`[Queue Cure] Server running on port ${PORT}`);
  });
}
