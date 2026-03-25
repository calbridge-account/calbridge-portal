// Calbridge — AI Chat Widget
// Injected into dashboard.html and advertising.html

(function () {
  'use strict';

  // ----- State -----
  let isOpen = false;
  let isTyping = false;

  // ----- Init -----
  function init() {
    injectHTML();
    bindEvents();
    loadHistory();
  }

  // ----- Inject DOM -----
  function injectHTML() {
    const el = document.createElement('div');
    el.id = 'cb-chat-root';
    el.innerHTML = `
      <!-- Bubble button -->
      <button id="cb-chat-bubble" title="Ask Calbridge AI" aria-label="Open AI chat">
        <span id="cb-chat-bubble-icon">💬</span>
      </button>

      <!-- Chat panel -->
      <div id="cb-chat-panel" class="cb-chat-hidden" role="dialog" aria-label="Calbridge AI Assistant">
        <div id="cb-chat-header">
          <div id="cb-chat-title">
            <span>⚡</span>
            <span>Calbridge AI</span>
            <span id="cb-chat-subtitle">Ask anything about your data</span>
          </div>
          <div id="cb-chat-header-actions">
            <button id="cb-clear-btn" title="Clear history">🗑</button>
            <button id="cb-close-btn" title="Close">✕</button>
          </div>
        </div>

        <div id="cb-chat-messages">
          <div class="cb-msg cb-msg-assistant">
            <div class="cb-msg-bubble">
              Hi! I'm your Calbridge AI assistant. Ask me anything about your Amazon advertising performance, contribution margin, or top/bottom ASINs.
            </div>
          </div>
        </div>

        <div id="cb-typing-indicator" class="cb-hidden">
          <div class="cb-typing-dots"><span></span><span></span><span></span></div>
        </div>

        <div id="cb-chat-input-row">
          <textarea
            id="cb-chat-input"
            placeholder="Ask a question about your data…"
            rows="1"
            maxlength="1000"
          ></textarea>
          <button id="cb-send-btn" title="Send">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  // ----- Events -----
  function bindEvents() {
    document.getElementById('cb-chat-bubble').addEventListener('click', togglePanel);
    document.getElementById('cb-close-btn').addEventListener('click', closePanel);
    document.getElementById('cb-send-btn').addEventListener('click', sendMessage);
    document.getElementById('cb-clear-btn').addEventListener('click', clearHistory);

    const input = document.getElementById('cb-chat-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  // ----- Panel open/close -----
  function togglePanel() {
    isOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    isOpen = true;
    document.getElementById('cb-chat-panel').classList.remove('cb-chat-hidden');
    document.getElementById('cb-chat-bubble-icon').textContent = '✕';
    document.getElementById('cb-chat-input').focus();
    scrollToBottom();
  }

  function closePanel() {
    isOpen = false;
    document.getElementById('cb-chat-panel').classList.add('cb-chat-hidden');
    document.getElementById('cb-chat-bubble-icon').textContent = '💬';
  }

  // ----- Load history from session -----
  async function loadHistory() {
    try {
      const res = await fetch('/chat/history', { credentials: 'include' });
      if (!res.ok) return;
      const { history } = await res.json();
      if (!history || history.length === 0) return;
      // Render existing history messages (skip system prompts)
      const container = document.getElementById('cb-chat-messages');
      history.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
          appendMessage(msg.role, msg.content, false);
        }
      });
    } catch (e) { /* silent */ }
  }

  // ----- Send message -----
  async function sendMessage() {
    if (isTyping) return;
    const input = document.getElementById('cb-chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    appendMessage('user', text);
    showTyping(true);

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });

      const data = await res.json();

      if (!res.ok) {
        showTyping(false);
        if (res.status === 503) {
          appendMessage('assistant', '⚠️ AI chat is not configured on this portal yet.');
        } else {
          appendMessage('assistant', `⚠️ Error: ${data.error || 'Something went wrong'}`);
        }
        return;
      }

      showTyping(false);
      appendMessage('assistant', data.reply);
    } catch (e) {
      showTyping(false);
      appendMessage('assistant', '⚠️ Could not reach the server. Please try again.');
    }
  }

  // ----- Clear history -----
  async function clearHistory() {
    try {
      await fetch('/chat/history', { method: 'DELETE', credentials: 'include' });
      const container = document.getElementById('cb-chat-messages');
      container.innerHTML = `
        <div class="cb-msg cb-msg-assistant">
          <div class="cb-msg-bubble">Chat history cleared. Ask me anything about your Amazon data!</div>
        </div>
      `;
    } catch (e) { /* silent */ }
  }

  // ----- Helpers -----
  function appendMessage(role, text, scroll = true) {
    const container = document.getElementById('cb-chat-messages');
    const div = document.createElement('div');
    div.className = `cb-msg cb-msg-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'cb-msg-bubble';
    // Preserve line breaks and light markdown-ish formatting
    bubble.innerHTML = formatText(text);

    div.appendChild(bubble);
    container.appendChild(div);
    if (scroll) scrollToBottom();
  }

  function formatText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Bold **text**
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Bullet points
      .replace(/^[-•] (.+)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  function showTyping(visible) {
    isTyping = visible;
    const el = document.getElementById('cb-typing-indicator');
    const sendBtn = document.getElementById('cb-send-btn');
    el.classList.toggle('cb-hidden', !visible);
    sendBtn.disabled = visible;
    if (visible) scrollToBottom();
  }

  function scrollToBottom() {
    const container = document.getElementById('cb-chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  // ----- Boot -----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
