# Queue Cure Backend

Queue Cure is a Node.js + Express + Socket.io backend for a clinic queue management system.

## Features
- **REST API** to add patients, view queue, call the next patient, and adjust average consultation times.
- **Real-time updates** via Socket.io when patients are added or the queue state updates.
- **In-memory store** resets on server restart.
- **Race condition prevention** using a concurrency lock/flag for receptionist clicks to call the next patient.
- **CORS enabled** to allow frontend connections on different ports.

## API Reference

### 1. Add Patient
- **Endpoint:** `POST /api/patient/add`
- **Body:** `{ "name": "Patient Name" }`
- **Returns:** `{ "token": number, "name": "string", "position": number }`

### 2. Get Queue State
- **Endpoint:** `GET /api/queue`
- **Returns:**
  ```json
  {
    "currentToken": number | null,
    "waitingList": [
      {
        "token": number,
        "name": "string",
        "position": number,
        "estimatedWait": number
      }
    ],
    "avgConsultationTime": number,
    "totalWaiting": number
  }
  ```

### 3. Call Next Patient
- **Endpoint:** `POST /api/queue/next`
- **Returns:** Updated queue state.
- **Edge cases:** Returns standard HTTP 400 Bad Request error if the queue is empty. Handles concurrency (only one call is processed at a time).

### 4. Set Consultation Time
- **Endpoint:** `POST /api/queue/set-time`
- **Body:** `{ "avgTime": number }` (in minutes)
- **Returns:** Updated queue state.
- **Edge cases:** Clamped to a minimum of 1 minute.

---

## Socket.io Events

### Emitted Events

1. **`queue-updated`**
   - **Payload:** `{ currentToken, waitingList, avgConsultationTime }`
   - **Trigger:** Sent to all clients when the queue changes (patient added, next patient called, consultation time updated).

2. **`patient-added`**
   - **Payload:** `{ token, name, position, estimatedWait }`
   - **Trigger:** Sent to all clients when a new patient joins the queue.

---

## Development

### Prerequisites
- Node.js (v14+)
- npm

### Installation
```bash
npm install
```

### Run Server

To run the server in development mode (with auto-reload via `nodemon`):
```bash
npm run dev
```

To run in production mode:
```bash
npm start
```
