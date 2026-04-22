/** 
 * SmartAllocation Utility Functions
 * This file must be included before other app scripts.
 */

window.escapeHtml = function(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Standardized Toast Notification
 */
window.showToast = function(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `p-4 rounded-xl shadow-lg text-sm text-white font-medium flex items-center gap-3 pointer-events-auto transition-all duration-300 transform translate-y-full opacity-0 ${isError ? 'bg-red-500' : 'bg-emerald-500'}`;
  toast.id = `toast-${Date.now()}`;
  
  const icon = isError ? 
    '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' :
    '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

  toast.innerHTML = `${icon}<span>${message}</span>`;
  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-full', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  if (!isError && window.playSuccessSound) {
    const msg = message.toLowerCase();
    if (msg.includes('success') || msg.includes('assigned') || msg.includes('resolv') || msg.includes('updated') || msg.includes('created')) {
      window.playSuccessSound();
    }
  }

  // Auto-remove
  setTimeout(() => {
    toast.classList.add('translate-y-full', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

/**
 * Global Debounce Helper
 */
window.debounce = function(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Global Loading State Helper for Buttons
 */
window.setLoadingState = function(buttonId, isLoading, originalText = 'Submit') {
  const btn = typeof buttonId === 'string' ? document.getElementById(buttonId) : buttonId;
  if (!btn) return;

  if (isLoading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<svg class="sa-spinner w-4 h-4 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || originalText;
    btn.classList.remove('opacity-70', 'cursor-not-allowed');
  }
};

/**
 * AI Helper: Get Gemini Embedding
 */
function getGeminiClientConfig() {
  const cfg = window.CONFIG || {};
  const apiKey = (cfg.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY in config.js');
  }
  return {
    apiKey,
    generationModel: (cfg.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview').replace(/^models\//, '').trim(),
    embeddingModel: (cfg.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001').replace(/^models\//, '').trim(),
    embeddingDimensions: parseInt(cfg.GEMINI_EMBEDDING_DIMENSIONS || '1024', 10)
  };
}

window.callGeminiGenerate = async function(prompt, userText, opts = {}) {
  const { apiKey, generationModel } = getGeminiClientConfig();
  const isExtraction = opts.extraction === true;
  const responseMimeType = isExtraction ? 'application/json' : 'text/plain';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${generationModel}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: isExtraction ? 0.1 : 0.2,
        responseMimeType
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: `${prompt}\n\n${userText}` }]
        }
      ]
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || 'Gemini request failed.');
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((part) => part?.text || '').join('').trim() : '';
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
};

window.getGeminiEmbedding = async function(text) {
  const cleanText = text.trim().toLowerCase();
  const cacheKey = 'emb_' + btoa(encodeURIComponent(cleanText.substring(0, 64)));
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  async function pruneEmbeddingCacheIfNeeded() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return;
      const estimate = await navigator.storage.estimate();
      if (!estimate || !estimate.quota || !estimate.usage) return;
      const usageRatio = estimate.usage / estimate.quota;
      if (usageRatio < 0.85) return;

      const embKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('emb_')) embKeys.push(key);
      }
      if (embKeys.length === 0) return;

      const toDelete = Math.max(1, Math.ceil(embKeys.length * 0.3));
      embKeys.slice(0, toDelete).forEach((key) => localStorage.removeItem(key));
    } catch (e) {
      console.warn('Embedding cache prune skipped:', e);
    }
  }

  const { apiKey, embeddingModel, embeddingDimensions } = getGeminiClientConfig();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${embeddingModel}:embedContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${embeddingModel}`,
      outputDimensionality: embeddingDimensions,
      content: {
        parts: [{ text }]
      }
    })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const rawMessage = String(errData?.error?.message || errData?.message || '').toLowerCase();
    if (
      rawMessage.includes('api key') ||
      rawMessage.includes('configuration missing') ||
      rawMessage.includes('not configured')
    ) {
      throw new Error('AI service is unavailable right now. Please try again later.');
    }
    throw new Error(errData?.error?.message || errData?.message || 'AI request failed.');
  }
  const data = await res.json();
  const embedding = data?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('AI embedding response was invalid.');
  }
  
  try {
    await pruneEmbeddingCacheIfNeeded();
    localStorage.setItem(cacheKey, JSON.stringify(embedding));
  } catch(e) { console.warn('Cache quota exceeded'); }
  
  return embedding;
};

// Backward-compatible alias used by existing pages.
window.getEmbedding = async function(text) {
  return window.getGeminiEmbedding(text);
};


/**
 * UX: Synthesized Success Pop Sound
 */
window.playSuccessSound = function() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch(e) { console.warn('Audio blocked or unsupported'); }
};

/**
 * UX: Dynamic Browser Tab Titles
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    document.documentElement.dataset.originalTitle = document.title;
    document.title = '👀 We missed you! | SmartAllocation';
  } else {
    document.title = document.documentElement.dataset.originalTitle || 'SmartAllocation';
  }
});

/**
 * UX: Page Transitions (SPA Feel)
 */
document.addEventListener('DOMContentLoaded', () => {
  // Fade In gracefully
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.25s ease-out';
  requestAnimationFrame(() => {
    document.body.style.opacity = '1';
  });

  // Intercept links via event delegation
  document.body.addEventListener('click', function(e) {
    const anchor = e.target.closest('a');
    if (!anchor) return;

    if (anchor.hostname === window.location.hostname && !anchor.target && !anchor.hasAttribute('download')) {
      const targetUrl = anchor.href;
      
      // Skip anchors mimicking buttons (#)
      if (targetUrl.includes('#') && targetUrl.split('#')[0] === window.location.href.split('#')[0]) return;

      e.preventDefault();
      document.body.style.opacity = '0';
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 250);
    }
  });
});
