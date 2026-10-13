/**
 * PromptPilot — Background Service Worker
 * 
 * Event-driven service worker for Chrome Extension MV3.
 * Routes messages between content script and popup,
 * manages extension state, and tracks usage statistics.
 */

// ═══════════════════════════════════════════════
// INSTALLATION & SETUP
// ═══════════════════════════════════════════════

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[PromptPilot] Extension installed');

    // Set default settings
    chrome.storage.local.set({
      settings: {
        defaultMode: 'balanced',
        backendUrl: 'http://localhost:8000',
        useBackend: false,
        options: {
          removeRepetition: true,
          preserveRequirements: true,
          preserveCode: true,
          summarizeHistory: true,
          redactSecrets: true
        }
      },
      stats: {
        totalOptimizations: 0,
        totalTokensSaved: 0,
        totalOriginalTokens: 0,
        sessionHistory: []
      }
    });

  } else if (details.reason === 'update') {
    console.log(`[PromptPilot] Updated to v${chrome.runtime.getManifest().version}`);
  }
});

// ═══════════════════════════════════════════════
// MESSAGE ROUTING
// ═══════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  switch (message.action) {
    
    // Content script captured text via FAB click
    case 'textCaptured':
      handleTextCaptured(message.data, sender);
      sendResponse({ received: true });
      break;

    // Popup requests page info from content script
    case 'getPageInfo':
      forwardToContentScript(message, sendResponse);
      return true; // async response

    // Record optimization stats
    case 'recordOptimization':
      recordOptimization(message.data);
      sendResponse({ recorded: true });
      break;

    // Get stats
    case 'getStats':
      chrome.storage.local.get('stats', (result) => {
        sendResponse(result.stats || {});
      });
      return true; // async response

    // Get settings
    case 'getSettings':
      chrome.storage.local.get('settings', (result) => {
        sendResponse(result.settings || {});
      });
      return true; // async response

    // Save settings
    case 'saveSettings':
      chrome.storage.local.set({ settings: message.data });
      sendResponse({ saved: true });
      break;

    default:
      console.log('[PromptPilot] Unknown message action:', message.action);
      sendResponse({ error: 'Unknown action' });
  }
});

// ═══════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════

/**
 * Handle text captured from content script.
 * Store it in session storage for popup to consume.
 */
function handleTextCaptured(data, sender) {
  chrome.storage.session.set({
    capturedText: {
      text: data.text,
      source: data.source,
      tabId: sender.tab?.id,
      url: sender.tab?.url,
      timestamp: Date.now()
    }
  });

  // Show badge to indicate captured text
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

  // Clear badge after 5 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
}

/**
 * Forward a message to the active tab's content script.
 */
async function forwardToContentScript(message, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      sendResponse(response);
    } else {
      sendResponse({ error: 'No active tab' });
    }
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

/**
 * Record optimization statistics.
 */
async function recordOptimization(data) {
  try {
    const result = await chrome.storage.local.get('stats');
    const stats = result.stats || {
      totalOptimizations: 0,
      totalTokensSaved: 0,
      totalOriginalTokens: 0,
      sessionHistory: []
    };

    stats.totalOptimizations++;
    stats.totalTokensSaved += (data.originalTokens - data.compressedTokens);
    stats.totalOriginalTokens += data.originalTokens;

    // Keep last 50 optimizations in history
    stats.sessionHistory.unshift({
      timestamp: Date.now(),
      originalTokens: data.originalTokens,
      compressedTokens: data.compressedTokens,
      reduction: data.reduction,
      mode: data.mode
    });

    if (stats.sessionHistory.length > 50) {
      stats.sessionHistory = stats.sessionHistory.slice(0, 50);
    }

    await chrome.storage.local.set({ stats });
  } catch (err) {
    console.error('[PromptPilot] Stats recording error:', err);
  }
}

// ═══════════════════════════════════════════════
// CONTEXT MENU (optional future enhancement)
// ═══════════════════════════════════════════════

// Can add right-click context menu for "Optimize selected text"
// chrome.contextMenus.create({
//   id: 'promptpilot-optimize',
//   title: 'Optimize with PromptPilot',
//   contexts: ['selection']
// });

console.log('[PromptPilot] Service worker initialized');
