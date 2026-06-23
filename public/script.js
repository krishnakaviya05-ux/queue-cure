// Check which page is currently active by searching for key DOM elements
const isReceptionistPage = !!document.getElementById('addPatientForm');
const isPatientPage = !!document.getElementById('checkStatusForm');

// In-memory frontend cache for queue state
let currentToken = null;
let waitingList = [];
let avgConsultationTime = 10;

// Retrieve searched patient token from session storage (if any) to persist status on reload
let searchedToken = sessionStorage.getItem('searchedToken')
  ? parseInt(sessionStorage.getItem('searchedToken'), 10)
  : null;

// Initialize Socket.io connection (automatically points to current origin)
const socket = io();

// -------------------------------------------------------------
// SOCKET.IO EVENT HANDLERS
// -------------------------------------------------------------

// Listen for "queue-updated" broadcast from server
socket.on('queue-updated', (data) => {
  currentToken = data.currentToken;
  waitingList = data.waitingList;
  avgConsultationTime = data.avgConsultationTime;
  
  // Rerender active view components
  updateUI();
});

// Listen for "patient-added" broadcast from server
socket.on('patient-added', (data) => {
  // Render a toast alert for the user
  showToast(`New patient registered: "${data.name}" (Token #${data.token})`, 'success');
});

// -------------------------------------------------------------
// UI RENDERING METHODS
// -------------------------------------------------------------

function updateUI() {
  if (isReceptionistPage) {
    // 1. Update Serving & Waiting summary cards
    document.getElementById('currentTokenDisplay').innerText = currentToken !== null ? `#${currentToken}` : '-';
    document.getElementById('totalWaitingDisplay').innerText = waitingList.length;
    document.getElementById('tableHeaderCount').innerText = `${waitingList.length} waiting`;
    
    // 2. Render waiting queue list
    const tbody = document.getElementById('waitingListBody');
    if (waitingList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--slate-400); padding: 2rem;">
            No patients waiting in queue.
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = waitingList.map(patient => `
        <tr>
          <td><strong>#${patient.token}</strong></td>
          <td>${escapeHtml(patient.name)}</td>
          <td>${patient.position}</td>
          <td><span class="badge badge-amber">${patient.estimatedWait} min</span></td>
        </tr>
      `).join('');
    }

    // 3. Update Consultation Settings placeholder
    const timeInput = document.getElementById('avgTimeInput');
    if (timeInput && document.activeElement !== timeInput) {
      timeInput.placeholder = avgConsultationTime;
    }
  }

  if (isPatientPage) {
    // 1. Update Now Serving board
    document.getElementById('patientCurrentToken').innerText = currentToken !== null ? `#${currentToken}` : '-';

    // 2. Refresh search results if patient has already checked their token status
    if (searchedToken !== null) {
      checkTokenStatus(searchedToken);
    }
  }
}

/**
 * Computes patient queue metrics and updates the patient status report card.
 */
function checkTokenStatus(tokenNum) {
  if (!isPatientPage) return;

  const statusCard = document.getElementById('patientStatusCard');
  const cardTitle = document.getElementById('statusCardTitle');
  const cardDesc = document.getElementById('statusCardDescription');
  const detailsGrid = document.getElementById('statusDetailsGrid');
  const peopleAheadEl = document.getElementById('statusPeopleAhead');
  const waitTimeEl = document.getElementById('statusWaitTime');

  // Reset display classes
  statusCard.className = 'status-card';

  // Find maximum token generated in queue list to determine if searched token is valid
  const maxTokenInList = waitingList.length > 0 ? Math.max(...waitingList.map(p => p.token)) : 0;
  const highestIssuedToken = Math.max(currentToken || 0, maxTokenInList);

  // Check if patient token is in the waiting list
  const patient = waitingList.find(p => p.token === tokenNum);

  if (patient) {
    statusCard.classList.add('success');
    cardTitle.innerText = `Token #${tokenNum} - Waiting`;
    cardDesc.innerText = `Hello ${escapeHtml(patient.name)}, you are currently in the queue. Please stay in the waiting area.`;
    detailsGrid.style.display = 'grid';
    peopleAheadEl.innerText = patient.position - 1;
    waitTimeEl.innerText = patient.estimatedWait;
  } else if (currentToken !== null && tokenNum === currentToken) {
    statusCard.classList.add('called');
    cardTitle.innerText = `Token #${tokenNum} - You've Been Called!`;
    cardDesc.innerText = `🎉 Please head to the doctor's consultation office immediately. Your token is now being called.`;
    detailsGrid.style.display = 'none';
  } else if (tokenNum <= highestIssuedToken) {
    statusCard.classList.add('called');
    cardTitle.innerText = `Token #${tokenNum} - Already Served`;
    cardDesc.innerText = `Your token has already been called by the doctor. If you missed your consultation, please consult the receptionist.`;
    detailsGrid.style.display = 'none';
  } else {
    statusCard.classList.add('error');
    cardTitle.innerText = `Invalid Token`;
    cardDesc.innerText = `❌ Token #${tokenNum} is invalid or has not been registered yet. Please verify your token number.`;
    detailsGrid.style.display = 'none';
  }
}

// -------------------------------------------------------------
// REST API HELPERS
// -------------------------------------------------------------

async function fetchQueueState() {
  try {
    const res = await fetch('/api/queue');
    if (!res.ok) throw new Error("Failed to load queue state");
    const data = await res.json();
    currentToken = data.currentToken;
    waitingList = data.waitingList;
    avgConsultationTime = data.avgConsultationTime;
    updateUI();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addPatient(name) {
  try {
    const res = await fetch('/api/patient/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Failed to register patient", 'error');
    } else {
      showToast(`Patient "${data.name}" added successfully with Token #${data.token}!`, 'success');
      document.getElementById('patientName').value = '';
    }
  } catch (err) {
    showToast("Network error. Unable to register patient.", 'error');
  }
}

async function callNext() {
  try {
    const res = await fetch('/api/queue/next', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Queue is empty! No patients to call.", 'error');
    } else {
      showToast(`Token #${data.currentToken} called!`, 'success');
    }
  } catch (err) {
    showToast("Network error. Unable to call next patient.", 'error');
  }
}

async function setAvgTime(avgTime) {
  try {
    const res = await fetch('/api/queue/set-time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avgTime })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Failed to update consultation time", 'error');
    } else {
      showToast(`Consultation time updated to ${avgTime} mins!`, 'success');
      document.getElementById('avgTimeInput').value = '';
    }
  } catch (err) {
    showToast("Network error. Unable to update settings.", 'error');
  }
}

// -------------------------------------------------------------
// SYSTEM UTILITIES
// -------------------------------------------------------------

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <div>${message}</div>
  `;

  container.appendChild(toast);

  // Automatically fade out and remove toast after 5 seconds
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// -------------------------------------------------------------
// EVENT BINDINGS
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Fetch initial queue data upon load
  fetchQueueState();

  // Receptionist views configuration
  if (isReceptionistPage) {
    document.getElementById('addPatientForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('patientName').value.trim();
      if (name) addPatient(name);
    });

    document.getElementById('setTimeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const avgTime = parseInt(document.getElementById('avgTimeInput').value, 10);
      if (!isNaN(avgTime)) setAvgTime(avgTime);
    });

    document.getElementById('callNextBtn').addEventListener('click', () => {
      callNext();
    });
  }

  // Patient views configuration
  if (isPatientPage) {
    const checkForm = document.getElementById('checkStatusForm');
    const searchInput = document.getElementById('searchTokenInput');

    if (searchedToken !== null) {
      searchInput.value = searchedToken;
    }

    checkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = parseInt(searchInput.value, 10);
      if (!isNaN(token)) {
        searchedToken = token;
        sessionStorage.setItem('searchedToken', token);
        checkTokenStatus(token);
      }
    });
  }
});
