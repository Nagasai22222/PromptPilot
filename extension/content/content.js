/**
 * PromptPilot — Content Script
 * 
 * Injected into AI assistant websites (ChatGPT, Gemini, Claude).
 * Responsible for:
 * - Detecting which AI platform the user is on
 * - Extracting text from prompt areas and conversations
 * - Injecting a floating PromptPilot action button
 * - Communicating with the service worker and popup
 */

(() => {
  'use strict';

  // ═══════════════════════════════════════════════
  // SITE DETECTION & SELECTORS
  // ═══════════════════════════════════════════════

  const SITES = {
    chatgpt: {
      name: 'ChatGPT',
      hostPatterns: ['chat.openai.com', 'chatgpt.com'],
      selectors: {
        promptArea: '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][id="prompt-textarea"]',
        conversation: '[data-message-author-role]',
        userMessages: '[data-message-author-role="user"]',
        assistantMessages: '[data-message-author-role="assistant"]',
        submitButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
        chatContainer: 'main .flex.flex-col'
      }
    },
    gemini: {
      name: 'Gemini',
      hostPatterns: ['gemini.google.com'],
      selectors: {
        promptArea: '.ql-editor, div[contenteditable="true"][aria-label*="prompt"], .text-input-field textarea, rich-textarea .ql-editor',
        conversation: '.conversation-container message-content, .response-container',
        userMessages: '.query-content, user-query',
        assistantMessages: '.response-content, model-response',
        submitButton: 'button[aria-label="Send message"], .send-button',
        chatContainer: '.conversation-container'
      }
    },
    claude: {
      name: 'Claude',
      hostPatterns: ['claude.ai'],
      selectors: {
        promptArea: 'div[contenteditable="true"][translate="no"], div[contenteditable="true"].ProseMirror, fieldset div[contenteditable]',
        conversation: '[data-testid="conversation-turn"], .font-claude-message',
        userMessages: '[data-testid="user-message"]',
        assistantMessages: '[data-testid="assistant-message"], .font-claude-message',
        submitButton: 'button[aria-label="Send Message"], button[type="submit"]',
        chatContainer: '.flex-1.flex.flex-col'
      }
    }
  };

  // ═══════════════════════════════════════════════
  // DETECT CURRENT SITE
  // ═══════════════════════════════════════════════

  function detectSite() {
    const hostname = window.location.hostname;
    for (const [key, site] of Object.entries(SITES)) {
      if (site.hostPatterns.some(pattern => hostname.includes(pattern))) {
        return { key, ...site };
      }
    }
    return null;
  }

  const currentSite = detectSite();
  if (!currentSite) return; // Not on a supported site

  console.log(`[PromptPilot] Detected: ${currentSite.name}`);

  // ═══════════════════════════════════════════════
  // TEXT EXTRACTION
  // ═══════════════════════════════════════════════

  /**
   * Extract text from the current prompt area.
   * @returns {string|null}
   */
  function extractPromptText() {
    const el = document.querySelector(currentSite.selectors.promptArea);
    if (!el) return null;

    // Handle contenteditable divs
    if (el.getAttribute('contenteditable') === 'true') {
      return el.innerText || el.textContent || null;
    }

    // Handle textareas
    if (el.tagName === 'TEXTAREA') {
      return el.value || null;
    }

    // Handle Quill editors (Gemini)
    if (el.classList.contains('ql-editor')) {
      return el.innerText || null;
    }

    return el.textContent || null;
  }

  /**
   * Extract selected text from the page.
   * @returns {string|null}
   */
  function extractSelectedText() {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      return selection.toString().trim();
    }
    return null;
  }

  /**
   * Extract full conversation history.
   * @returns {string}
   */
  function extractConversation() {
    const parts = [];

    // Try to get user messages
    const userEls = document.querySelectorAll(currentSite.selectors.userMessages);
    const assistantEls = document.querySelectorAll(currentSite.selectors.assistantMessages);

    // Interleave user and assistant messages
    const allMessages = [];

    userEls.forEach(el => {
      allMessages.push({
        role: 'user',
        text: el.innerText || el.textContent || '',
        order: getElementOrder(el)
      });
    });

    assistantEls.forEach(el => {
      allMessages.push({
        role: 'assistant',
        text: el.innerText || el.textContent || '',
        order: getElementOrder(el)
      });
    });

    // Sort by DOM order
    allMessages.sort((a, b) => a.order - b.order);

    for (const msg of allMessages) {
      const role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
      parts.push(`[${role}]\n${msg.text.trim()}`);
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Get a rough DOM order for an element.
   */
  function getElementOrder(el) {
    // Use element's position in the document
    const rect = el.getBoundingClientRect();
    return rect.top + window.scrollY;
  }

  /**
   * Main extraction function — tries multiple sources.
   * @returns {{ text: string, source: string }}
   */
  function extractText() {
    // Priority: 1. Selected text, 2. Prompt area, 3. Full conversation
    const selected = extractSelectedText();
    if (selected && selected.length > 10) {
      return { text: selected, source: 'selection' };
    }

    const prompt = extractPromptText();
    if (prompt && prompt.trim().length > 5) {
      return { text: prompt.trim(), source: 'prompt' };
    }

    const conversation = extractConversation();
    if (conversation && conversation.length > 10) {
      return { text: conversation, source: 'conversation' };
    }

    return { text: '', source: 'none' };
  }

  // ═══════════════════════════════════════════════
  // FLOATING ACTION BUTTON
  // ═══════════════════════════════════════════════

  function injectFloatingButton() {
    // Check if already injected
    if (document.getElementById('promptpilot-fab')) return;

    const fab = document.createElement('div');
    fab.id = 'promptpilot-fab';
    fab.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
        <path d="M14 2L18 8L26 10L20 16L21.5 24L14 20L6.5 24L8 16L2 10L10 8L14 2Z" 
              fill="url(#ppFabGrad)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
        <path d="M14 7L16 11L20 12L17 15L17.5 19L14 17L10.5 19L11 15L8 12L12 11L14 7Z" 
              fill="rgba(255,255,255,0.9)"/>
        <defs>
          <linearGradient id="ppFabGrad" x1="2" y1="2" x2="26" y2="24">
            <stop offset="0%" stop-color="#818cf8"/>
            <stop offset="100%" stop-color="#06b6d4"/>
          </linearGradient>
        </defs>
      </svg>
    `;

    // Styles
    Object.assign(fab.style, {
      position: 'fixed',
      bottom: '80px',
      right: '24px',
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #1e1b4b, #0f172a)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 0 24px rgba(99, 102, 241, 0.15)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '999999',
      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      opacity: '0.85'
    });

    fab.addEventListener('mouseenter', () => {
      fab.style.transform = 'scale(1.1)';
      fab.style.opacity = '1';
      fab.style.boxShadow = '0 6px 24px rgba(0,0,0,0.4), 0 0 32px rgba(99, 102, 241, 0.25)';
    });

    fab.addEventListener('mouseleave', () => {
      fab.style.transform = 'scale(1)';
      fab.style.opacity = '0.85';
      fab.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3), 0 0 24px rgba(99, 102, 241, 0.15)';
    });

    fab.addEventListener('click', () => {
      // Extract text and send to service worker for popup consumption
      const extracted = extractText();
      if (extracted.text) {
        chrome.runtime.sendMessage({
          action: 'textCaptured',
          data: extracted
        });
      }
    });

    fab.title = 'PromptPilot — Optimize this prompt';
    document.body.appendChild(fab);
  }

  // ═══════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'extractText') {
      const result = extractText();
      sendResponse(result);
    }

    if (message.action === 'getPageInfo') {
      sendResponse({
        site: currentSite.name,
        url: window.location.href,
        hasPrompt: !!document.querySelector(currentSite.selectors.promptArea),
        hasConversation: document.querySelectorAll(currentSite.selectors.conversation).length > 0
      });
    }

    if (message.action === 'injectText') {
      // Insert optimized text back into the prompt area
      const el = document.querySelector(currentSite.selectors.promptArea);
      if (el) {
        if (el.getAttribute('contenteditable') === 'true') {
          el.innerText = message.text;
          // Trigger input event for React/framework state sync
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (el.tagName === 'TEXTAREA') {
          el.value = message.text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Prompt area not found' });
      }
    }

    // Return true to indicate async response
    return true;
  });

  // ═══════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════

  // Wait for page to be ready, then inject FAB
  function init() {
    // Delay injection slightly to ensure page is fully loaded
    setTimeout(() => {
      injectFloatingButton();
    }, 2000);

    // Re-inject if FAB gets removed (SPA navigation)
    const observer = new MutationObserver(() => {
      if (!document.getElementById('promptpilot-fab')) {
        injectFloatingButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: false
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[PromptPilot] Content script loaded for', currentSite.name);
})();
