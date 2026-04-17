/* ============================================================
   SmartAllocation — App Logic (app.js)
   Defensive version: map and Supabase are completely independent.
   ============================================================ */

// ─── Constants (Non-sensitive) ──────────────────────────────────


// ─── Category Marker Colors ─────────────────────────────────────
const CATEGORY_COLORS = {
  'Healthcare':    '#f43f5e',
  'Environment':   '#22c55e',
  'Education':     '#3b82f6',
  'Child Welfare': '#f59e0b',
  'Women Rights':  '#a855f7',
  'Food Security': '#f97316',
  'Sanitation':    '#06b6d4',
  'General':       '#94a3b8',
};

function getMarkerIcon(category, isPulsing = false, isUrgent = false) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS['General'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="36" style="display:block;">
    <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"/>
    <circle cx="12" cy="11" r="5" fill="#fff"/>
  </svg>`;
  
  let className = 'leaflet-marker-icon';
  if (isPulsing) className += ' pulse-marker';
  if (isUrgent) className += ' urgent-glow';

  return L.divIcon({
    html: svg,
    className: className,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

// ─── Helper: Status Message ─────────────────────────────────────
function showStatus(el, message, type) {
  if (!el) return;
  const colors = { info: 'text-blue-400', success: 'text-emerald-400', warn: 'text-yellow-400', error: 'text-red-400' };
  el.className = 'text-sm text-center ' + (colors[type] || 'text-gray-400');
  el.textContent = message;
  el.classList.remove('hidden');
}

// ─── Helper: Toast Notifications ─────────────────────────────────
function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `p-4 rounded-xl shadow-lg text-sm text-white font-medium flex items-center gap-3 toast-enter pointer-events-auto ${isError ? 'bg-red-500' : 'bg-emerald-500'}`;
  toast.innerHTML = `
    <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      ${isError 
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />' 
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />'}
    </svg>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.replace('toast-enter', 'toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── AI Helper: Get Mistral Embedding ────────────────────────────
async function getEmbedding(text) {
  const token = CONFIG.MISTRAL_API_KEY;
  if (!token || token.includes('your-mistral')) {
    throw new Error('Please set your Mistral API key inside CONFIG');
  }
  const res = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: [text],
    })
  });
  if (!res.ok) throw new Error('Failed to generate embedding');
  const data = await res.json();
  return data.data[0].embedding;
}

// ─── AI Helper: Get Match Reason ─────────────────────────────────
async function getMatchReason(skill, need, ageDays = 0) {
  const token = CONFIG.MISTRAL_API_KEY;
  if (!token || token.includes('your-mistral')) return 'AI Match';
  
  const ageContext = ageDays > 14 ? ` (Note: This is a long-standing request from ${Math.round(ageDays)} days ago)` : '';
  
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{
          role: 'system',
          content: 'You are a smart matching assistant. Write a very brief, one-sentence explanation (max 12 words) of why the volunteer\'s skill matches the NGO\'s need. Address the volunteer directly. If the need is mentioned as long-standing, acknowledge the importance of helping out now.'
        }, {
          role: 'user',
          content: `Volunteer Skill: "${skill}"\nNGO Need: "${need}"${ageContext}`
        }]
      })
    });
    if (!res.ok) return 'Good match for your skills.';
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    return 'Good match for your skills.';
  }
}
// ═══════════════════════════════════════════════════════════════
// Run everything after DOM is ready
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
  
  // ── 0. Configuration Check ────────────────────────────────────────
  if (!window.CONFIG || !window.CONFIG.SUPABASE_URL) {
    const errorMsg = 'Critical Error: Configuration file (config.js) is missing or incomplete.';
    console.error(errorMsg);
    
    // Attempt to show error on UI
    setTimeout(() => {
      showToast(errorMsg, true);
      const mapEl = document.getElementById('map');
      if (mapEl) mapEl.innerHTML = `<div class="flex items-center justify-center h-full text-red-400 p-8 text-center bg-gray-900/50 rounded-2xl border border-red-500/30">
        <div>
          <p class="font-bold text-lg mb-2">⚠️ Configuration Missing</p>
          <p class="text-sm opacity-80">Please check console for details and ensure <b>config.js</b> is present.</p>
        </div>
      </div>`;
    }, 500);
    return;
  }
  const CONFIG = window.CONFIG;

  // ── 1. Initialize Supabase Client ─────────────────────────────────
  const supabase = window.supabase ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;

  // ── 2. Initialize Leaflet Map (independent of Supabase) ─────────
  const mapEl = document.getElementById('map');

  if (mapEl) {
    if (typeof L === 'undefined') {
      showToast('Map library failed to load. Check your internet connection.', true);
      mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;">⚠️ Map library failed to load. Check your internet connection.</div>';
    } else {
      const map = L.map('map', { zoomControl: true }).setView([22.5, 80.0], 5);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Force Leaflet to recalculate size after page renders
      setTimeout(() => map.invalidateSize(), 300);

      // LayerGroup to hold dynamically updated markers
      const markerGroup = L.layerGroup().addTo(map);
      window.currentMarkersMap = {};

      // ── 3. Load NGO Data from Supabase (if available) ────────────
      if (supabase) {
        // Helper to render markers on map
        function renderMarkers(ngos, isSmartSearch = false, query = '') {
          markerGroup.clearLayers();
          window.currentMarkersMap = {};
          
          ngos.forEach(ngo => {
            const name = ngo.ngo_name || ngo.name;
            const similarity = ngo.similarity || 0;
            const needsText = (ngo.needs || '').toLowerCase();
            const isUrgent = needsText.includes('urgent') || needsText.includes('emergency');
            const isPulsing = isSmartSearch && similarity >= 0.6;
            
            if (isSmartSearch) {
              console.log(`[AI Match] ${name}: ${Math.round(similarity * 100)}%`);
            }

            const marker = L.marker([ngo.lat, ngo.lng], { icon: getMarkerIcon(ngo.category, isPulsing, isUrgent) });

            let similarityHtml = '';
            if (isSmartSearch) {
              similarityHtml = `
                <div style="margin-top:8px;padding-top:8px;border-top:1px solid #374151;">
                  <div style="color:#10b981;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;">
                    ✨ ${Math.round(ngo.similarity * 100)}% Match
                  </div>
                  <div id="reason-${ngo.survey_id}" style="color:#a8b3cf;font-size:11px;font-weight:400;margin-top:4px;font-style:italic;">
                    Generating match reason...
                  </div>
                  <div style="color:#d1d5db;font-weight:400;margin-top:6px;font-size:12px;">Need: <i>"${ngo.needs}"</i></div>
                  
                  <button id="commit-btn-${ngo.survey_id}" onclick="window.commitToTask('${ngo.survey_id}', '${name.replace(/'/g, "\\'")}')" 
                    style="margin-top:10px;width:100%;background:#059669;color:#fff;border:none;padding:6px 0;border-radius:6px;font-weight:600;cursor:pointer;transition:all 0.2s;"
                    onmouseover="this.style.backgroundColor='#047857'" onmouseout="this.style.backgroundColor='#059669'">
                    Commit to Task
                  </button>
                </div>
              `;
            }

            marker.bindPopup(`
              <div style="font-family:sans-serif;min-width:180px;max-width:260px;">
                <p style="font-weight:700;font-size:14px;margin:0 0 4px;">${name}</p>
                <p style="color:#6b7280;font-size:12px;margin:0 0 6px;">📍 ${ngo.region}</p>
                <span style="background:${CATEGORY_COLORS[ngo.category] || '#94a3b8'}33;color:${CATEGORY_COLORS[ngo.category] || '#94a3b8'};border:1px solid ${CATEGORY_COLORS[ngo.category] || '#94a3b8'}66;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600;">${ngo.category}</span>
                ${similarityHtml}
              </div>
            `);

            // Lazy-load AI reason when popup opens
            if (isSmartSearch) {
              marker.on('popupopen', async () => {
                const reasonEl = document.getElementById(`reason-${ngo.survey_id}`);
                if (reasonEl && reasonEl.textContent.includes('Generating')) {
                  const reason = await getMatchReason(query, ngo.needs, ngo.age_days || 0);
                  reasonEl.textContent = reason;
                }
              });
            }

            marker.addTo(markerGroup);
            if (ngo.survey_id) {
              window.currentMarkersMap[ngo.survey_id] = marker;
            }
          });
        }

        (async function loadInitialData() {
          try {
            // Priority 1: Advanced Relational fetch (Flattened survey + NGO data)
            let { data: surveys, error } = await supabase
              .from('surveys')
              .select('id, needs, created_at, ngos(name, region, lat, lng, category)')
              .eq('is_available', true);
            
            if (error) throw error;

            // Transform to the flat structure renderMarkers expects
            const transformedData = surveys.map(s => ({
              survey_id: s.id,
              needs: s.needs,
              ngo_name: s.ngos.name,
              region: s.ngos.region,
              lat: s.ngos.lat,
              lng: s.ngos.lng,
              category: s.ngos.category
            }));

            // Update NGO Count (Unique NGOs with active needs)
            const uniqueNgoNames = new Set(transformedData.map(d => d.ngo_name));
            const countEl = document.getElementById('count-ngos');
            if (countEl) countEl.textContent = uniqueNgoNames.size;

            // Update Total Surveys Count
            const surveyEl = document.getElementById('count-surveys');
            if (surveyEl) surveyEl.textContent = transformedData.length;

            renderMarkers(transformedData);
            loadRecentUrgentNeeds();

          } catch (err) {
            console.warn('Initial load failed. Check relationship or schema:', err);
            // Fallback: Just load NGOs without survey context if needed
            const { data: ngos } = await supabase.from('ngos').select('*');
            if (ngos) {
              const countEl = document.getElementById('count-ngos');
              if (countEl) countEl.textContent = ngos.length;
              renderMarkers(ngos);
            }
          }
        })();

        // ── Smart Search Feature ──────────────────────────────────
        const searchInput = document.getElementById('smart-search-input');
        const searchBtn = document.getElementById('smart-search-btn');
        const searchIcon = document.getElementById('search-icon');
        const searchSpinner = document.getElementById('search-spinner');
        const searchStatus = document.getElementById('search-status');

        if (searchInput && searchBtn) {
          async function executeSearch() {
            const query = searchInput.value.trim();
            if (!query) {
              // Reload active NGOs explicitly if query is empty
              try {
                const { data, error } = await supabase
                  .from('ngos')
                  .select('*, surveys!inner(id)')
                  .eq('surveys.is_available', true);
                
                if (error) {
                  console.error('Supabase Search-Reset Error:', error);
                }
                if (data) renderMarkers(data);
                searchStatus.textContent = '';
              } catch(e){
                console.error('Error resetting search:', e);
              }
              return;
            }

            // UI Loading State
            searchIcon.classList.add('hidden');
            searchSpinner.classList.remove('hidden');
            searchStatus.textContent = 'Generating AI embedding and matching...';
            searchStatus.classList.replace('text-red-400', 'text-gray-500');

            try {
              // 1. Get embedding for user's skill/tool description
              const embedding = await getEmbedding(query);

              // 2. Call Supabase RPC to match against survey needs
              const { data: matches, error } = await supabase.rpc('match_surveys', {
                query_embedding: embedding,
                match_threshold: 0.1, // Adjust as needed
                match_count: 5 // Top 5 best matches
              });
              if (error) throw error;

              // 3. Update map
              renderMarkers(matches || [], true, query);

              searchStatus.textContent = matches && matches.length > 0 
                ? `Found ${matches.length} matching needs globally.` 
                : 'No relevant NGO needs found across submitted surveys.';
                
            } catch (err) {
              const errMsg = err.message.includes('API key') ? 'Mistral API key missing or invalid.' : err.message;
              showToast(errMsg, true);
              searchStatus.textContent = '';
            } finally {
              searchIcon.classList.remove('hidden');
              searchSpinner.classList.add('hidden');
            }
          }

          searchBtn.addEventListener('click', executeSearch);
          searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeSearch();
          });
        }

        // ── Recent Urgent Needs Sidebar ───────────────────────────
        async function loadRecentUrgentNeeds() {
          const sidebar = document.getElementById('urgent-needs-sidebar');
          if (!sidebar) return;

          try {
            const { data: surveys, error } = await supabase
              .from('surveys')
              .select('id, ngo_name, needs, created_at')
              .eq('is_available', true)
              .order('created_at', { ascending: false })
              .limit(3);

            if (error) throw error;

            if (!surveys || surveys.length === 0) {
              sidebar.innerHTML = '<div class="text-gray-500 text-sm italic py-4">No active needs at the moment.</div>';
              return;
            }

            sidebar.innerHTML = surveys.map(s => {
              const date = new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              return `
                <div class="urgent-need-card cursor-pointer group" onclick="window.focusOnSurvey('${s.id}')">
                  <div class="flex justify-between items-start mb-1">
                    <span class="text-xs font-bold text-blue-400 uppercase tracking-wider">${s.ngo_name}</span>
                    <span class="text-[10px] text-gray-500">${date}</span>
                  </div>
                  <p class="text-sm text-gray-300 line-clamp-2 group-hover:text-white transition-colors">"${s.needs}"</p>
                </div>
              `;
            }).join('');

          } catch (err) {
            console.error('Failed to load recent needs:', err);
            sidebar.innerHTML = '<div class="text-red-400 text-xs py-2">Failed to load recent needs.</div>';
          }
        }

        window.focusOnSurvey = function(surveyId) {
          if (window.currentMarkersMap && window.currentMarkersMap[surveyId]) {
            const marker = window.currentMarkersMap[surveyId];
            marker.openPopup();
            map.flyTo(marker.getLatLng(), 12);
          }
        };

      } else {
        showToast('Supabase failed to load. Map only mode active.', true);
      }

      // ── Global Commit to Task Flow ─────────────────────────────
      window.commitToTask = async function(surveyId, ngoName) {
        if (!surveyId || !supabase) return;
        
        const btn = document.getElementById(`commit-btn-${surveyId}`);
        if (btn) {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
          btn.textContent = 'Committing...';
        }

        try {
          // Update database
          const { error } = await supabase.from('surveys').update({ is_available: false }).eq('id', surveyId);
          if (error) throw error;
          
          // Instantly remove marker from map without refetching
          if (window.currentMarkersMap[surveyId]) {
            markerGroup.removeLayer(window.currentMarkersMap[surveyId]);
            delete window.currentMarkersMap[surveyId];
          }
          
          // Show Success Modal
          const modal = document.getElementById('success-modal');
          const closeBtn = document.getElementById('close-modal-btn');
          const nameSpan = document.getElementById('modal-ngo-name');
          
          if (modal) {
            if (nameSpan) nameSpan.textContent = ngoName || 'this task';
            modal.classList.remove('hidden');
            if (closeBtn) {
              closeBtn.onclick = () => {
                modal.classList.add('hidden');
                // Reset search to default
                const searchInput = document.getElementById('smart-search-input');
                const searchBtn = document.getElementById('smart-search-btn');
                if (searchInput && searchBtn) {
                  searchInput.value = '';
                  searchBtn.click();
                }
              };
            }
          }
        } catch (err) {
          console.error('Commit-to-Task Error:', err);
          showToast('Could not commit to task. Please try again later.', true);
          if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.textContent = 'Commit to Task';
          }
        }
      };

    }
  }

  // ── 3. Page-Specific Initializers ─────────────────────────────
  
  // A: NGO Survey Page (ngo.html)
  const ngoSelector = document.getElementById('ngo-name-select');
  const regionInput = document.getElementById('ngo-region');
  const surveyBtn   = document.getElementById('submit-survey');
  let ngoCache = [];

  if (ngoSelector && surveyBtn) {
    async function refreshNgoList() {
      try {
        const { data, error } = await supabase.from('ngos').select('*').order('name');
        if (error) throw error;
        ngoCache = data;
        ngoSelector.innerHTML = '<option value="" disabled selected>Select an Organization</option>';
        data.forEach(ngo => {
          const opt = document.createElement('option');
          opt.value = ngo.name;
          opt.textContent = ngo.name;
          ngoSelector.appendChild(opt);
        });
      } catch (e) {
        console.error('Failed to fill NGO dropdown:', e);
      }
    }

    refreshNgoList();
    ngoSelector.onchange = () => {
      const chosen = ngoCache.find(n => n.name === ngoSelector.value);
      if (chosen && regionInput) regionInput.value = chosen.region;
    };

    surveyBtn.onclick = async () => {
      const needs = document.getElementById('ngo-needs').value.trim();
      const status = document.getElementById('survey-status');
      if (!ngoSelector.value || !needs) {
        showStatus(status, '⚠️ Please select an organization and describe needs.', 'warn');
        return;
      }
      surveyBtn.disabled = true;
      surveyBtn.textContent = 'Submitting...';
      showStatus(status, '⏳ Submitting needs...', 'info');
      try {
        const embedding = await getEmbedding(needs);
        const { error } = await supabase.from('surveys').insert([{ 
          ngo_name: ngoSelector.value, 
          region: regionInput ? regionInput.value : '', 
          needs, 
          embedding 
        }]);
        if (error) throw error;
        showToast('Survey submitted successfully!');
        showStatus(status, '✅ Done! Match is now live.', 'success');
        document.getElementById('ngo-needs').value = '';
      } catch (e) {
        showToast(e.message, true);
        showStatus(status, '❌ Submission failed.', 'error');
      } finally {
        surveyBtn.disabled = false;
        surveyBtn.textContent = 'Submit Survey';
      }
    };
  }

  // B: NGO Registration Page (register.html)
  const regMapEl = document.getElementById('registration-map');
  const regBtn   = document.getElementById('submit-registration');

  if (regMapEl && regBtn) {
    let regMap, regMarker;
    regMap = L.map('registration-map').setView([22.5, 80.0], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(regMap);

    regMap.on('click', (e) => {
      const { lat, lng } = e.latlng;
      document.getElementById('reg-lat').value = lat.toFixed(6);
      document.getElementById('reg-lng').value = lng.toFixed(6);
      if (regMarker) {
        regMarker.setLatLng(e.latlng);
      } else {
        regMarker = L.marker(e.latlng, { draggable: true }).addTo(regMap);
        regMarker.on('dragend', (de) => {
          const pos = de.target.getLatLng();
          document.getElementById('reg-lat').value = pos.lat.toFixed(6);
          document.getElementById('reg-lng').value = pos.lng.toFixed(6);
        });
      }
    });

    regBtn.onclick = async () => {
      const name = document.getElementById('reg-name').value.trim();
      const cat  = document.getElementById('reg-category').value;
      const reg  = document.getElementById('reg-region').value.trim();
      const lat  = parseFloat(document.getElementById('reg-lat').value);
      const lng  = parseFloat(document.getElementById('reg-lng').value);
      const status = document.getElementById('reg-status');

      if (!name || !reg || isNaN(lat)) {
        showToast('Please provide a name, region, and click on the map.', true);
        return;
      }
      regBtn.disabled = true;
      regBtn.textContent = 'Registering...';
      showStatus(status, '🚀 Registering NGO...', 'info');

      try {
        const { error } = await supabase.from('ngos').insert([{ 
          name, region: reg, category: cat, lat, lng 
        }]);
        if (error) throw error;
        showToast(`Successfully registered ${name}!`);
        showStatus(status, '✅ Registered! Redirecting to survey...', 'success');
        setTimeout(() => window.location.href = 'ngo.html', 1500);
      } catch (e) {
        showToast(e.message, true);
        showStatus(status, '❌ Registration failed.', 'error');
      } finally {
        regBtn.disabled = false;
        regBtn.textContent = 'Complete Registration';
      }
    };
  }
});
