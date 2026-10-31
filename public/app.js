// ==========================================================================
// WA-Hub Client Application Logic
// ==========================================================================

const API_BASE = '/api';

// State
let appState = {
  status: 'DISCONNECTED',
  connected: false,
  user: null,
  qrAvailable: false,
  activeCampaignInterval: null
};

// DOM Elements
const connectionStatusBadge = document.getElementById('connectionStatusBadge');
const connectionStatusText = document.getElementById('connectionStatusText');
const btnRefreshStatus = document.getElementById('btnRefreshStatus');
const btnLogout = document.getElementById('btnLogout');
const navQrPill = document.getElementById('navQrPill');

// QR elements
const qrStatusPill = document.getElementById('qrStatusPill');
const qrLoadingSpinner = document.getElementById('qrLoadingSpinner');
const qrImageContainer = document.getElementById('qrImageContainer');
const qrImage = document.getElementById('qrImage');
const connectedStateContainer = document.getElementById('connectedStateContainer');
const connectedPhoneDisplay = document.getElementById('connectedPhoneDisplay');

// Toast container
const toastContainer = document.getElementById('toastContainer');

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- TAB SWITCHING ---
function initTabs() {
  const tabButtons = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) {
        targetPane.classList.add('active');
      }

      // If switching to inbox, refresh logs
      if (targetTabId === 'tab-inbox') {
        loadInboxLogs();
      }
    });
  });
}

// --- STATUS & QR POLLING ---
async function fetchStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    const data = await res.json();
    appState = { ...appState, ...data };
    updateConnectionUI();

    // If QR is available and we're not connected, load the QR image
    if (data.status === 'QR_READY' && !data.connected) {
      loadQrCode();
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
    connectionStatusBadge.className = 'status-pill status-disconnected';
    connectionStatusText.innerText = 'Server Offline';
  }
}

async function loadQrCode() {
  try {
    const res = await fetch(`${API_BASE}/qr?t=${Date.now()}`);
    const data = await res.json();

    if (data.success && data.qr) {
      if (qrImage.src !== data.qr) {
        qrImage.src = data.qr;
      }
      qrLoadingSpinner.style.display = 'none';
      qrImageContainer.style.display = 'inline-block';
      connectedStateContainer.style.display = 'none';
      if (qrStatusPill) {
        qrStatusPill.className = 'badge-amber';
        qrStatusPill.innerText = 'Ready to Scan';
      }
      navQrPill.style.display = 'inline-block';
    }
  } catch (err) {
    console.error('Failed to fetch QR:', err);
  }
}

function initPairingMethods() {
  const btnMethodCode = document.getElementById('btnMethodCode');
  const btnMethodQr = document.getElementById('btnMethodQr');
  const pairingCodeCard = document.getElementById('pairingCodeCard');
  const pairingQrCard = document.getElementById('pairingQrCard');
  const formPairingCode = document.getElementById('formPairingCode');
  const pairingPhoneInput = document.getElementById('pairingPhoneInput');
  const btnRequestCode = document.getElementById('btnRequestCode');
  const pairingCodeResult = document.getElementById('pairingCodeResult');
  const codeNumberDisplay = document.getElementById('codeNumberDisplay');
  const btnForceRefreshQr = document.getElementById('btnForceRefreshQr');

  if (btnMethodCode && btnMethodQr) {
    btnMethodCode.addEventListener('click', () => {
      btnMethodCode.classList.add('active');
      btnMethodQr.classList.remove('active');
      pairingCodeCard.style.display = 'block';
      pairingQrCard.style.display = 'none';
    });

    btnMethodQr.addEventListener('click', () => {
      btnMethodQr.classList.add('active');
      btnMethodCode.classList.remove('active');
      pairingQrCard.style.display = 'block';
      pairingCodeCard.style.display = 'none';
      loadQrCode();
    });
  }

  // Handle Pairing Code Generation
  if (formPairingCode) {
    formPairingCode.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawPhone = pairingPhoneInput.value.trim();
      if (!rawPhone) {
        showToast('Please enter your WhatsApp mobile number', 'error');
        return;
      }

      btnRequestCode.disabled = true;
      btnRequestCode.innerText = 'Requesting Code from WhatsApp...';

      try {
        const res = await fetch(`${API_BASE}/pairing-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: rawPhone })
        });
        const data = await res.json();

        if (data.success && data.code) {
          // Format e.g. 12345678 -> 1234 - 5678
          const formatted = data.code.length === 8 
            ? `${data.code.substring(0, 4)} - ${data.code.substring(4)}`
            : data.code;
          codeNumberDisplay.innerText = formatted;
          pairingCodeResult.style.display = 'block';
          showToast('Pairing code generated! Check your phone WhatsApp notification.', 'success');
        } else {
          showToast(`Error: ${data.error || 'Failed to generate code'}`, 'error');
        }
      } catch (err) {
        showToast('Request error: ' + err.message, 'error');
      } finally {
        btnRequestCode.disabled = false;
        btnRequestCode.innerText = 'Get 8-Digit WhatsApp Code';
      }
    });
  }

  // Handle Manual QR Refresh
  if (btnForceRefreshQr) {
    btnForceRefreshQr.addEventListener('click', async () => {
      qrLoadingSpinner.style.display = 'flex';
      qrImageContainer.style.display = 'none';
      showToast('Refreshing QR Code...', 'info');
      try {
        await fetch(`${API_BASE}/qr/refresh`, { method: 'POST' });
        setTimeout(loadQrCode, 2000);
      } catch (err) {
        showToast('Error refreshing QR: ' + err.message, 'error');
      }
    });
  }
}

function updateConnectionUI() {
  const pairingMethodSelector = document.querySelector('.pairing-method-selector');
  const pairingCodeCard = document.getElementById('pairingCodeCard');
  const pairingQrCard = document.getElementById('pairingQrCard');

  if (appState.connected) {
    connectionStatusBadge.className = 'status-pill status-connected';
    connectionStatusText.innerText = `Connected (${appState.user?.phone || 'Online'})`;
    btnLogout.style.display = 'inline-flex';
    navQrPill.style.display = 'none';

    // Show connected state on Tab 1
    qrLoadingSpinner.style.display = 'none';
    qrImageContainer.style.display = 'none';
    if (pairingCodeCard) pairingCodeCard.style.display = 'none';
    if (pairingQrCard) pairingQrCard.style.display = 'block';
    if (pairingMethodSelector) pairingMethodSelector.style.display = 'none';
    connectedStateContainer.style.display = 'flex';
    connectedPhoneDisplay.innerText = appState.user?.phone || '+91 Linked';
    if (qrStatusPill) {
      qrStatusPill.className = 'badge-pro';
      qrStatusPill.innerText = 'Active & Online';
    }
  } else if (appState.status === 'QR_READY') {
    connectionStatusBadge.className = 'status-pill status-connecting';
    connectionStatusText.innerText = 'Pair WhatsApp Device';
    btnLogout.style.display = 'none';
    connectedStateContainer.style.display = 'none';
    if (pairingMethodSelector) pairingMethodSelector.style.display = 'flex';
  } else if (appState.status === 'CONNECTING') {
    connectionStatusBadge.className = 'status-pill status-connecting';
    connectionStatusText.innerText = 'Connecting...';
    btnLogout.style.display = 'none';
  } else {
    connectionStatusBadge.className = 'status-pill status-disconnected';
    connectionStatusText.innerText = 'Disconnected';
    btnLogout.style.display = 'none';
    if (pairingMethodSelector) pairingMethodSelector.style.display = 'flex';
  }
}

// --- LOGOUT / UNLINK ---
async function handleLogout() {
  if (!confirm('Are you sure you want to unlink this WhatsApp device? You will need to scan the QR again.')) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/logout`, { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Device unlinked.', 'info');
    appState.connected = false;
    appState.status = 'DISCONNECTED';
    updateConnectionUI();

    // Reset QR frame
    qrImageContainer.style.display = 'none';
    connectedStateContainer.style.display = 'none';
    qrLoadingSpinner.style.display = 'flex';
    setTimeout(fetchStatus, 2000);
  } catch (err) {
    showToast('Failed to unlink: ' + err.message, 'error');
  }
}

// --- QUICK SEND & PREVIEW ---
function initQuickSend() {
  const form = document.getElementById('formQuickSend');
  const quickMessage = document.getElementById('quickMessage');
  const quickMedia = document.getElementById('quickMedia');
  const mockupTextPreview = document.getElementById('mockupTextPreview');
  const mockupMediaPreview = document.getElementById('mockupMediaPreview');
  const mockupImgTag = document.getElementById('mockupImgTag');
  const mockupTime = document.getElementById('mockupTime');

  // Update time mockup
  const now = new Date();
  mockupTime.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ✓✓';

  // Live text preview
  quickMessage.addEventListener('input', () => {
    mockupTextPreview.innerText = quickMessage.value || 'Type a message...';
  });

  // Live image preview
  quickMedia.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        mockupImgTag.src = ev.target.result;
        mockupMediaPreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      mockupMediaPreview.style.display = 'none';
    }
  });

  // Submit quick send
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!appState.connected) {
      showToast('Please link your WhatsApp device in the "Link Device" tab first!', 'error');
      return;
    }

    const phone = document.getElementById('quickPhone').value.trim();
    const message = quickMessage.value.trim();
    const file = quickMedia.files[0];
    const submitBtn = document.getElementById('btnQuickSend');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Sending...';

    try {
      let res;
      if (file) {
        const formData = new FormData();
        formData.append('phone', phone);
        formData.append('caption', message);
        formData.append('media', file);
        res = await fetch(`${API_BASE}/send-media`, {
          method: 'POST',
          body: formData
        });
      } else {
        res = await fetch(`${API_BASE}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message })
        });
      }

      const data = await res.json();
      if (data.success) {
        showToast(`Message sent to ${data.recipient}! 🚀`, 'success');
        loadInboxLogs();
      } else {
        showToast(`Error: ${data.error || 'Failed to send'}`, 'error');
      }
    } catch (err) {
      showToast('Network error sending message', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Send WhatsApp Message';
    }
  });
}

// --- E-COMMERCE TRIGGERS (GoWhats Style) ---
function initEcommerceTriggers() {
  // 1. COD Verification
  document.getElementById('formCodTrigger').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.connected) {
      showToast('Please link your WhatsApp device first!', 'error');
      return;
    }

    const payload = {
      phone: document.getElementById('codPhone').value.trim(),
      customerName: document.getElementById('codName').value.trim(),
      orderId: document.getElementById('codOrderId').value.trim(),
      amount: document.getElementById('codAmount').value,
      address: document.getElementById('codAddress').value.trim()
    };

    const btn = document.getElementById('btnSendCod');
    btn.disabled = true;
    btn.innerText = 'Triggering COD Alert...';

    try {
      const res = await fetch(`${API_BASE}/templates/cod-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`COD Verification dispatched to ${data.recipient}! 🛡️`, 'success');
        loadInboxLogs();
      } else {
        showToast(`Failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Request error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Trigger COD Verification Message';
    }
  });

  // 2. Order Receipt
  document.getElementById('formReceiptTrigger').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.connected) {
      showToast('Please link your WhatsApp device first!', 'error');
      return;
    }

    const payload = {
      phone: document.getElementById('receiptPhone').value.trim(),
      customerName: document.getElementById('receiptName').value.trim(),
      orderId: document.getElementById('receiptOrderId').value.trim(),
      total: document.getElementById('receiptTotal').value,
      items: [
        { name: 'A5 Dotted Journal (Hardbound)', qty: 2, price: 350 },
        { name: 'Metallic Brush Pens (Pack of 10)', qty: 1, price: 550 }
      ],
      trackingUrl: 'http://localhost:3000/orders/' + document.getElementById('receiptOrderId').value.trim()
    };

    const btn = document.getElementById('btnSendReceipt');
    btn.disabled = true;
    btn.innerText = 'Sending Receipt...';

    try {
      const res = await fetch(`${API_BASE}/templates/order-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Order Receipt dispatched to ${data.recipient}! 🧾`, 'success');
        loadInboxLogs();
      } else {
        showToast(`Failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Request error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Trigger Order Receipt Message';
    }
  });

  // 3. Abandoned Cart
  document.getElementById('formCartTrigger').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.connected) {
      showToast('Please link your WhatsApp device first!', 'error');
      return;
    }

    const payload = {
      phone: document.getElementById('cartPhone').value.trim(),
      customerName: document.getElementById('cartName').value.trim(),
      itemsSummary: document.getElementById('cartItems').value.trim(),
      checkoutLink: document.getElementById('cartLink').value.trim(),
      discountCode: document.getElementById('cartCoupon').value.trim()
    };

    const btn = document.getElementById('btnSendCart');
    btn.disabled = true;
    btn.innerText = 'Triggering Recovery...';

    try {
      const res = await fetch(`${API_BASE}/templates/abandoned-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Abandoned Cart link sent to ${data.recipient}! 🛒`, 'success');
        loadInboxLogs();
      } else {
        showToast(`Failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Request error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Trigger Cart Recovery Message';
    }
  });

  // Copy Store Snippet
  document.getElementById('btnCopyStoreCode').addEventListener('click', () => {
    const code = document.getElementById('storeIntegrationSnippet').innerText;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Store integration snippet copied to clipboard! 📋', 'success');
    });
  });
}

// --- CAMPAIGN BROADCASTER ---
function parseContactsInput(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();

  // If already JSON array, support it seamlessly
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(c => ({
          phone: String(c.phone || ''),
          name: c.name || 'Friend',
          discount: c.discount || '20% OFF',
          link: c.link || 'http://localhost:3000'
        })).filter(c => c.phone.length >= 10);
      }
    } catch (e) {}
  }

  // Parse plain lines: "9791356364, Tamil Kavi" or "Tamil Kavi - 9791356364" or Excel paste
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0);
  const contacts = [];

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    // Detect 10-12 digit phone number
    const phoneMatch = raw.match(/(?:\+?91)?[6-9]\d{9}/);
    if (!phoneMatch) continue;

    const phone = phoneMatch[0];
    let name = raw.replace(phone, '').replace(/^[\s,\-\t:|]+|[\s,\-\t:|]+$/g, '').trim() || 'Friend';
    // Remove any extra quotes
    name = name.replace(/^["']|["']$/g, '').trim() || 'Friend';

    contacts.push({
      phone: phone,
      name: name,
      discount: '20% OFF',
      link: 'http://localhost:3000'
    });
  }

  return contacts;
}

function initCampaignBroadcaster() {
  const form = document.getElementById('formCampaign');
  const campDelay = document.getElementById('campDelay');
  const delayDisplay = document.getElementById('delayDisplay');
  const campTemplate = document.getElementById('campTemplate');
  const campContacts = document.getElementById('campContacts');
  const contactCountBadge = document.getElementById('contactCountBadge');
  const contactsPreviewList = document.getElementById('contactsPreviewList');
  const btnSampleContacts = document.getElementById('btnSampleContacts');
  const btnClearContacts = document.getElementById('btnClearContacts');
  const btnStart = document.getElementById('btnStartCampaign');
  const btnCancel = document.getElementById('btnCancelCampaign');

  // Live Contact Preview Update
  function updateContactsPreview() {
    const contacts = parseContactsInput(campContacts.value);
    if (contactCountBadge) {
      contactCountBadge.innerText = `${contacts.length} Contact${contacts.length === 1 ? '' : 's'} Detected`;
      contactCountBadge.className = contacts.length > 0 ? 'badge-pro' : 'badge-amber';
    }

    if (contactsPreviewList) {
      if (contacts.length === 0) {
        contactsPreviewList.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">No phone numbers found yet. Paste phone and name above!</span>`;
      } else {
        contactsPreviewList.innerHTML = contacts.slice(0, 50).map((c, idx) => `
          <div class="preview-contact-pill">
            <span class="pill-name">${idx + 1}. ${escapeHtml(c.name)}</span>
            <span class="pill-num">(${c.phone})</span>
          </div>
        `).join('') + (contacts.length > 50 ? `<span style="font-size:0.72rem; color:var(--text-muted); align-self:center;">+ ${contacts.length - 50} more</span>` : '');
      }
    }
  }

  // Initial preview & live input listener
  if (campContacts) {
    campContacts.addEventListener('input', updateContactsPreview);
    updateContactsPreview();
  }

  // Sample contacts button
  if (btnSampleContacts) {
    btnSampleContacts.addEventListener('click', () => {
      campContacts.value = 
`9791356364, Tamil Kavi
8148339677, Pooja Sharma
7708006124, Harish Narayanan`;
      updateContactsPreview();
      showToast('Sample contacts loaded!', 'info');
    });
  }

  // Clear button
  if (btnClearContacts) {
    btnClearContacts.addEventListener('click', () => {
      campContacts.value = '';
      updateContactsPreview();
    });
  }

  // Slider change
  campDelay.addEventListener('input', () => {
    const base = Number(campDelay.value);
    const min = Math.max(5, base - 5);
    const max = base + 10;
    delayDisplay.innerText = `${min} - ${max} seconds`;
  });

  // Variable tag buttons
  document.querySelectorAll('.btn-tag[data-insert]').forEach(tagBtn => {
    tagBtn.addEventListener('click', () => {
      const tag = tagBtn.getAttribute('data-insert');
      const startPos = campTemplate.selectionStart;
      const endPos = campTemplate.selectionEnd;
      campTemplate.value = campTemplate.value.substring(0, startPos) + tag + campTemplate.value.substring(endPos);
      campTemplate.focus();
    });
  });

  // Submit campaign
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.connected) {
      showToast('Please link your WhatsApp device first!', 'error');
      return;
    }

    const contacts = parseContactsInput(campContacts.value);
    if (!contacts || contacts.length === 0) {
      showToast('Please enter at least one valid phone number in the contacts list', 'error');
      return;
    }

    const name = document.getElementById('campName').value.trim();
    const template = campTemplate.value.trim();
    const baseDelay = Number(campDelay.value);
    const posterFile = document.getElementById('campPoster').files[0];

    const formData = new FormData();
    formData.append('name', name);
    formData.append('contacts', JSON.stringify(contacts));
    formData.append('template', template);
    formData.append('minDelaySec', Math.max(5, baseDelay - 5));
    formData.append('maxDelaySec', baseDelay + 10);
    if (posterFile) {
      formData.append('media', posterFile);
    }

    btnStart.disabled = true;
    btnStart.innerText = 'Starting Campaign...';

    try {
      const res = await fetch(`${API_BASE}/broadcast`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Campaign launched for ${data.totalContacts} recipients! 🚀`, 'success');
        btnCancel.style.display = 'inline-flex';
        startCampaignMonitoring();
      } else {
        showToast(`Error: ${data.error}`, 'error');
        btnStart.disabled = false;
        btnStart.innerText = '🚀 Launch Safe Campaign';
      }
    } catch (err) {
      showToast('Network error launching broadcast', 'error');
      btnStart.disabled = false;
      btnStart.innerText = '🚀 Launch Safe Campaign';
    }
  });

  // Cancel campaign
  btnCancel.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_BASE}/broadcast/cancel`, { method: 'POST' });
      const data = await res.json();
      showToast(data.message, 'info');
      btnCancel.style.display = 'none';
      btnStart.disabled = false;
      btnStart.innerText = '🚀 Launch Safe Campaign';
    } catch (err) {
      showToast('Failed to cancel campaign', 'error');
    }
  });
}

function startCampaignMonitoring() {
  if (appState.activeCampaignInterval) {
    clearInterval(appState.activeCampaignInterval);
  }

  const progressBar = document.getElementById('campaignProgressBar');
  const progressText = document.getElementById('campaignProgressText');
  const percentText = document.getElementById('campaignPercentText');
  const metricTotal = document.getElementById('metricTotal');
  const metricSent = document.getElementById('metricSent');
  const metricFailed = document.getElementById('metricFailed');
  const logsFeed = document.getElementById('campaignLogsFeed');
  const btnStart = document.getElementById('btnStartCampaign');
  const btnCancel = document.getElementById('btnCancelCampaign');

  appState.activeCampaignInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/broadcast/status`);
      const camp = await res.json();

      metricTotal.innerText = camp.total || 0;
      metricSent.innerText = camp.sent || 0;
      metricFailed.innerText = camp.failed || 0;

      progressBar.style.width = `${camp.progress || 0}%`;
      percentText.innerText = `${camp.progress || 0}%`;
      progressText.innerText = `Status: ${camp.status} (${camp.sent}/${camp.total})`;

      // Render logs
      if (camp.logs && camp.logs.length > 0) {
        logsFeed.innerHTML = camp.logs.map(log => `
          <div class="log-entry ${log.status.toLowerCase()}">
            <span><strong>${log.name || log.phone}</strong> (${log.phone})</span>
            <span class="log-status">${log.status} • ${log.time}</span>
          </div>
        `).join('');
      }

      if (!camp.isRunning && (camp.status === 'COMPLETED' || camp.status === 'CANCELLED' || camp.status === 'FAILED')) {
        clearInterval(appState.activeCampaignInterval);
        appState.activeCampaignInterval = null;
        btnStart.disabled = false;
        btnStart.innerText = '🚀 Launch Safe Campaign';
        btnCancel.style.display = 'none';
        showToast(`Campaign ${camp.status.toLowerCase()}! Total sent: ${camp.sent}`, 'success');
        loadInboxLogs();
      }
    } catch (err) {
      console.error('Error polling campaign status:', err);
    }
  }, 2000);
}

// --- LIVE INBOX & LOGS ---
async function loadInboxLogs() {
  try {
    const res = await fetch(`${API_BASE}/messages`);
    const data = await res.json();
    const inboxList = document.getElementById('inboxList');
    const badge = document.getElementById('inboxCountBadge');

    badge.innerText = data.total || 0;

    if (!data.messages || data.messages.length === 0) {
      inboxList.innerHTML = `
        <div class="empty-state">
          <p>No messages recorded yet. Connect and send a message to test!</p>
        </div>
      `;
      return;
    }

    inboxList.innerHTML = data.messages.map(msg => `
      <div class="inbox-item ${msg.direction}">
        <span class="inbox-badge-dir ${msg.direction === 'incoming' ? 'in' : 'out'}">
          ${msg.direction === 'incoming' ? 'INCOMING' : 'OUTGOING'}
        </span>
        <div class="inbox-content-col">
          <div class="inbox-meta-row">
            <span class="inbox-phone">${msg.phone}</span>
            <span class="inbox-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
          <p class="inbox-text">${escapeHtml(msg.content)}</p>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading inbox logs:', err);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- INITIALIZE APPLICATION ---
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initPairingMethods();
  initQuickSend();
  initEcommerceTriggers();
  initCampaignBroadcaster();

  btnRefreshStatus.addEventListener('click', () => {
    showToast('Refreshing status...', 'info');
    fetchStatus();
  });

  btnLogout.addEventListener('click', handleLogout);
  document.getElementById('btnRefreshLogs').addEventListener('click', () => {
    showToast('Logs refreshed', 'info');
    loadInboxLogs();
  });

  // Initial load
  fetchStatus();
  loadInboxLogs();

  // Poll status every 3 seconds for QR and connection changes
  setInterval(fetchStatus, 3000);
});
