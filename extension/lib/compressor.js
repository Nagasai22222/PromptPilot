/**
 * PromptPilot — Rule-Based Compression Engine
 * 
 * Multi-stage compression pipeline that removes redundant, verbose,
 * and unnecessary content while preserving semantic intent.
 * 
 * Pipeline:
 * 1. Secret Redaction
 * 2. Whitespace Normalization
 * 3. Filler Phrase Removal
 * 4. Duplicate Detection (Jaccard + exact)
 * 5. Log Compression
 * 6. Code Block Preservation
 * 7. Verbose Instruction Simplification
 */

const Compressor = (() => {

  // ─────────────────────────────────────────────
  // FILLER PHRASES (removed entirely)
  // ─────────────────────────────────────────────
  const FILLER_PHRASES = [
    // Politeness / hedging
    /\b(?:I\s+want\s+you\s+to\s+)?(?:please\s+)?(?:carefully\s+)?(?:make\s+sure\s+(?:that\s+)?(?:you\s+)?)?/gi,
    /\b(?:I\s+would\s+(?:really\s+)?(?:like|appreciate)\s+(?:it\s+)?if\s+you\s+(?:could|would)\s+)/gi,
    /\b(?:Could\s+you\s+(?:please\s+)?(?:kindly\s+)?)/gi,
    /\b(?:If\s+(?:you\s+)?(?:don't|do\s+not)\s+mind(?:,?\s+)?)/gi,
    /\b(?:I(?:'m|\s+am)\s+(?:currently\s+)?(?:trying\s+to|working\s+on)\s+)/gi,
    /\b(?:basically\s+(?:what\s+)?)/gi,
    /\b(?:(?:So\s+)?essentially(?:,?\s+)?)/gi,
    /\b(?:As\s+(?:I\s+)?mentioned\s+(?:before|earlier|previously|above)(?:,?\s+)?)/gi,
    /\b(?:(?:Just\s+)?(?:to\s+be\s+)?(?:perfectly\s+)?clear(?:,?\s+)?)/gi,
    /\b(?:I\s+think\s+(?:that\s+)?(?:maybe\s+)?)/gi,
    /\b(?:In\s+(?:other|simple)\s+words(?:,?\s+)?)/gi,
    /\b(?:(?:Kind|Sort)\s+of\s+(?:like\s+)?)/gi,
    /\b(?:You\s+know(?:,?\s+)?)/gi,
    /\b(?:What\s+I(?:'m|\s+am)\s+trying\s+to\s+say\s+is\s+(?:that\s+)?)/gi,
    /\b(?:I\s+(?:hope|believe|suppose|guess)\s+(?:that\s+)?)/gi,
    /\b(?:(?:Anyway|Anyhow|Anyways)(?:,?\s+)?)/gi,
    /\b(?:To\s+be\s+(?:more\s+)?(?:honest|specific|precise)(?:,?\s+)?)/gi,
    /\b(?:understand\s+everything\s+before\s+answering\.?\s*)/gi,
  ];

  // ─────────────────────────────────────────────
  // VERBOSE PATTERNS (replaced with concise versions)
  // ─────────────────────────────────────────────
  const VERBOSE_REPLACEMENTS = [
    [/\bin\s+order\s+to\b/gi, 'to'],
    [/\bdue\s+to\s+the\s+fact\s+that\b/gi, 'because'],
    [/\bat\s+this\s+(?:point\s+in\s+)?time\b/gi, 'now'],
    [/\bfor\s+the\s+purpose\s+of\b/gi, 'for'],
    [/\bin\s+the\s+event\s+that\b/gi, 'if'],
    [/\bwith\s+(?:regard|respect)\s+to\b/gi, 'about'],
    [/\bit\s+is\s+(?:important|necessary)\s+(?:to\s+)?note\s+that\b/gi, ''],
    [/\bas\s+a\s+matter\s+of\s+fact\b/gi, 'in fact'],
    [/\bat\s+the\s+end\s+of\s+the\s+day\b/gi, 'ultimately'],
    [/\bthe\s+(?:vast\s+)?majority\s+of\b/gi, 'most'],
    [/\ba\s+(?:large|significant|considerable)\s+(?:number|amount)\s+of\b/gi, 'many'],
    [/\bgive(?:s)?\s+(?:us|you|me)\s+the\s+ability\s+to\b/gi, 'lets us'],
    [/\bhas\s+the\s+(?:ability|capability)\s+to\b/gi, 'can'],
    [/\bon\s+a\s+(?:daily|regular|weekly)\s+basis\b/gi, (m) => m.includes('daily') ? 'daily' : m.includes('weekly') ? 'weekly' : 'regularly'],
    [/\btake\s+into\s+(?:account|consideration)\b/gi, 'consider'],
  ];

  // ─────────────────────────────────────────────
  // LOG PATTERNS
  // ─────────────────────────────────────────────
  const LOG_LEVEL_REGEX = /^[\[\(]?\s*(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}[^\]]*[\]\)]?\s*)?(?:\[?\s*)?(INFO|DEBUG|WARN(?:ING)?|ERROR|FATAL|TRACE|LOG|NOTICE)\s*[\]:]?\s*/i;

  // ─────────────────────────────────────────────
  // CODE FENCE REGEX
  // ─────────────────────────────────────────────
  const CODE_FENCE_REGEX = /```[\s\S]*?```/g;

  // ─────────────────────────────────────────────
  // COMPRESSION MODES
  // ─────────────────────────────────────────────
  const MODES = {
    conservative: {
      removeFillers: false,
      removeDuplicates: false,
      compressLogs: false,
      simplifyVerbose: false,
      normalizeWhitespace: true,
      aggressivePrune: false,
      jaccardThreshold: 0.95 // Only exact-ish duplicates
    },
    balanced: {
      removeFillers: true,
      removeDuplicates: true,
      compressLogs: true,
      simplifyVerbose: true,
      normalizeWhitespace: true,
      aggressivePrune: false,
      jaccardThreshold: 0.75
    },
    aggressive: {
      removeFillers: true,
      removeDuplicates: true,
      compressLogs: true,
      simplifyVerbose: true,
      normalizeWhitespace: true,
      aggressivePrune: true,
      jaccardThreshold: 0.60
    }
  };

  // ═══════════════════════════════════════════════
  // MAIN COMPRESSION FUNCTION
  // ═══════════════════════════════════════════════

  /**
   * Compress text using the specified mode and options.
   * 
   * @param {string} text - Input text
   * @param {string} mode - 'conservative' | 'balanced' | 'aggressive'
   * @param {Object} options - Feature toggles
   * @param {boolean} options.removeRepetition
   * @param {boolean} options.preserveRequirements
   * @param {boolean} options.preserveCode
   * @param {boolean} options.summarizeHistory
   * @param {boolean} options.redactSecrets
   * @returns {{ compressed: string, changes: Array<{type: string, detail: string}> }}
   */
  function compress(text, mode = 'balanced', options = {}) {
    if (!text || typeof text !== 'string') {
      return { compressed: '', changes: [] };
    }

    const config = { ...MODES[mode] || MODES.balanced };
    const changes = [];
    let result = text;

    // Override config with user options
    if (options.removeRepetition === false) config.removeDuplicates = false;
    if (options.preserveCode === false) config.preserveCode = false;

    // ── Step 1: Secret Redaction ──
    if (options.redactSecrets !== false && typeof SecretDetector !== 'undefined') {
      const detection = SecretDetector.detect(result);
      if (detection.hasSecrets) {
        result = detection.redactedText;
        changes.push({
          type: 'secret_redacted',
          detail: SecretDetector.getSummary(detection.detections)
        });
      }
    }

    // ── Step 2: Protect code blocks ──
    const codeBlocks = [];
    result = result.replace(CODE_FENCE_REGEX, (match) => {
      const idx = codeBlocks.length;
      codeBlocks.push(match);
      return `\n__PROMPTPILOT_CODE_${idx}__\n`;
    });

    // ── Step 3: Whitespace Normalization ──
    if (config.normalizeWhitespace) {
      const beforeLen = result.length;
      result = normalizeWhitespace(result);
      const saved = beforeLen - result.length;
      if (saved > 10) {
        changes.push({
          type: 'whitespace_normalized',
          detail: `Removed ${saved} excess whitespace characters`
        });
      }
    }

    // ── Step 4: Filler Phrase Removal ──
    if (config.removeFillers) {
      const beforeLen = result.length;
      result = removeFillerPhrases(result);
      const saved = beforeLen - result.length;
      if (saved > 5) {
        changes.push({
          type: 'fillers_removed',
          detail: `Removed ${saved} characters of filler phrases`
        });
      }
    }

    // ── Step 5: Verbose Simplification ──
    if (config.simplifyVerbose) {
      const beforeLen = result.length;
      result = simplifyVerbose(result);
      const saved = beforeLen - result.length;
      if (saved > 5) {
        changes.push({
          type: 'verbose_simplified',
          detail: `Simplified ${saved} characters of verbose phrasing`
        });
      }
    }

    // ── Step 6: Duplicate Detection ──
    if (config.removeDuplicates) {
      const { text: deduped, removed } = removeDuplicates(result, config.jaccardThreshold);
      if (removed > 0) {
        result = deduped;
        changes.push({
          type: 'duplicates_removed',
          detail: `Removed ${removed} duplicate passage${removed > 1 ? 's' : ''}`
        });
      }
    }

    // ── Step 7: Log Compression ──
    if (config.compressLogs) {
      const { text: logCompressed, compressed: logCount } = compressLogs(result);
      if (logCount > 0) {
        result = logCompressed;
        changes.push({
          type: 'logs_compressed',
          detail: `Compressed ${logCount} repeated log line${logCount > 1 ? 's' : ''}`
        });
      }
    }

    // ── Step 8: Aggressive Pruning ──
    if (config.aggressivePrune) {
      const beforeLen = result.length;
      result = aggressivePrune(result);
      const saved = beforeLen - result.length;
      if (saved > 10) {
        changes.push({
          type: 'aggressive_prune',
          detail: `Pruned ${saved} characters of low-value content`
        });
      }
    }

    // ── Step 9: Restore code blocks ──
    for (let i = 0; i < codeBlocks.length; i++) {
      result = result.replace(`__PROMPTPILOT_CODE_${i}__`, codeBlocks[i]);
    }

    // ── Step 10: Final whitespace cleanup ──
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return { compressed: result, changes };
  }

  // ═══════════════════════════════════════════════
  // PIPELINE STAGES
  // ═══════════════════════════════════════════════

  function normalizeWhitespace(text) {
    return text
      .replace(/\r\n/g, '\n')        // Normalize line endings
      .replace(/\t/g, '  ')          // Tabs to spaces
      .replace(/ {2,}/g, ' ')        // Multiple spaces to single
      .replace(/\n{3,}/g, '\n\n')    // Max 2 consecutive newlines
      .replace(/ +\n/g, '\n')        // Trailing spaces on lines
      .replace(/\n +/g, '\n')        // Leading spaces on empty-ish lines (careful)
      .trim();
  }

  function removeFillerPhrases(text) {
    let result = text;
    for (const pattern of FILLER_PHRASES) {
      result = result.replace(pattern, '');
    }
    // Clean up resulting double spaces and orphaned punctuation
    result = result.replace(/ {2,}/g, ' ');
    result = result.replace(/^\s+/gm, (match) => match.length > 2 ? '' : match);
    return result;
  }

  function simplifyVerbose(text) {
    let result = text;
    for (const [pattern, replacement] of VERBOSE_REPLACEMENTS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  function removeDuplicates(text, threshold) {
    const paragraphs = text.split(/\n\n+/);
    if (paragraphs.length <= 1) return { text, removed: 0 };

    const kept = [];
    let removed = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const current = paragraphs[i].trim();
      if (!current) continue;

      let isDuplicate = false;

      for (const keptParagraph of kept) {
        // Exact match
        if (current === keptParagraph) {
          isDuplicate = true;
          break;
        }
        // Jaccard similarity
        const similarity = jaccardSimilarity(current, keptParagraph);
        if (similarity >= threshold) {
          isDuplicate = true;
          break;
        }
      }

      if (isDuplicate) {
        removed++;
      } else {
        kept.push(current);
      }
    }

    return { text: kept.join('\n\n'), removed };
  }

  function compressLogs(text) {
    const lines = text.split('\n');
    const compressed = [];
    const logGroups = new Map(); // key: normalized log content, value: count
    let lastNonLogIdx = -1;
    let totalCompressed = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const logMatch = line.match(LOG_LEVEL_REGEX);

      if (logMatch) {
        // Normalize: remove timestamp, keep level + message
        const level = logMatch[2].toUpperCase();
        const message = line.replace(LOG_LEVEL_REGEX, '').trim();
        const key = `${level}:${message}`;

        if (logGroups.has(key)) {
          logGroups.set(key, logGroups.get(key) + 1);
        } else {
          logGroups.set(key, 1);
        }
      } else {
        // Flush accumulated log groups before this non-log line
        if (logGroups.size > 0) {
          const { lines: logLines, compressed: count } = flushLogGroups(logGroups);
          compressed.push(...logLines);
          totalCompressed += count;
          logGroups.clear();
        }
        compressed.push(line);
        lastNonLogIdx = compressed.length - 1;
      }
    }

    // Flush remaining
    if (logGroups.size > 0) {
      const { lines: logLines, compressed: count } = flushLogGroups(logGroups);
      compressed.push(...logLines);
      totalCompressed += count;
    }

    return { text: compressed.join('\n'), compressed: totalCompressed };
  }

  function flushLogGroups(groups) {
    const lines = [];
    let compressed = 0;

    for (const [key, count] of groups) {
      const [level, ...messageParts] = key.split(':');
      const message = messageParts.join(':');

      if (count > 1) {
        lines.push(`[${level}] ${message} (×${count})`);
        compressed += count - 1;
      } else {
        lines.push(`[${level}] ${message}`);
      }
    }

    return { lines, compressed };
  }

  function aggressivePrune(text) {
    let result = text;

    // Remove "thank you" / "thanks" lines
    result = result.replace(/^(?:thank(?:s|\s+you)(?:\s+(?:so|very)\s+much)?[.!]?\s*)$/gim, '');

    // Remove "hope this helps" / "let me know" type lines
    result = result.replace(/^(?:(?:I\s+)?hope\s+this\s+helps?[.!]?\s*)$/gim, '');
    result = result.replace(/^(?:Let\s+me\s+know\s+if\s+(?:you\s+)?(?:have|need)[\s\S]*?[.!]?\s*)$/gim, '');
    result = result.replace(/^(?:Feel\s+free\s+to\s+ask[\s\S]*?[.!]?\s*)$/gim, '');

    // Remove greeting lines
    result = result.replace(/^(?:(?:Hi|Hello|Hey|Dear)(?:\s+(?:there|everyone|team))?[,!.]?\s*)$/gim, '');

    // Remove sign-off lines
    result = result.replace(/^(?:(?:Best|Kind)\s+regards?[,.]?\s*)$/gim, '');
    result = result.replace(/^(?:(?:Sincerely|Cheers|Regards)[,.]?\s*)$/gim, '');

    // Remove obvious filler sentences
    result = result.replace(/^(?:I\s+(?:just\s+)?wanted\s+to\s+(?:quickly\s+)?(?:mention|note|say|point\s+out)\s+that\s+)/gim, '');

    return result;
  }

  // ═══════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════

  /**
   * Compute Jaccard similarity between two text strings.
   * Uses word-level n-grams for better matching.
   */
  function jaccardSimilarity(a, b) {
    const setA = new Set(tokenize(a));
    const setB = new Set(tokenize(b));

    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Simple word tokenizer for Jaccard comparison.
   */
  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }

  /**
   * Get available compression modes.
   */
  function getModes() {
    return {
      conservative: {
        name: 'Conservative',
        description: 'Minimal changes. Whitespace cleanup only.',
        expectedReduction: '10–30%'
      },
      balanced: {
        name: 'Balanced',
        description: 'Smart compression. Removes fillers, duplicates, and verbose phrasing.',
        expectedReduction: '30–60%'
      },
      aggressive: {
        name: 'Aggressive',
        description: 'Maximum reduction. May remove some useful context.',
        expectedReduction: '60–90%'
      }
    };
  }

  return {
    compress,
    getModes,
    jaccardSimilarity
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Compressor;
}
