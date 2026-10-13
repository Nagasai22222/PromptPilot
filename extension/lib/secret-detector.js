/**
 * PromptPilot — Secret Detection & Redaction
 * 
 * Identifies sensitive information patterns and replaces values with [REDACTED].
 * Preserves key names for context while removing actual secret values.
 */

const SecretDetector = (() => {
  // Pattern definitions: [regex, description, replacer function]
  const PATTERNS = [
    // API Keys with common prefixes
    {
      name: 'API Key Assignment',
      regex: /((?:API_KEY|APIKEY|api_key|apiKey|API_SECRET|SECRET_KEY|ACCESS_KEY|PRIVATE_KEY)\s*[=:]\s*)(['"]?)([^\s'"}\n,;]+)\2/g,
      replace: '$1[REDACTED]'
    },
    // Generic secret/password/token assignments
    {
      name: 'Secret Assignment',
      regex: /((?:PASSWORD|PASSWD|PASS|SECRET|TOKEN|AUTH|CREDENTIAL|PRIVATE)\s*[=:]\s*)(['"]?)([^\s'"}\n,;]+)\2/gi,
      replace: '$1[REDACTED]'
    },
    // AWS Access Keys (start with AKIA)
    {
      name: 'AWS Access Key',
      regex: /\b(AKIA[0-9A-Z]{16})\b/g,
      replace: '[REDACTED_AWS_KEY]'
    },
    // AWS Secret Keys (40 char base64)
    {
      name: 'AWS Secret Key',
      regex: /(aws_secret_access_key\s*[=:]\s*)(['"]?)([A-Za-z0-9/+=]{40})\2/gi,
      replace: '$1[REDACTED]'
    },
    // OpenAI API Keys
    {
      name: 'OpenAI Key',
      regex: /\b(sk-[a-zA-Z0-9_-]{20,})\b/g,
      replace: '[REDACTED_OPENAI_KEY]'
    },
    // Google API Keys
    {
      name: 'Google API Key',
      regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
      replace: '[REDACTED_GOOGLE_KEY]'
    },
    // JWT Tokens
    {
      name: 'JWT Token',
      regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)\b/g,
      replace: '[REDACTED_JWT]'
    },
    // Private Keys (PEM format)
    {
      name: 'Private Key Block',
      regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
      replace: '[REDACTED_PRIVATE_KEY]'
    },
    // Connection Strings with credentials
    {
      name: 'Database Connection String',
      regex: /((?:mongodb|postgresql|postgres|mysql|redis|amqp|mssql):\/\/[^:]+:)([^@]+)(@)/gi,
      replace: '$1[REDACTED]$3'
    },
    // Bearer tokens in headers
    {
      name: 'Bearer Token',
      regex: /((?:Bearer|Authorization)\s*[=:]\s*['"]?)([A-Za-z0-9_\-.+/=]{20,})/gi,
      replace: '$1[REDACTED]'
    },
    // .env file values
    {
      name: 'Environment Variable',
      regex: /^((?:DATABASE_URL|REDIS_URL|MONGO_URI|DB_PASSWORD|DB_PASS|SMTP_PASSWORD|MAIL_PASSWORD|STRIPE_KEY|WEBHOOK_SECRET|ENCRYPTION_KEY|JWT_SECRET|SESSION_SECRET)\s*=\s*)(.+)$/gim,
      replace: '$1[REDACTED]'
    },
    // Hex tokens (32+ chars that look like tokens/hashes used as secrets)
    {
      name: 'Hex Token',
      regex: /((?:token|secret|key|hash)\s*[=:]\s*['"]?)([0-9a-fA-F]{32,})/gi,
      replace: '$1[REDACTED]'
    },
    // GitHub tokens
    {
      name: 'GitHub Token',
      regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g,
      replace: '[REDACTED_GITHUB_TOKEN]'
    },
    // Slack tokens
    {
      name: 'Slack Token',
      regex: /\b(xox[baprs]-[0-9]+-[0-9]+-[a-zA-Z0-9]+)\b/g,
      replace: '[REDACTED_SLACK_TOKEN]'
    }
  ];

  /**
   * Scan text for secrets and return detection results.
   * @param {string} text 
   * @returns {{ hasSecrets: boolean, detections: Array<{name: string, count: number}>, redactedText: string }}
   */
  function detect(text) {
    if (!text || typeof text !== 'string') {
      return { hasSecrets: false, detections: [], redactedText: text || '' };
    }

    let redactedText = text;
    const detections = [];

    for (const pattern of PATTERNS) {
      const matches = text.match(pattern.regex);
      if (matches && matches.length > 0) {
        detections.push({
          name: pattern.name,
          count: matches.length
        });
        redactedText = redactedText.replace(pattern.regex, pattern.replace);
      }
    }

    return {
      hasSecrets: detections.length > 0,
      detections,
      redactedText
    };
  }

  /**
   * Quick check if text likely contains secrets (faster than full detection).
   * @param {string} text 
   * @returns {boolean}
   */
  function quickCheck(text) {
    if (!text) return false;
    const quickPatterns = [
      /API_KEY\s*=/i,
      /PASSWORD\s*=/i,
      /SECRET\s*=/i,
      /TOKEN\s*=/i,
      /\bsk-[a-zA-Z0-9]{20,}/,
      /\bAKIA[0-9A-Z]{16}/,
      /\beyJ[A-Za-z0-9_-]{10,}\./,
      /-----BEGIN.*PRIVATE.*KEY/,
      /Bearer\s+[A-Za-z0-9]{20,}/i
    ];
    return quickPatterns.some(p => p.test(text));
  }

  /**
   * Get a summary of detected secrets for display.
   * @param {Array<{name: string, count: number}>} detections 
   * @returns {string}
   */
  function getSummary(detections) {
    if (!detections || detections.length === 0) return 'No secrets detected';
    const total = detections.reduce((sum, d) => sum + d.count, 0);
    const types = detections.map(d => d.name).join(', ');
    return `${total} secret${total > 1 ? 's' : ''} redacted (${types})`;
  }

  return {
    detect,
    quickCheck,
    getSummary
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SecretDetector;
}
