/**
 * PromptPilot — Popup Controller
 * 
 * Manages the popup UI: input handling, live token counting,
 * compression triggering, result display, and clipboard operations.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM References ──
  const inputText = document.getElementById('inputText');
  const charCount = document.getElementById('charCount');
  const liveTokenCount = document.getElementById('liveTokenCount');
  const originalTokens = document.getElementById('originalTokens');
  const compressedTokens = document.getElementById('compressedTokens');
  const reductionContainer = document.getElementById('reductionContainer');
  const reductionRing = document.getElementById('reductionRing');
  const reductionPercent = document.getElementById('reductionPercent');
  const statsSection = document.getElementById('statsSection');
  const resultsSection = document.getElementById('resultsSection');
  const resultOutput = document.getElementById('resultOutput');
  const changesLog = document.getElementById('changesLog');
  const changesList = document.getElementById('changesList');

  const btnOptimize = document.getElementById('btnOptimize');
  const btnCapture = document.getElementById('btnCapture');
  const btnClear = document.getElementById('btnClear');
  const btnCopyResult = document.getElementById('btnCopyResult');
  const btnShowDiff = document.getElementById('btnShowDiff');

  // State
  let lastCompressed = '';
  let isProcessing = false;

  // ── Inject SVG gradient for the reduction ring ──
  injectRingGradient();

  // ── Load saved state ──
  loadState();

  // ══════════════════════════════════════════
  // EVENT LISTENERS
  // ══════════════════════════════════════════

  // Live token counting with debounce
  let debounceTimer;
  inputText.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateLiveTokenCount();
      saveState();
    }, 150);
  });

  // Optimize button
  btnOptimize.addEventListener('click', handleOptimize);

  // Capture from active tab
  btnCapture.addEventListener('click', handleCapture);

  // Clear input
  btnClear.addEventListener('click', () => {
    inputText.value = '';
    updateLiveTokenCount();
    hideResults();
    saveState();
  });

  // Copy result
  btnCopyResult.addEventListener('click', () => {
    if (!lastCompressed) return;
    navigator.clipboard.writeText(lastCompressed).then(() => {
      showCopiedFeedback(btnCopyResult);
      showToast('Copied to clipboard!');
    });
  });

  // Show/hide changes
  btnShowDiff.addEventListener('click', () => {
    const isHidden = changesLog.style.display === 'none';
    changesLog.style.display = isHidden ? 'block' : 'none';
    btnShowDiff.querySelector('span').textContent = isHidden ? 'Hide' : 'Changes';
  });

  // Mode change — re-optimize if results exist
  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (lastCompressed && inputText.value.trim()) {
        handleOptimize();
      }
      saveState();
    });
  });

  // Toggle changes — save state
  document.querySelectorAll('.toggle-input').forEach(toggle => {
    toggle.addEventListener('change', saveState);
  });

  // ══════════════════════════════════════════
  // CORE FUNCTIONS
  // ══════════════════════════════════════════

  function handleOptimize() {
    const text = inputText.value.trim();
    if (!text || isProcessing) return;

    isProcessing = true;
    btnOptimize.classList.add('loading');
    btnOptimize.disabled = true;

    // Small delay for UX (shows loading state)
    setTimeout(() => {
      try {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const options = getOptions();

        // Run compression
        const result = Compressor.compress(text, mode, options);

        // Calculate tokens
        const origTokens = Tokenizer.estimateTokens(text);
        const compTokens = Tokenizer.estimateTokens(result.compressed);
        const reduction = Tokenizer.calcReduction(origTokens.total, compTokens.total);

        // Update UI
        animateTokenCount(originalTokens, origTokens.total);
        animateTokenCount(compressedTokens, compTokens.total);
        showReductionRing(reduction);
        showResults(result.compressed, result.changes);

        lastCompressed = result.compressed;
        saveState();

      } catch (err) {
        console.error('Compression error:', err);
        showToast('Compression failed. Try again.');
      } finally {
        isProcessing = false;
        btnOptimize.classList.remove('loading');
        btnOptimize.disabled = false;
      }
    }, 200);
  }

  async function handleCapture() {
    try {
      // Try to communicate with content script in active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        showToast('No active tab found');
        return;
      }

      // Check if it's a supported AI site
      const supportedSites = [
        'chat.openai.com', 'chatgpt.com',
        'gemini.google.com',
        'claude.ai'
      ];
      
      const url = new URL(tab.url);
      const isSupported = supportedSites.some(site => url.hostname.includes(site));

      if (!isSupported) {
        showToast('Navigate to ChatGPT, Gemini, or Claude first');
        return;
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'extractText' 
      });

      if (response && response.text) {
        inputText.value = response.text;
        updateLiveTokenCount();
        showToast(`Captured ${response.source} text`);
        saveState();
      } else {
        showToast('No text found. Try selecting text first.');
      }

    } catch (err) {
      console.error('Capture error:', err);
      // Fallback: just show a helpful message
      showToast('Paste text manually or select text on the AI page');
    }
  }

  // ══════════════════════════════════════════
  // UI HELPERS
  // ══════════════════════════════════════════

  function updateLiveTokenCount() {
    const text = inputText.value;
    const chars = text.length;
    const tokens = Tokenizer.estimateTokens(text);

    charCount.textContent = chars.toLocaleString();
    liveTokenCount.textContent = Tokenizer.formatTokenCount(tokens.total);
  }

  function animateTokenCount(element, target) {
    const start = parseInt(element.textContent.replace(/,/g, '')) || 0;
    const duration = 600;
    const startTime = performance.now();

    element.classList.add('animate');

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      element.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        element.classList.remove('animate');
      }
    }

    requestAnimationFrame(tick);
  }

  function showReductionRing(percent) {
    reductionContainer.style.display = 'flex';
    
    // Animate the ring
    const circumference = 2 * Math.PI * 34; // r=34
    const offset = circumference - (percent / 100) * circumference;
    
    // Force reflow for animation
    reductionRing.style.strokeDashoffset = circumference;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        reductionRing.style.strokeDashoffset = offset;
      });
    });

    // Animate percent number
    const startPercent = 0;
    const duration = 800;
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = (startPercent + (percent - startPercent) * eased).toFixed(1);
      reductionPercent.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  function showResults(compressed, changes) {
    resultsSection.style.display = 'block';
    resultOutput.textContent = compressed;

    // Build changes list
    changesList.innerHTML = '';
    for (const change of changes) {
      const item = document.createElement('div');
      item.className = 'change-item';

      const iconClass = getChangeIconClass(change.type);
      const icon = getChangeIcon(change.type);

      item.innerHTML = `
        <div class="change-icon ${iconClass}">${icon}</div>
        <div class="change-detail">${escapeHtml(change.detail)}</div>
      `;
      changesList.appendChild(item);
    }

    // Reset diff button
    changesLog.style.display = 'none';
    btnShowDiff.querySelector('span').textContent = 'Changes';

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideResults() {
    resultsSection.style.display = 'none';
    reductionContainer.style.display = 'none';
    originalTokens.textContent = '0';
    compressedTokens.textContent = '0';
    lastCompressed = '';
  }

  function getChangeIconClass(type) {
    switch (type) {
      case 'duplicates_removed': return 'removed';
      case 'fillers_removed': return 'removed';
      case 'aggressive_prune': return 'removed';
      case 'secret_redacted': return 'redacted';
      case 'verbose_simplified': return 'optimized';
      case 'whitespace_normalized': return 'optimized';
      case 'logs_compressed': return 'compressed';
      default: return 'optimized';
    }
  }

  function getChangeIcon(type) {
    switch (type) {
      case 'duplicates_removed': return '🔁';
      case 'fillers_removed': return '✂️';
      case 'secret_redacted': return '🔒';
      case 'verbose_simplified': return '📝';
      case 'whitespace_normalized': return '⬜';
      case 'logs_compressed': return '📋';
      case 'aggressive_prune': return '🗑️';
      default: return '⚡';
    }
  }

  function getOptions() {
    return {
      removeRepetition: document.getElementById('optRepetition').checked,
      preserveRequirements: document.getElementById('optRequirements').checked,
      preserveCode: document.getElementById('optCode').checked,
      summarizeHistory: document.getElementById('optHistory').checked,
      redactSecrets: document.getElementById('optSecrets').checked
    };
  }

  function showCopiedFeedback(btn) {
    btn.classList.add('copied');
    const span = btn.querySelector('span');
    const original = span.textContent;
    span.textContent = 'Copied!';
    setTimeout(() => {
      btn.classList.remove('copied');
      span.textContent = original;
    }, 2000);
  }

  function showToast(message) {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ══════════════════════════════════════════
  // PERSISTENCE
  // ══════════════════════════════════════════

  function saveState() {
    const state = {
      inputText: inputText.value,
      mode: document.querySelector('input[name="mode"]:checked')?.value || 'balanced',
      options: getOptions()
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.session.set({ popupState: state });
      } else {
        localStorage.setItem('promptpilot_state', JSON.stringify(state));
      }
    } catch (e) { /* ignore */ }
  }

  function loadState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.session.get('popupState', (result) => {
          if (result.popupState) applyState(result.popupState);
        });
      } else {
        const saved = localStorage.getItem('promptpilot_state');
        if (saved) applyState(JSON.parse(saved));
      }
    } catch (e) { /* ignore */ }
  }

  function applyState(state) {
    if (state.inputText) {
      inputText.value = state.inputText;
      updateLiveTokenCount();
    }
    if (state.mode) {
      const radio = document.querySelector(`input[name="mode"][value="${state.mode}"]`);
      if (radio) radio.checked = true;
    }
    if (state.options) {
      for (const [key, value] of Object.entries(state.options)) {
        const id = 'opt' + key.charAt(0).toUpperCase() + key.slice(1)
          .replace('Repetition', 'Repetition')
          .replace('Requirements', 'Requirements')
          .replace('Code', 'Code')
          .replace('History', 'History')
          .replace('Secrets', 'Secrets');
        
        // Map option keys to element IDs
        const mapping = {
          removeRepetition: 'optRepetition',
          preserveRequirements: 'optRequirements',
          preserveCode: 'optCode',
          summarizeHistory: 'optHistory',
          redactSecrets: 'optSecrets'
        };
        
        const el = document.getElementById(mapping[key]);
        if (el) el.checked = value;
      }
    }
  }

  // ══════════════════════════════════════════
  // RING GRADIENT (SVG def injection)
  // ══════════════════════════════════════════

  function injectRingGradient() {
    const ringSvg = document.querySelector('.ring-svg');
    if (!ringSvg) return;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', 'ringGradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '100%');

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#6366f1');

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '50%');
    stop2.setAttribute('stop-color', '#06b6d4');

    const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop3.setAttribute('offset', '100%');
    stop3.setAttribute('stop-color', '#14b8a6');

    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    gradient.appendChild(stop3);
    defs.appendChild(gradient);
    ringSvg.insertBefore(defs, ringSvg.firstChild);
  }
});
