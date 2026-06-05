// Global Application State
let currentToken = null;
let requests = [];
let selectedRequest = null;
let sseConnection = null;
let pinnedRequestIds = new Set(JSON.parse(localStorage.getItem('webhook_pinned') || '[]'));

// Initialize elements
const webhookUrlInput = document.getElementById('webhook-url');
const copyUrlBtn = document.getElementById('copy-url-btn');
const copyIcon = document.getElementById('copy-icon');
const copyTooltip = document.getElementById('copy-tooltip');
const newUrlBtn = document.getElementById('new-url-btn');
const clearRequestsBtn = document.getElementById('clear-requests-btn');
const requestSearch = document.getElementById('request-search');
const requestList = document.getElementById('request-list');
const requestCountBadge = document.getElementById('request-count-badge');
const welcomeView = document.getElementById('welcome-view');
const inspectorView = document.getElementById('inspector-view');
const contentPane = document.getElementById('content-pane');

// Config Drawer Elements
const openConfigBtn = document.getElementById('open-config-btn');
const closeConfigBtn = document.getElementById('close-config-btn');
const configDrawerOverlay = document.getElementById('config-drawer-overlay');
const configForm = document.getElementById('config-form');

// Detail Pane Elements
const detailMethod = document.getElementById('detail-method');
const detailTime = document.getElementById('detail-time');
const detailIp = document.getElementById('detail-ip');
const detailSize = document.getElementById('detail-size');
const headerCount = document.getElementById('header-count');
const queryCount = document.getElementById('query-count');
const headersTbody = document.getElementById('headers-tbody');
const queryTbody = document.getElementById('query-tbody');
const queryEmpty = document.getElementById('query-empty');
const bodyTypeBadge = document.getElementById('body-type-badge');
const bodyRawView = document.getElementById('body-raw-view');
const copyBodyBtn = document.getElementById('copy-body-btn');
const headerSearch = document.getElementById('header-search');
const bodySearch = document.getElementById('body-search');
const rawHttpView = document.getElementById('raw-http-view');
const copyRawBtn = document.getElementById('copy-raw-btn');
const toastContainer = document.getElementById('toast-container');

// On App Load
window.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
    setupIntegrationSnippetTabs();
    injectDownloadButton();
});

// Programmatically inject Download button next to Copy Body button
function injectDownloadButton() {
    const actionsContainer = document.querySelector('.body-tools-actions');
    if (actionsContainer) {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn btn-secondary btn-sm';
        downloadBtn.id = 'download-body-btn';
        downloadBtn.style.marginLeft = '0.5rem';
        downloadBtn.innerHTML = '<i data-lucide="download"></i> Download';
        actionsContainer.appendChild(downloadBtn);
        
        downloadBtn.addEventListener('click', () => {
            if (selectedRequest && selectedRequest.body) {
                const isJson = isJSONString(selectedRequest.body);
                const ext = isJson ? 'json' : 'txt';
                const type = isJson ? 'application/json' : 'text/plain';
                
                const blob = new Blob([selectedRequest.body], { type: type });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `webhook_payload_${selectedRequest.id}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('INFO', 'Download Started', 'The request payload is downloading.');
            }
        });
    }
}

// App Entrypoint
async function initApp() {
    currentToken = localStorage.getItem('webhook_flow_token');
    
    if (!currentToken) {
        await generateNewToken();
    } else {
        updateUIWithToken();
        await fetchRequestHistory();
        connectSSE();
    }
}

// Generate new token from backend
async function generateNewToken() {
    try {
        const res = await fetch('/token', { method: 'POST' });
        const data = await res.json();
        currentToken = data.token;
        localStorage.setItem('webhook_flow_token', currentToken);
        
        requests = [];
        selectedRequest = null;
        pinnedRequestIds.clear();
        localStorage.removeItem('webhook_pinned');
        
        updateUIWithToken();
        renderRequestList();
        showWelcomeView();
        connectSSE();
    } catch (err) {
        console.error('Error generating token:', err);
        showToast('ERROR', 'Session Failed', 'Could not establish new webhook session.');
    }
}

// Update token inputs and copy links in templates
function updateUIWithToken() {
    const fullUrl = `${window.location.origin}/w/${currentToken}`;
    webhookUrlInput.value = fullUrl;
    
    document.querySelectorAll('.placeholder-url').forEach(el => {
        el.textContent = fullUrl;
    });
}

// Fetch existing request history from server
async function fetchRequestHistory() {
    try {
        const res = await fetch(`/api/requests/${currentToken}`);
        requests = await res.json();
        requests.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
        renderRequestList();
    } catch (err) {
        console.error('Error fetching request history:', err);
    }
}

// Establish SSE Connection for real-time updates
function connectSSE() {
    if (sseConnection) {
        sseConnection.close();
    }
    
    sseConnection = new EventSource(`/api/stream/${currentToken}`);
    
    sseConnection.onmessage = (event) => {
        try {
            const newReq = JSON.parse(event.data);
            
            requests.unshift(newReq);
            renderRequestList();
            
            // Show toast notification
            showToast(newReq.method, `Request #${newReq.id.substring(newReq.id.lastIndexOf('_') + 1)}`, `Captured from ${newReq.remote_addr}`);
            
            requestCountBadge.classList.add('pulse-radar');
            setTimeout(() => requestCountBadge.classList.remove('pulse-radar'), 1000);
        } catch (err) {
            console.error('Error parsing real-time request:', err);
        }
    };
}

// Render the sidebar request list supporting pinning & deletion
function renderRequestList() {
    const query = requestSearch.value.toLowerCase().trim();
    
    // Filter requests
    const filteredRequests = requests.filter(req => {
        if (!query) return true;
        const methodMatch = req.method.toLowerCase().includes(query);
        const pathMatch = req.id.toLowerCase().includes(query) || req.remote_addr.toLowerCase().includes(query);
        const bodyMatch = req.body && req.body.toLowerCase().includes(query);
        return methodMatch || pathMatch || bodyMatch;
    });
    
    // Sort so Pinned requests are at the top, then sort by time descending
    filteredRequests.sort((a, b) => {
        const aPinned = pinnedRequestIds.has(a.id);
        const bPinned = pinnedRequestIds.has(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return new Date(b.received_at) - new Date(a.received_at);
    });
    
    requestCountBadge.textContent = filteredRequests.length;
    
    if (filteredRequests.length === 0) {
        requestList.innerHTML = `
            <div class="sidebar-empty">
                <div class="pulse-radar">
                    <div class="radar-wave"></div>
                    <div class="radar-center"></div>
                </div>
                <p class="empty-title">${query ? 'No matching webhooks' : 'Waiting for webhooks'}</p>
                <p class="empty-subtitle">${query ? 'Try altering your filter query' : 'Send an HTTP request to your URL above to see it instantly.'}</p>
            </div>
        `;
        return;
    }
    
    requestList.innerHTML = '';
    filteredRequests.forEach(req => {
        const isSelected = selectedRequest && selectedRequest.id === req.id;
        const isPinned = pinnedRequestIds.has(req.id);
        
        const item = document.createElement('div');
        item.className = `request-item ${isSelected ? 'active' : ''} ${isPinned ? 'pinned-item' : ''}`;
        item.dataset.id = req.id;
        
        const time = new Date(req.received_at);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const reqShortId = req.id.substring(req.id.lastIndexOf('_') + 1);
        
        item.innerHTML = `
            <span class="method-badge method-${req.method}">${req.method}</span>
            <div class="req-info">
                <span class="req-path">#${reqShortId}</span>
                <div class="req-meta">
                    <span>${req.remote_addr}</span>
                    <span>${dateStr} ${timeStr}</span>
                </div>
            </div>
            <div class="request-actions">
                <button class="action-btn btn-pin ${isPinned ? 'btn-pin-active' : ''}" title="${isPinned ? 'Unpin' : 'Pin'} request">
                    <i data-lucide="${isPinned ? 'pin-off' : 'pin'}"></i>
                </button>
                <button class="action-btn btn-delete-item" title="Delete request">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        
        // Selection trigger
        item.addEventListener('click', (e) => {
            // Avoid selecting if clicking inside action buttons
            if (e.target.closest('.request-actions')) return;
            selectRequest(req);
        });
        
        // Pin trigger
        item.querySelector('.btn-pin').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePinRequest(req.id);
        });
        
        // Delete trigger
        item.querySelector('.btn-delete-item').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRequest(req.id);
        });
        
        requestList.appendChild(item);
    });
    
    lucide.createIcons();
}

// Toggle pinning a request
function togglePinRequest(id) {
    if (pinnedRequestIds.has(id)) {
        pinnedRequestIds.delete(id);
        showToast('INFO', 'Request Unpinned', 'The request has been unpinned.');
    } else {
        pinnedRequestIds.add(id);
        showToast('INFO', 'Request Pinned', 'The request is now pinned at the top.');
    }
    localStorage.setItem('webhook_pinned', JSON.stringify([...pinnedRequestIds]));
    renderRequestList();
}

// Delete a single request
function deleteRequest(id) {
    requests = requests.filter(r => r.id !== id);
    pinnedRequestIds.delete(id);
    localStorage.setItem('webhook_pinned', JSON.stringify([...pinnedRequestIds]));
    
    if (selectedRequest && selectedRequest.id === id) {
        showWelcomeView();
    }
    
    renderRequestList();
    showToast('INFO', 'Request Deleted', 'Captured request removed from history.');
}

// Select a request and load details
function selectRequest(req) {
    selectedRequest = req;
    bodySearch.value = ''; // Reset search body query
    
    document.querySelectorAll('.request-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.id === req.id) {
            item.classList.add('active');
        }
    });
    
    welcomeView.classList.add('hidden');
    inspectorView.classList.remove('hidden');
    
    // Fill Cards
    detailMethod.textContent = req.method;
    detailMethod.className = `card-val method-badge method-${req.method}`;
    detailMethod.style.display = 'inline-block';
    
    const time = new Date(req.received_at);
    detailTime.textContent = time.toLocaleString();
    detailIp.textContent = req.remote_addr;
    detailSize.textContent = formatBytes(req.content_length);
    
    renderHeaders();
    renderQueryParams();
    renderBody();
    renderRawHttp();
    
    lucide.createIcons();
}

function showWelcomeView() {
    welcomeView.classList.remove('hidden');
    inspectorView.classList.add('hidden');
    selectedRequest = null;
}

// Render Headers Table
function renderHeaders() {
    const headers = selectedRequest.headers || {};
    const keys = Object.keys(headers).sort();
    headerCount.textContent = keys.length;
    
    const query = headerSearch.value.toLowerCase().trim();
    headersTbody.innerHTML = '';
    
    let matched = 0;
    keys.forEach(key => {
        const val = headers[key].join(', ');
        
        if (query && !key.toLowerCase().includes(query) && !val.toLowerCase().includes(query)) {
            return;
        }
        
        matched++;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHTML(key)}</td>
            <td>${escapeHTML(val)}</td>
        `;
        headersTbody.appendChild(row);
    });
    
    if (matched === 0) {
        headersTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-muted);">No headers match your search.</td></tr>`;
    }
}

// Render Query Params Table
function renderQueryParams() {
    const qparams = selectedRequest.query_params || {};
    const keys = Object.keys(qparams).sort();
    queryCount.textContent = keys.length;
    
    queryTbody.innerHTML = '';
    
    if (keys.length === 0) {
        queryEmpty.classList.remove('hidden');
        document.querySelector('#tab-query .table-container').classList.add('hidden');
        return;
    }
    
    queryEmpty.classList.add('hidden');
    document.querySelector('#tab-query .table-container').classList.remove('hidden');
    
    keys.forEach(key => {
        const val = qparams[key].join(', ');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHTML(key)}</td>
            <td>${escapeHTML(val)}</td>
        `;
        queryTbody.appendChild(row);
    });
}

// Render Request Body with live highlighting support
function renderBody() {
    const body = selectedRequest.body || '';
    
    if (!body) {
        bodyTypeBadge.textContent = 'Empty';
        bodyTypeBadge.className = 'body-type-badge';
        bodyRawView.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">Request body is empty</span>';
        copyBodyBtn.disabled = true;
        return;
    }
    
    copyBodyBtn.disabled = false;
    
    const isJson = isJSONString(body);
    let htmlContent = '';
    
    if (isJson) {
        bodyTypeBadge.textContent = 'JSON';
        bodyTypeBadge.className = 'body-type-badge method-POST';
        const parsed = JSON.parse(body);
        const pretty = JSON.stringify(parsed, null, 2);
        htmlContent = syntaxHighlightJSON(pretty);
    } else {
        bodyTypeBadge.textContent = 'Plain Text';
        bodyTypeBadge.className = 'body-type-badge method-GET';
        htmlContent = escapeHTML(body);
    }
    
    // Check if query highlight is active
    const query = bodySearch.value.trim();
    if (query) {
        htmlContent = highlightHTMLContent(htmlContent, query);
    }
    
    bodyRawView.innerHTML = htmlContent;
}

// Format and construct Raw HTTP Request Dump
function renderRawHttp() {
    let raw = `${selectedRequest.method} /w/${currentToken} HTTP/1.1\r\n`;
    raw += `Host: ${window.location.host}\r\n`;
    
    const headers = selectedRequest.headers || {};
    Object.keys(headers).forEach(key => {
        raw += `${key}: ${headers[key].join(', ')}\r\n`;
    });
    
    raw += `Content-Length: ${selectedRequest.content_length}\r\n\r\n`;
    
    if (selectedRequest.body) {
        raw += selectedRequest.body;
    }
    
    rawHttpView.textContent = raw;
}

// Toast Notification Manager
function showToast(method, title, subtitle) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    // Pick border color based on HTTP Method or Info
    if (method === 'INFO') {
        toast.style.borderLeftColor = 'var(--color-secondary)';
    } else if (method === 'ERROR') {
        toast.style.borderLeftColor = 'var(--color-delete)';
    } else {
        toast.style.borderLeftColor = `var(--color-${method.toLowerCase()})`;
    }
    
    const badgeHtml = (method !== 'INFO' && method !== 'ERROR') 
        ? `<span class="method-badge method-${method}" style="margin-right: 0.5rem; transform: scale(0.9);">${method}</span>` 
        : '';
        
    toast.innerHTML = `
        <div class="toast-body">
            <span class="toast-title">${badgeHtml}${escapeHTML(title)}</span>
            <span class="toast-subtitle">${escapeHTML(subtitle)}</span>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Slide out and destroy
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.35s forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4500);
}

// Setup all event handlers
function setupEventListeners() {
    // Copy URL
    copyUrlBtn.addEventListener('click', () => {
        const fullUrl = `${window.location.origin}/w/${currentToken}`;
        navigator.clipboard.writeText(fullUrl).then(() => {
            copyIcon.setAttribute('data-lucide', 'check');
            copyIcon.style.color = 'var(--color-post)';
            copyTooltip.textContent = 'Copied!';
            lucide.createIcons();
            
            setTimeout(() => {
                copyIcon.setAttribute('data-lucide', 'copy');
                copyIcon.style.color = '';
                copyTooltip.textContent = 'Copy URL';
                lucide.createIcons();
            }, 1500);
        });
    });
    
    // New Webhook URL
    newUrlBtn.addEventListener('click', () => {
        if (confirm('Create a new Webhook URL? Your request history for this URL will be lost.')) {
            generateNewToken();
        }
    });
    
    // Clear Requests
    clearRequestsBtn.addEventListener('click', () => {
        if (requests.length > 0 && confirm('Clear captured requests list? This cannot be undone.')) {
            requests = [];
            showWelcomeView();
            renderRequestList();
            showToast('INFO', 'History Cleared', 'All captured webhooks have been deleted.');
        }
    });
    
    // Copy Body Button
    copyBodyBtn.addEventListener('click', () => {
        if (selectedRequest && selectedRequest.body) {
            navigator.clipboard.writeText(selectedRequest.body).then(() => {
                const originalText = copyBodyBtn.innerHTML;
                copyBodyBtn.innerHTML = '<i data-lucide="check"></i> Copied';
                copyBodyBtn.style.borderColor = 'var(--color-post)';
                copyBodyBtn.style.color = 'var(--color-post)';
                lucide.createIcons();
                
                setTimeout(() => {
                    copyBodyBtn.innerHTML = originalText;
                    copyBodyBtn.style.borderColor = '';
                    copyBodyBtn.style.color = '';
                    lucide.createIcons();
                }, 1500);
            });
        }
    });
    
    // Copy Raw Dump Button
    copyRawBtn.addEventListener('click', () => {
        if (rawHttpView.textContent) {
            navigator.clipboard.writeText(rawHttpView.textContent).then(() => {
                const originalText = copyRawBtn.innerHTML;
                copyRawBtn.innerHTML = '<i data-lucide="check"></i> Copied';
                copyRawBtn.style.borderColor = 'var(--color-post)';
                copyRawBtn.style.color = 'var(--color-post)';
                lucide.createIcons();
                
                setTimeout(() => {
                    copyRawBtn.innerHTML = originalText;
                    copyRawBtn.style.borderColor = '';
                    copyRawBtn.style.color = '';
                    lucide.createIcons();
                }, 1500);
            });
        }
    });
    
    // Config Drawer Triggers
    openConfigBtn.addEventListener('click', async () => {
        configDrawerOverlay.classList.remove('hidden');
        try {
            const res = await fetch(`/api/response/${currentToken}`);
            const config = await res.json();
            document.getElementById('resp-status').value = config.status_code || 200;
            document.getElementById('resp-content-type').value = config.content_type || 'text/plain';
            document.getElementById('resp-body').value = config.body || 'ok';
        } catch (err) {
            console.error('Error fetching response config:', err);
        }
    });
    
    closeConfigBtn.addEventListener('click', () => {
        configDrawerOverlay.classList.add('hidden');
    });
    
    configDrawerOverlay.addEventListener('click', (e) => {
        if (e.target === configDrawerOverlay) {
            configDrawerOverlay.classList.add('hidden');
        }
    });
    
    // Save Config Form
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const config = {
            status_code: parseInt(document.getElementById('resp-status').value, 10),
            content_type: document.getElementById('resp-content-type').value,
            body: document.getElementById('resp-body').value
        };
        
        try {
            const res = await fetch(`/api/response/${currentToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            if (res.ok) {
                showToast('INFO', 'Config Saved', 'Webhook response settings updated successfully.');
                configDrawerOverlay.classList.add('hidden');
            } else {
                showToast('ERROR', 'Save Failed', 'Server rejected configuration payload.');
            }
        } catch (err) {
            console.error('Error saving response config:', err);
            showToast('ERROR', 'Save Failed', 'Network failure while saving settings.');
        }
    });
    
    // Sidebar Filter
    requestSearch.addEventListener('input', () => {
        renderRequestList();
    });
    
    // Header Filter
    headerSearch.addEventListener('input', () => {
        renderHeaders();
    });
    
    // Live Search Body Highlighter
    bodySearch.addEventListener('input', () => {
        renderBody();
    });
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const target = btn.dataset.tab;
            document.getElementById(target).classList.add('active');
        });
    });
}

// Setup snippet language toggle tabs
function setupIntegrationSnippetTabs() {
    document.querySelectorAll('.snippet-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.snippet-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.snippet-pre').forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            const lang = tab.dataset.lang;
            document.getElementById(`snippet-code-${lang}`).classList.add('active');
        });
    });
}

// Utility: Pretty format JSON keys, strings, values
function syntaxHighlightJSON(json) {
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
        let cls = 'number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'key';
            } else {
                cls = 'string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'boolean';
        } else if (/null/.test(match)) {
            cls = 'null';
        }
        return `<span class="${cls}">${match}</span>`;
    });
}

// Highlight query matches inside formatted HTML strings without breaking tag syntax
function highlightHTMLContent(html, query) {
    if (!query) return html;
    // Escape regex characters
    const escaped = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Regex matches keyword outside tags (i.e., looking ahead for a '<' before any '>')
    const regex = new RegExp(`(${escaped})(?=[^>]*<)`, 'gi');
    return html.replace(regex, '<span class="highlight">$1</span>');
}

// Check if string is a valid JSON string
function isJSONString(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

// Utility: Format content length
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Utility: Escape HTML tags
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// Helper: Global copyText function for inline elements
function copyText(elementId) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('INFO', 'Snippet Copied', 'Code snippet copied to clipboard.');
    });
}
