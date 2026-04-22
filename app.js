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

// UPGRADE 1: HEATMAP (Init)
let heatLayer = null;
const DEFAULT_TASK_HOURS = 2;

function getMarkerIcon(category, isPulsing = false, isUrgent = false, urgencyLevel = 'Low', isOwner = false) {
  let color = CATEGORY_COLORS[category] || CATEGORY_COLORS['General'];
  
  // UPGRADE 2: AI TRIAGE SYSTEM (Colors)
  if (urgencyLevel === 'High') color = '#ef4444'; // Red
  else if (urgencyLevel === 'Medium') color = '#f97316'; // Orange
  
  // Customization for Owner
  let ownerStyle = '';
  let ownerIcon = '<circle cx="12" cy="11" r="5" fill="#fff"/>';
  if (isOwner) {
    color = '#10b981'; // Emerald for owner
    ownerStyle = 'filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.6));';
    ownerIcon = `<path d="M12 6.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#fff"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="36" style="display:block;${ownerStyle}">
    <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"/>
    ${ownerIcon}
  </svg>`;
  
  let className = 'leaflet-marker-icon';
  if (isPulsing) className += ' pulse-marker';
  if (isUrgent || urgencyLevel === 'High') className += ' pulse-red';
  if (isOwner) className += ' owner-marker-glow';

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



// ─── AI Helper: Get Match Reason ─────────────────────────────────
async function getMatchReason(skill, need, ageDays = 0) {
  try {
    if (typeof window.callGeminiGenerate !== 'function') return 'Good match for your skills.';
    return await window.callGeminiGenerate(
      'Write one short sentence that explains why the volunteer skill could match the NGO need. Keep it practical, specific, and under 160 characters.',
      `Volunteer skills: ${skill || ''}\nNeed: ${need || ''}`
    );
  } catch (err) {
    return 'Good match for your skills.';
  }
}
// ═══════════════════════════════════════════════════════════════
// Run everything after DOM is ready
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
  // ── UI Micro-Parallax (performance-safe) ─────────────────────────
  (function setupAmbientParallax() {
    const shells = document.querySelectorAll('.sa-main-shell, .ngo-main-shell, .volunteer-main-shell');
    if (!shells.length) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ticking = false;
    const update = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      const shift = Math.max(-18, Math.min(18, y * 0.035));
      document.documentElement.style.setProperty('--sa-parallax-shift', `${shift.toFixed(2)}px`);
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
  })();

  (function setupGlobalEscapeClose() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;

      const successModal = document.getElementById('success-modal');
      if (successModal && !successModal.classList.contains('hidden')) {
        successModal.classList.add('hidden');
      }

      const profileModal = document.getElementById('profile-modal');
      if (profileModal && !profileModal.classList.contains('hidden')) {
        profileModal.classList.add('hidden');
      }

      const needsPanel = document.getElementById('needs-overview-panel');
      if (needsPanel && needsPanel.classList.contains('open')) {
        needsPanel.classList.remove('open');
      }

      const chatPanel = document.getElementById('chat-panel');
      if (chatPanel && !chatPanel.classList.contains('translate-x-full') && typeof window.closeChatPanel === 'function') {
        window.closeChatPanel();
      }
    });
  })();
  
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

  // ── 1.1 Authentication & Session Management ──────────────────────
  let userProfileCache = null;
  let authRedirectInProgress = false;

  async function getUserProfile(userId) {
    if (userProfileCache) return userProfileCache;
    if (!userId) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (!error) userProfileCache = data;
    return data;
  }

  async function updateAuthUI(session) {
    const authNav = document.getElementById('auth-nav');
    if (!authNav) return;

    if (session && session.user) {
      const profile = await getUserProfile(session.user.id);
      const roleLabel = profile ? profile.role : 'User';
      
      // Get display name (Organization name for NGOs, Email for others)
      let displayName = session.user.email;
      if (profile && profile.role === 'NGO') {
        const { data: ngoInfo } = await supabase.from('ngo_details').select('org_name').eq('user_id', session.user.id).maybeSingle();
        if (ngoInfo && ngoInfo.org_name) {
          displayName = ngoInfo.org_name;
        } else {
          const { data: ngoMap } = await supabase.from('ngos').select('name').eq('user_id', session.user.id).maybeSingle();
          if (ngoMap && ngoMap.name) displayName = ngoMap.name;
        }
      }

      authNav.innerHTML = `
        <div class="flex flex-col items-end mr-1">
            <span class="text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none mb-0.5">${roleLabel}</span>
            <span class="text-xs text-white opacity-80 font-medium leading-none">${displayName}</span>
        </div>
        <a href="volunteer-dashboard.html" id="nav-inbox-btn" class="sa-btn-ghost text-xs relative flex items-center gap-1 hidden" title="My Invitations">
          📬 Inbox
          <span id="nav-inbox-badge" class="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full hidden">0</span>
        </a>
        <button id="push-notify-btn" class="sa-btn-ghost text-xs hidden" title="Enable Proximity Alerts">
          🔔 Alerts
        </button>
        <a href="profile.html" class="sa-btn-ghost text-xs">
          Account
        </a>
        <button id="sign-out-btn" class="sa-btn-ghost text-xs">
          Sign Out
        </button>
      `;

      // Role-based Navbar Updates
      const navNgoSurvey = document.getElementById('nav-ngo-survey');
      const navRegisterNgo = document.getElementById('nav-register-ngo');
      const searchInput = document.getElementById('smart-search-input');
      const urgentTitle = document.querySelector('#urgent-needs-sidebar')?.parentElement?.querySelector('h2');

      if (profile && profile.role === 'Volunteer') {
          if (navNgoSurvey) navNgoSurvey.classList.add('hidden');
          if (navRegisterNgo) navRegisterNgo.classList.add('hidden');
          if (searchInput) searchInput.placeholder = "Describe your skills (e.g., I have medical tools & a 4x4)...";
          if (urgentTitle) urgentTitle.innerHTML = `<span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span> Donation Opportunities`;
          
          const notifyBtn = document.getElementById('push-notify-btn');
          if (notifyBtn) {
            notifyBtn.classList.remove('hidden');
            if (Notification.permission === 'granted') {
              notifyBtn.classList.add('text-emerald-400');
              notifyBtn.innerHTML = '🔕 Active';
              if (window.setupPushNotifications) window.setupPushNotifications();
            }
            notifyBtn.onclick = () => {
              if (window.setupPushNotifications) {
                window.setupPushNotifications(true).then(granted => {
                  if (granted) {
                    notifyBtn.classList.add('text-emerald-400');
                    notifyBtn.innerHTML = '🔕 Active';
                  }
                });
              }
            };
          }

          // Add Volunteer Dashboard link
          const mainNavLinks = document.getElementById('main-nav-links');
          const hasVolunteerLink = !!mainNavLinks?.querySelector('a[href="volunteer-dashboard.html"]');
          if (mainNavLinks && !hasVolunteerLink) {
            const dashLink = document.createElement('a');
            dashLink.id = 'nav-vol-dashboard';
            dashLink.href = 'volunteer-dashboard.html';
            dashLink.className = 'sa-nav-link';
            dashLink.textContent = 'Volunteer Dashboard';
            mainNavLinks.insertBefore(dashLink, document.getElementById('auth-nav'));
          }

          const inboxBtn = document.getElementById('nav-inbox-btn');
          if (inboxBtn) {
            inboxBtn.classList.remove('hidden');
            syncInboxBadge(session.user.id);
            setupInboxRealtime(session.user.id);
          }
      } else if (profile && profile.role === 'NGO') {
          if (navNgoSurvey) navNgoSurvey.classList.remove('hidden');
          if (navRegisterNgo) navRegisterNgo.classList.remove('hidden');
          if (searchInput) searchInput.placeholder = "Search available resources or community skills...";
          if (urgentTitle) urgentTitle.innerHTML = `<span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Management Tasks`;
          // Add NGO Dashboard link
          const mainNavLinks = document.getElementById('main-nav-links');
          const hasNgoDashboardLink = !!mainNavLinks?.querySelector('a[href="ngo-dashboard.html"]');
          if (mainNavLinks && !hasNgoDashboardLink) {
            const dashLink = document.createElement('a');
            dashLink.id = 'nav-ngo-dashboard';
            dashLink.href = 'ngo-dashboard.html';
            dashLink.className = 'sa-nav-link';
            dashLink.textContent = 'NGO Dashboard';
            mainNavLinks.insertBefore(dashLink, document.getElementById('auth-nav'));
          }

          // Fetch NGO name for sidebar management features
          (async () => {
            const { data } = await supabase.from('ngo_details').select('org_name').eq('user_id', profile.id).single();
            if (data) {
                window.userOrgName = data.org_name;
                // Re-load sidebar with owner-specific context
                loadRecentUrgentNeeds();
                loadGlobalPriorityEngine();
            }
          })();
      }

      document.getElementById('sign-out-btn').onclick = async () => {
        await supabase.auth.signOut();
        userProfileCache = null;
        window.location.href = 'index.html';
      };

      // Hide CTA login sections when user is already logged in
      ['cta-section-1'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    } else {
      // Show CTA sections when logged out
      ['cta-section-1'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });

      authNav.innerHTML = `
        <a href="login.html" class="sa-btn-ghost text-sm">Sign In</a>
        <a href="login.html" class="sa-btn-primary text-sm">Get Started
      
        </a>
      `;
    }
  }

  async function checkRoleAndRedirect(session) {
    if (authRedirectInProgress) return;
    const path = window.location.pathname.toLowerCase();
    const isLogin = path.includes('login');
    const isNgoPage = path.includes('ngo.html') || path.includes('register.html');
    
    if (!session) {
      if (!isLogin) {
        authRedirectInProgress = true;
        window.location.href = 'login.html';
      }
      return;
    }

    const profile = await getUserProfile(session.user.id);
    if (!profile) return;

    if (profile.role === 'Volunteer' && isNgoPage) {
        authRedirectInProgress = true;
        window.location.href = 'index.html';
    } 

    if (isLogin) {
        authRedirectInProgress = true;
        window.location.href = 'index.html';
        return;
    }

    const tableName = profile.role === 'NGO' ? 'ngo_details' : 'volunteer_details';
    let { data: details } = await supabase.from(tableName).select('id').eq('user_id', session.user.id).maybeSingle();
    
    // Unified Detection: For NGOs, check the 'ngos' table too
    if (!details && profile.role === 'NGO') {
      const { data: ngoMap } = await supabase.from('ngos').select('id, name').eq('user_id', session.user.id).maybeSingle();
      if (ngoMap) {
        // Auto-bridge: Create a phantom detail entry to stop the nagging
        const { error } = await supabase.from('ngo_details').insert([{
            user_id: session.user.id,
            org_name: ngoMap.name,
            contact_name: profile.full_name || 'Administrator',
            org_type: profile.category || 'General'
        }]);
        if (!error) details = { id: 'bridged' };
      }
    }
    if (!details && profile.role === 'NGO') {
      const metadataOrgName = (session.user.user_metadata?.full_name || profile.full_name || '').trim();
      if (metadataOrgName) {
        const { error: metadataBridgeError } = await supabase.from('ngo_details').upsert([{
          user_id: session.user.id,
          org_name: metadataOrgName,
          contact_name: profile.full_name || metadataOrgName || 'Administrator',
          org_type: profile.category || session.user.user_metadata?.category || 'General'
        }], { onConflict: 'user_id' });
        if (!metadataBridgeError) details = { id: 'metadata-bridged' };
      }
    }

    const hasSkipped = localStorage.getItem(`skip_profile_${session.user.id}`);
    
    if (!details && !hasSkipped) {
        setupProfileModal(profile.role, session.user.id);
    }

    // FIX 2: Auto-match on login for volunteers
    if (profile.role === 'Volunteer' && details) {
      const { data: volDetail } = await supabase.from('volunteer_details').select('skills_summary').eq('user_id', session.user.id).single();
      if (volDetail && volDetail.skills_summary) {
        window._volunteerSkillsSummary = volDetail.skills_summary;
        // FIX 7: Auto-populate search placeholder
        const searchInput = document.getElementById('smart-search-input');
        if (searchInput) {
          searchInput.placeholder = volDetail.skills_summary;
        }
        // Auto-run match search on index page
        if (!path.includes('dashboard') && !isLogin) {
          setTimeout(() => window._runAutoMatch && window._runAutoMatch(volDetail.skills_summary), 1500);
        }
      }
    }
  }

  function setupProfileModal(role, userId) {
      const modal = document.getElementById('profile-modal');
      const ngoForm = document.getElementById('ngo-details-form');
      const volForm = document.getElementById('volunteer-details-form');
      const skipBtn = document.getElementById('skip-profile-btn');
      
      if (!modal) return;
      modal.classList.remove('hidden');

      if (skipBtn) {
          skipBtn.onclick = () => {
              localStorage.setItem(`skip_profile_${userId}`, 'true');
              modal.classList.add('hidden');
          };
      }

      // Also wire up the X close button
      const skipXBtn = document.getElementById('skip-profile-x-btn');
      if (skipXBtn) {
          skipXBtn.onclick = () => {
              localStorage.setItem(`skip_profile_${userId}`, 'true');
              modal.classList.add('hidden');
          };
      }

      if (role === 'NGO') {
          ngoForm.classList.remove('hidden');
          ngoForm.onsubmit = async (e) => {
              e.preventDefault();
              const org_name = document.getElementById('ngo-org-name').value;
              const contact_name = document.getElementById('ngo-contact-name').value;
              const org_type = document.getElementById('ngo-org-type').value;
              const phone = document.getElementById('ngo-phone').value;

              const { error } = await supabase.from('ngo_details').insert([{
                  user_id: userId, org_name, contact_name, org_type, phone
              }]);

              if (!error) modal.classList.add('hidden');
              else alert('Error saving profile: ' + error.message);
          };
      } else {
          volForm.classList.remove('hidden');
          volForm.onsubmit = async (e) => {
              e.preventDefault();
              const full_name = document.getElementById('vol-full-name').value;
              const skills_summary = document.getElementById('vol-skills').value;
              const phone = document.getElementById('vol-phone').value;
              const location_name = document.getElementById('vol-location')?.value || '';
              const skills = skills_summary.split(',').map(s => s.trim()).filter(s => s);
              const availability = {
                weekdays: document.getElementById('vol-avail-weekdays')?.checked || false,
                weekends: document.getElementById('vol-avail-weekends')?.checked || false
              };

              const { error } = await supabase.from('volunteer_details').insert([{
                  user_id: userId, full_name, skills_summary, phone,
                  location_name, skills, availability
              }]);

              if (!error) {
                modal.classList.add('hidden');
                // FIX 10: Auto-run match search after first profile save
                window._volunteerSkillsSummary = skills_summary;
                const searchInput = document.getElementById('smart-search-input');
                if (searchInput) searchInput.placeholder = skills_summary;
                showToast('Finding tasks that match your skills...');
                setTimeout(() => window._runAutoMatch && window._runAutoMatch(skills_summary), 800);
              }
              else alert('Error saving profile: ' + error.message);
          };
      }
  }

  if (supabase) {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      updateAuthUI(session);
      checkRoleAndRedirect(session);
      if (session) loadMyCommitments(session.user.id);
    });

    // Listen for auth changes
    supabase.auth.onAuthStateChange((event, session) => {
      updateAuthUI(session);
      if (event === 'SIGNED_IN') {
        checkRoleAndRedirect(session);
      }
      if (!session) {
        const path = window.location.pathname.toLowerCase();
        if (!path.includes('login') && !authRedirectInProgress) {
          authRedirectInProgress = true;
          window.location.href = 'login.html';
        }
      }
    });
  }

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
      let fullDataset = [];
      let currentUrgencyFilter = '';

      // ── 3. Load NGO Data from Supabase (if available) ────────────
      if (supabase) {
        // Helper to render markers on map
        function renderMarkers(ngos, isSmartSearch = false, query = '') {
          markerGroup.clearLayers();
          window.currentMarkersMap = {};

          if (!ngos || ngos.length === 0) {
            showMapEmptyState(true);
            return;
          }
          showMapEmptyState(false);
          
          ngos.forEach(ngo => {
            const name = ngo.ngo_name || ngo.name;
            const similarity = ngo.similarity || 0;
            const needsText = (ngo.needs || '').toLowerCase();
            const isUrgent = (ngo.needs || '').toLowerCase().includes('urgent') || ngo.urgency_level === 'High';
            const isPulsing = isSmartSearch && similarity >= 0.7;
            
            const isOwner = (userProfileCache && ngo.user_id && userProfileCache.id === ngo.user_id);
            const marker = L.marker([ngo.lat, ngo.lng], { 
                icon: getMarkerIcon(ngo.category, isPulsing, isUrgent, ngo.urgency_level, isOwner) 
            });

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
                  <div style="color:#d1d5db;font-weight:400;margin-top:6px;font-size:12px;">Need: <i>"${escapeHtml(ngo.needs)}"</i></div>
                  
                  ${(userProfileCache && userProfileCache.role === 'Volunteer') ? `
                  <button id="commit-btn-${ngo.survey_id}" onclick="window.commitToTask('${ngo.survey_id}', '${escapeHtml(name).replace(/'/g, "\\'")}')" 
                    style="margin-top:10px;width:100%;background:#2563eb;color:#fff;border:none;padding:8px 0;border-radius:10px;font-weight:700;font-size:12px;cursor:pointer;transition:all 0.2s;box-shadow:0 10px 15px -3px rgba(37,99,235,0.2);"
                    onmouseover="this.style.backgroundColor='#1d4ed8'" onmouseout="this.style.backgroundColor='#2563eb'">
                    Commit to Need
                  </button>` : `
                  <div style="margin-top:10px;padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;text-align:center;font-size:10px;color:rgba(255,255,255,0.4);border:1px dashed rgba(255,255,255,0.1);">
                    Login as Volunteer to Commit
                  </div>`}
                </div>
              `;
            }

            marker.bindPopup(`
              <div style="font-family:sans-serif;min-width:180px;max-width:260px;">
                <p style="font-weight:700;font-size:14px;margin:0 0 4px;">${escapeHtml(name)}</p>
                <p style="color:#6b7280;font-size:12px;margin:0 0 6px;">📍 ${escapeHtml(ngo.region)}</p>
                <span style="background:${CATEGORY_COLORS[ngo.category] || '#94a3b8'}33;color:${CATEGORY_COLORS[ngo.category] || '#94a3b8'};border:1px solid ${CATEGORY_COLORS[ngo.category] || '#94a3b8'}66;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600;">${escapeHtml(ngo.category)}</span>
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

          // UPGRADE 1: HEATMAP (Update)
          updateHeatmap(ngos);
        }

        // UPGRADE 1: HEATMAP (Logic) — FIX 1: Real data only, no mock points
        function updateHeatmap(surveys) {
          if (!Array.isArray(surveys)) {
            return;
          }
          if (heatLayer) map.removeLayer(heatLayer);

          const heatPoints = surveys.map(s => {
              let intensity = 0.2;
              if (s.urgency_level === 'High') intensity = 1.0;
              else if (s.urgency_level === 'Medium') intensity = 0.5;
              return [s.lat, s.lng, intensity];
          });

          try {
              heatLayer = L.heatLayer(heatPoints, {
                radius: 25,
                blur: 15,
                maxZoom: 10,
                gradient: { 0.4: 'yellow', 0.65: 'orange', 1: 'red' }
              });
              const btn = document.getElementById('toggleHeatmap');
              if (btn && btn.classList.contains('bg-blue-600')) {
                  heatLayer.addTo(map);
              }
          } catch (e) {
              console.error("[Heatmap] Error initializing heatlayer:", e);
          }
        }

        const heatmapBtn = document.getElementById('toggleHeatmap');
        if (heatmapBtn) {
            heatmapBtn.onclick = () => {
                const isActive = heatmapBtn.classList.toggle('bg-blue-600');
                heatmapBtn.classList.toggle('bg-gray-800');
                heatmapBtn.classList.toggle('text-white');
                heatmapBtn.classList.toggle('text-gray-400');
                if (isActive && heatLayer) heatLayer.addTo(map);
                else if (heatLayer) map.removeLayer(heatLayer);
            }
        }

        (async function loadInitialData() {
          try {
            // Priority 1: Fetch all NGOs so they always appear on the map
            const { data: ngos, error: ngoError } = await supabase.from('ngos').select('*');
            if (ngoError) throw ngoError;

            // Priority 2: Fetch all active surveys to overlay on the NGOs
            const { data: surveys, error: surveyError } = await supabase
              .from('surveys')
              .select('id, needs, urgency_level, ngo_name')
              .eq('is_available', true);

            // Merge surveys into NGOs
            const transformedData = ngos.map(ngo => {
              const survey = (surveys || []).find(s => s.ngo_name === ngo.name);
              return {
                ...ngo,
                survey_id: survey ? survey.id : null,
                needs: survey ? survey.needs : null,
                urgency_level: survey ? survey.urgency_level : 'Low',
                is_active: !!survey
              };
            });

            // Update NGO Count
            const countEl = document.getElementById('count-ngos');
            if (countEl) countEl.textContent = ngos.length;

            // Update Total Surveys Count
            const surveyEl = document.getElementById('count-surveys');
            if (surveyEl) surveyEl.textContent = (surveys || []).length;
            const allocationsEl = document.getElementById('count-allocations');
            if (allocationsEl) {
              const { count: allocationsCount } = await supabase
                .from('surveys')
                .select('*', { count: 'exact', head: true })
                .eq('is_available', false);
              allocationsEl.textContent = allocationsCount ?? 0;
            }

            fullDataset = transformedData; // Cache
            renderMarkers(transformedData);
            loadRecentUrgentNeeds();
            loadGlobalPriorityEngine();
            loadPrototypeMetrics();

          } catch (err) {
            console.warn('Initial load failed:', err);
            // Minimal fallback
            const { data: ngos } = await supabase.from('ngos').select('*');
            if (ngos) renderMarkers(ngos);
            else showMapEmptyState(true);
            loadPrototypeMetrics();
          }
        })();

        async function loadPrototypeMetrics() {
          const responseEl = document.getElementById('kpi-response-time');
          const responseNoteEl = document.getElementById('kpi-response-note');
          const matchEl = document.getElementById('kpi-match-quality');
          const matchNoteEl = document.getElementById('kpi-match-note');
          const unmetEl = document.getElementById('kpi-unmet-needs');
          const unmetNoteEl = document.getElementById('kpi-unmet-note');
          if (!responseEl && !matchEl && !unmetEl) return;

          try {
            const { data: surveys, error: surveysError } = await supabase
              .from('surveys')
              .select('created_at, assigned_at, updated_at, committed_by, is_available, status')
              .order('created_at', { ascending: false })
              .limit(500);
            if (surveysError) throw surveysError;

            const committed = (surveys || []).filter(s => !!s.committed_by && s.created_at && (s.assigned_at || s.updated_at));
            const responseHours = committed
              .map(s => {
                // Prefer assigned_at as true first-response timestamp; fallback keeps legacy data readable.
                const responseAt = s.assigned_at || s.updated_at;
                return (new Date(responseAt).getTime() - new Date(s.created_at).getTime()) / 3600000;
              })
              .filter(v => Number.isFinite(v) && v >= 0);
            if (responseEl) {
              if (responseHours.length > 0) {
                const avg = responseHours.reduce((a, b) => a + b, 0) / responseHours.length;
                responseEl.textContent = `${avg.toFixed(1)}h`;
                if (responseNoteEl) responseNoteEl.textContent = `Average first-assignment time across ${responseHours.length} committed tasks.`;
              } else {
                responseEl.textContent = '--';
                if (responseNoteEl) responseNoteEl.textContent = 'Need committed tasks to compute average response time.';
              }
            }

            const { data: invites, error: invitesError } = await supabase
              .from('invitations')
              .select('status')
              .in('status', ['accepted', 'declined'])
              .limit(1000);
            if (invitesError) throw invitesError;

            if (matchEl) {
              const totalReviewed = (invites || []).length;
              if (totalReviewed > 0) {
                const accepted = invites.filter(i => i.status === 'accepted').length;
                const quality = Math.round((accepted / totalReviewed) * 100);
                matchEl.textContent = `${quality}%`;
                if (matchNoteEl) matchNoteEl.textContent = `Invite acceptance ratio from ${totalReviewed} reviewed invitations.`;
              } else {
                matchEl.textContent = '--';
                if (matchNoteEl) matchNoteEl.textContent = 'No reviewed invitations yet.';
              }
            }

            if (unmetEl) {
              const now = Date.now();
              const dayMs = 24 * 60 * 60 * 1000;
              const last14Cutoff = now - (14 * dayMs);
              const prev28Cutoff = now - (28 * dayMs);
              const openSurveys = (surveys || []).filter(s => s.is_available);

              const currentOpen = openSurveys.filter(s => new Date(s.created_at).getTime() >= last14Cutoff).length;
              const previousOpen = openSurveys.filter(s => {
                const t = new Date(s.created_at).getTime();
                return t >= prev28Cutoff && t < last14Cutoff;
              }).length;

              if (previousOpen > 0) {
                const delta = Math.round(((previousOpen - currentOpen) / previousOpen) * 100);
                const signed = delta > 0 ? `-${delta}%` : `+${Math.abs(delta)}%`;
                unmetEl.textContent = signed;
                if (unmetNoteEl) {
                  const direction = delta > 0 ? 'reduction' : 'increase';
                  unmetNoteEl.textContent = `${direction} in open needs vs previous 14-day period.`;
                }
              } else {
                unmetEl.textContent = '--';
                if (unmetNoteEl) unmetNoteEl.textContent = 'Not enough historical data for 14-day comparison.';
              }
            }
          } catch (metricError) {
            console.warn('Failed to load prototype metrics:', metricError);
            if (responseEl) responseEl.textContent = '--';
            if (matchEl) matchEl.textContent = '--';
            if (unmetEl) unmetEl.textContent = '--';
            const blocked = /permission|row-level security|rls|not authorized|forbidden/i.test(metricError?.message || '');
            if (responseNoteEl) {
              responseNoteEl.textContent = blocked
                ? 'Metrics blocked by data permissions. Check Supabase RLS read policies.'
                : 'Metrics unavailable right now. Try again shortly.';
            }
            if (matchNoteEl) {
              matchNoteEl.textContent = blocked
                ? 'Metrics blocked by data permissions. Check Supabase RLS read policies.'
                : 'No reviewed invitation data available yet.';
            }
            if (unmetNoteEl) {
              unmetNoteEl.textContent = blocked
                ? 'Metrics blocked by data permissions. Check Supabase RLS read policies.'
                : 'Need trend data is currently unavailable.';
            }
          }
        }

        // ── P2-3: Map Filters ─────────────────────────────────────
        window.setUrgencyFilter = function(level) {
          currentUrgencyFilter = level;
          const styleConfig = {
            'urg-all': { active: 'bg-gray-700 text-white border-gray-500', hover: 'hover:text-white hover:border-gray-500' },
            'urg-high': { active: 'bg-red-900/30 text-red-500 border-red-500/50', hover: 'hover:text-red-400 hover:border-red-500/30' },
            'urg-med': { active: 'bg-yellow-900/30 text-yellow-500 border-yellow-500/50', hover: 'hover:text-yellow-400 hover:border-yellow-500/30' },
            'urg-low': { active: 'bg-green-900/30 text-green-500 border-green-500/50', hover: 'hover:text-green-400 hover:border-green-500/30' }
          };

          const levelToId = {
            '': 'urg-all',
            'High': 'urg-high',
            'Medium': 'urg-med',
            'Low': 'urg-low'
          };
          const activeId = levelToId[level] || 'urg-all';

          Object.keys(styleConfig).forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            
            const isActive = (id === activeId);
            
            btn.className = `px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ${styleConfig[id].hover} ` +
              (isActive ? styleConfig[id].active : 'bg-gray-800 text-gray-500 border-gray-700');
          });
          window.applyFilters();
        };

        window.applyFilters = function() {
          const catSelect = document.getElementById('filter-category');
          const cat = catSelect ? catSelect.value : '';
          let filtered = fullDataset;
          if (cat) filtered = filtered.filter(d => d.category === cat);
          if (currentUrgencyFilter) filtered = filtered.filter(d => d.urgency_level === currentUrgencyFilter);
          renderMarkers(filtered);
        };

        // ── Smart Search Feature ──────────────────────────────────
        const searchInput = document.getElementById('smart-search-input');
        const searchBtn = document.getElementById('smart-search-btn');
        const searchIcon = document.getElementById('search-icon-logo');
        const searchSpinner = document.getElementById('search-spinner');
        const searchStatus = document.getElementById('search-status');

        const SMART_SEARCH_EMBED_LIMIT = 20;
        const SMART_SEARCH_EMBED_WARN_AT = 15;
        const smartSearchUsageKey = 'sa_embedding_calls';
        let hasShownSearchLimitWarning = false;

        function canUseEmbeddingSearch() {
          const used = parseInt(sessionStorage.getItem(smartSearchUsageKey) || '0', 10);
          return used < SMART_SEARCH_EMBED_LIMIT;
        }

        function consumeEmbeddingQuota() {
          const used = parseInt(sessionStorage.getItem(smartSearchUsageKey) || '0', 10) + 1;
          sessionStorage.setItem(smartSearchUsageKey, String(used));
          if (used >= SMART_SEARCH_EMBED_WARN_AT && !hasShownSearchLimitWarning) {
            hasShownSearchLimitWarning = true;
            showToast(`Smart search limit: ${used}/${SMART_SEARCH_EMBED_LIMIT} embedding calls used this session.`);
          }
        }

        async function runTextFallbackSearch(query) {
          const { data: surveys, error } = await supabase
            .from('surveys')
            .select('id, ngo_name, needs, urgency_level')
            .eq('is_available', true)
            .ilike('needs', `%${query}%`)
            .limit(20);
          if (error) throw error;
          if (!surveys || surveys.length === 0) {
            renderMarkers([]);
            return;
          }
          const ngoNames = [...new Set(surveys.map(s => s.ngo_name).filter(Boolean))];
          const { data: ngos, error: ngoError } = await supabase
            .from('ngos')
            .select('*')
            .in('name', ngoNames);
          if (ngoError) throw ngoError;
          const transformed = (ngos || []).map((ngo) => {
            const survey = surveys.find((s) => s.ngo_name === ngo.name);
            return {
              ...ngo,
              survey_id: survey?.id || null,
              needs: survey?.needs || null,
              urgency_level: survey?.urgency_level || 'Low'
            };
          });
          renderMarkers(transformed, true, query);
        }

        if (searchInput && searchBtn) {
          const executeSearch = async () => {
            const query = searchInput.value.trim();
            if (!query) {
              try {
                const { data: ngos } = await supabase.from('ngos').select('*');
                renderMarkers(ngos || []);
              } catch (e) {
                console.error('Error resetting search:', e);
              }
              return;
            }

            // Silent matching

            try {
              // 1. Get embedding for user's skill/tool description
              consumeEmbeddingQuota();
              const embedding = await getEmbedding(query);

              // 2. Call Supabase RPC to match against survey needs
              const rpcParams = {
                match_count: 5,
                match_threshold: 0.7,
                query_embedding: embedding
              };

              // Optional: Add volunteer metadata from current session if available
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    const { data: vol } = await supabase.from('volunteer_details').select('lat, lng, volunteer_reliability').eq('user_id', session.user.id).single();
                    if (vol) {
                      if (vol.lat) rpcParams.v_lat = vol.lat;
                      if (vol.lng) rpcParams.v_lng = vol.lng;
                      if (vol.volunteer_reliability) rpcParams.v_reliability = vol.volunteer_reliability;
                    }
                }
              } catch (e) { console.warn('Match metadata fetch ignored:', e); }

              const { data: matches, error } = await supabase.rpc('match_surveys', rpcParams);
              if (error) throw error;

              renderMarkers(matches || [], true, query);
                
            } catch (err) {
              try {
                await runTextFallbackSearch(query);
                showToast('Semantic search unavailable, showing text matches instead.', true);
              } catch (fallbackErr) {
                showToast(err.message || 'Smart search failed.', true);
                searchStatus.textContent = '';
              }
            } finally {
              // No status updates below bar
            }
          };

          searchBtn.addEventListener('click', executeSearch);
          searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeSearch();
          });

          // FIX 7: "Use my profile" button
          const useProfileBtn = document.getElementById('use-profile-btn');
          if (useProfileBtn) {
            useProfileBtn.addEventListener('click', () => {
              if (window._volunteerSkillsSummary) {
                searchInput.value = window._volunteerSkillsSummary;
                executeSearch();
              }
            });
          }

          // FIX 2 & 10: Exposed auto-match runner
          window._runAutoMatch = async function(skillsSummary) {
            if (!skillsSummary) return;
            searchInput.value = skillsSummary;
            await executeSearch();
          };
        }

        // UPGRADE 3: REAL-TIME UPDATES (Supabase Channel)
        if (supabase) {
          const surveysLiveChannel = supabase.channel('surveys-live')
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'surveys' }, 
                async (payload) => {
                    // Refresh sidebar and priorities for all changes (Assignment, New Posts, Deletion)
                    loadRecentUrgentNeeds();
                    loadGlobalPriorityEngine();
                    loadPrototypeMetrics();
                    
                    if (payload.eventType === 'INSERT') {
                        const newSurvey = payload.new;
                        const { data: ngo } = await supabase.from('ngos').select('*').eq('name', newSurvey.ngo_name).single();
                        if (ngo) {
                            showToast(`🆕 New need posted near ${ngo.region}!`);
                            // Add marker if it doesn't exist
                            if (!window.currentMarkersMap[newSurvey.id]) {
                                const marker = L.marker([ngo.lat, ngo.lng], { 
                                    icon: getMarkerIcon(ngo.category, false, newSurvey.urgency_level === 'High', newSurvey.urgency_level) 
                                }).addTo(markerGroup);
                                window.currentMarkersMap[newSurvey.id] = marker;
                            }
                        }
                    } else if (payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
                        // Remove marker if it's no longer available
                        const id = payload.old?.id || payload.new?.id;
                        if (id && window.currentMarkersMap[id] && (payload.new?.is_available === false || payload.eventType === 'DELETE')) {
                            markerGroup.removeLayer(window.currentMarkersMap[id]);
                            delete window.currentMarkersMap[id];
                        }
                    }
                })
            .subscribe();

          // UPGRADE 4: REAL-TIME VOLUNTEER STATS
          const statsLiveChannel = supabase.channel('stats-live')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'volunteer_details' },
                async (payload) => {
                    const { data } = await supabase.auth.getSession();
                    const session = data?.session;
                    if (session && (payload.new?.user_id === session.user.id || payload.old?.user_id === session.user.id)) {
                        window.refreshVolunteerStats(session.user.id);
                        loadPrototypeMetrics();
                    }
                })
            .subscribe();

          const invitesLiveChannel = supabase.channel('invites-metrics-live')
            .on('postgres_changes',
              { event: '*', schema: 'public', table: 'invitations' },
              () => { loadPrototypeMetrics(); })
            .subscribe();

          window.addEventListener('beforeunload', () => {
            surveysLiveChannel?.unsubscribe();
            statsLiveChannel?.unsubscribe();
            invitesLiveChannel?.unsubscribe();
            pushChannel?.unsubscribe();
          });
        }

        // ── Recent Urgent Needs Sidebar (ENRICHED) ────────────────
          window.loadRecentUrgentNeeds = async function() {
            const sidebar = document.getElementById('urgent-needs-sidebar');
          if (!sidebar) return;

          try {
            const { data: surveys, error } = await supabase
              .from('surveys')
              .select('id, ngo_name, needs, created_at, urgency_level, priority_score, region')
              .eq('is_available', true)
              .order('created_at', { ascending: false })
              .limit(4);

            if (error) throw error;

            if (!surveys || surveys.length === 0) {
              sidebar.innerHTML = '<div class="text-gray-500 text-xs italic py-6 text-center bg-gray-900/40 rounded-xl border border-dashed border-gray-800">No active needs at the moment.</div>';
              return;
            }

            sidebar.innerHTML = surveys.map(s => {
              const date = new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              const isOwner = window.userOrgName && s.ngo_name === window.userOrgName;
              const scorePercent = Math.min(Math.round((s.priority_score || 0.5) * 100), 100);
              const urgencyColor = s.urgency_level === 'High' ? 'red' : s.urgency_level === 'Medium' ? 'yellow' : 'emerald';

              return `
                <div class="bg-gray-800/20 border ${isOwner ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-gray-800'} rounded-xl p-3 transition-all hover:bg-gray-800/40 group relative mb-2">
                  <div class="flex justify-between items-start mb-2">
                    <div class="flex flex-col">
                        <span class="text-[9px] font-black ${isOwner ? 'text-emerald-400' : 'text-gray-500'} uppercase tracking-widest leading-none">${escapeHtml(s.ngo_name)} ${isOwner ? '(You)' : ''}</span>
                        <span class="text-[8px] text-gray-600 mt-1">${date}</span>
                    </div>
                    <span class="px-1.5 py-0.5 rounded text-[7px] font-black uppercase bg-${urgencyColor}-500/10 text-${urgencyColor}-400 border border-${urgencyColor}-500/20">${s.urgency_level}</span>
                  </div>
                  
                  <p class="text-[10px] text-gray-300 line-clamp-2 italic leading-relaxed group-hover:text-gray-100 transition-colors mb-2">"${escapeHtml(s.needs)}"</p>
                  
                  <div class="flex items-center justify-between gap-2 border-t border-gray-800/50 pt-2">
                    <div class="flex flex-col">
                        <span class="text-[7px] text-gray-600 uppercase font-black">Urgency</span>
                        <span class="text-[9px] font-bold text-gray-400">${scorePercent}%</span>
                    </div>
                    <div class="text-right">
                        <span class="text-[7px] text-gray-600 uppercase font-black">Region</span>
                        <span class="text-[9px] font-bold text-gray-400">${escapeHtml(s.region || 'Unknown')}</span>
                    </div>
                    <div class="flex gap-1 ml-auto">
                        <button onclick="window.focusOnSurvey('${s.id}')" class="w-6 h-6 flex items-center justify-center bg-gray-900 border border-gray-700 hover:border-blue-500 text-gray-500 hover:text-white rounded-md transition-all">
                             <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        </button>
                        ${isOwner ? `
                           <a href="ngo-dashboard.html" class="px-2 h-6 flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white text-[8px] font-black uppercase tracking-tighter rounded-md transition-all">Manage</a>
                        ` : ''}
                    </div>
                  </div>
                </div>
              `;
            }).join('');

          } catch (err) {
            console.error('Failed to load recent needs:', err);
            sidebar.innerHTML = '<div class="text-red-400 text-xs py-2">Failed to load recent needs.</div>';
          }
        }

        // 🔥 NEW: Global Priority Engine
        window.loadGlobalPriorityEngine = async function() {         
           const container = document.getElementById('global-priority-engine');
          if (!container) return;

          try {
            // Fetch top 5 available needs ranked by priority_score
            // Using a join to get lat/lng for the focus feature
            const { data: needs, error } = await supabase
              .from('surveys')
              .select('*, ngos(lat, lng)')
              .eq('is_available', true)
              .order('priority_score', { ascending: false })
              .limit(5);

            if (error) throw error;
            if (!needs || needs.length === 0) {
              container.innerHTML = '<div class="text-gray-500 text-xs py-4 text-center">All critical needs met! 🎉</div>';
              return;
            }

            container.innerHTML = needs.map((s, index) => {
              const isFirst = index === 0;
              const scorePercent = Math.min(Math.round(s.priority_score * 100), 100);
              const urgencyColor = s.urgency_level === 'High' ? 'red' : s.urgency_level === 'Medium' ? 'yellow' : 'emerald';
              
              return `
                <div class="bg-gray-800/40 border ${isFirst ? 'border-red-500/40 shadow-lg shadow-red-500/5' : 'border-gray-700/50'} rounded-xl p-3.5 transition-all hover:border-emerald-500/30 group relative mb-3">
                  ${isFirst ? '<div class="absolute -top-2 -right-1 bg-gradient-to-r from-red-600 to-orange-600 text-white text-[7px] font-black px-2 py-0.5 rounded-full animate-bounce shadow-xl uppercase tracking-tighter">Priority #1</div>' : ''}
                  
                  <div class="flex justify-between items-center mb-2">
                    <span class="text-[9px] font-black text-blue-400 uppercase tracking-widest truncate max-w-[120px]">${escapeHtml(s.ngo_name)}</span>
                    <span class="px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase bg-${urgencyColor}-500/10 text-${urgencyColor}-400 border border-${urgencyColor}-500/20">${s.urgency_level}</span>
                  </div>
                  
                  <p class="text-[11px] text-gray-200 font-medium line-clamp-2 mb-3 leading-snug">"${escapeHtml(s.needs)}"</p>
                  
                  <div class="flex items-center justify-between mb-3 border-t border-gray-700/30 pt-2">
                    <div class="flex flex-col">
                      <span class="text-[8px] text-gray-500 uppercase font-black tracking-tighter">Need Score</span>
                      <span class="text-xs font-black ${isFirst ? 'text-red-400' : 'text-emerald-400'}">${scorePercent}%</span>
                    </div>
                    <div class="text-right">
                      <span class="text-[8px] text-gray-500 uppercase font-black tracking-tighter block">Area</span>
                      <span class="text-[9px] text-gray-400 font-bold truncate max-w-[80px] block">${escapeHtml(s.region || 'Unknown')}</span>
                    </div>
                  </div>

                  <div class="flex gap-1.5">
                    <button onclick="window.focusOnSurvey('${s.id}')" class="w-8 h-8 flex items-center justify-center bg-gray-900 border border-gray-700 hover:border-blue-500 text-gray-500 hover:text-white rounded-lg transition-all" title="View on map">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    </button>
                    <button onclick="window.commitToTask('${s.id}', '${s.ngo_name.replace(/'/g, "\\'")}')" 
                      class="flex-1 py-2 ${isFirst ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'} text-white text-[8px] font-black uppercase tracking-[1px] rounded-lg transition-all transform active:scale-95">
                      Assign Volunteer
                    </button>
                  </div>
                </div>
              `;
            }).join('');

          } catch (err) {
            console.error('Priority Engine Error:', err);
            container.innerHTML = '<div class="text-red-400 text-[10px] py-4">Error synchronizing global rankings.</div>';
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

      // ── Global Commit to Need Flow ─────────────────────────────
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
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Auth required");
          const profile = await getUserProfile(user.id);
          if (!profile || profile.role !== 'Volunteer') {
            throw new Error('Only volunteers can commit to needs.');
          }

          // Update database
          const { error } = await supabase.from('surveys')
            .update({ is_available: false, committed_by: user.id, status: 'in_progress', assigned_at: new Date().toISOString() })
            .eq('id', surveyId);
          
          if (error) throw error;
          
          // Instantly remove marker from map without refetching
          if (window.currentMarkersMap[surveyId]) {
            markerGroup.removeLayer(window.currentMarkersMap[surveyId]);
            delete window.currentMarkersMap[surveyId];
          }

          // Refresh sidebars locally
          loadRecentUrgentNeeds();
          loadGlobalPriorityEngine();
          
          // Show Success Modal
          const modal = document.getElementById('success-modal');
          const closeBtn = document.getElementById('close-modal-btn');
          const nameSpan = document.getElementById('modal-ngo-name');
          
          if (modal) {
            if (nameSpan) nameSpan.textContent = ngoName || 'this need';
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
          console.error('Commit-to-Need Error:', err);
          showToast('Could not commit to need. Please try again later.', true);
          if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.textContent = 'Commit to Need';
          }
        }
      };

    }
  }

  // ── 3. Page-Specific Initializers ─────────────────────────────
  
  // A: NGO Survey Page (ngo.html)
  const ngoSelector = document.getElementById('ngo-name-select');
  const ingestNgoSelector = document.getElementById('ingest-ngo-select');
  const regionInput = document.getElementById('ngo-region');
  const surveyBtn   = document.getElementById('submit-survey');
  let ngoCache = [];

  if (ngoSelector && surveyBtn) {
    // Auth State Observer
    let _authReady = false;
    (async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { window.location.href = 'login.html'; return; }
            const { data: prof, error: profErr } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
            if (profErr) throw profErr;
            if (prof?.role !== 'NGO') { 
                showToast('Access restricted to NGO accounts.', true);
                setTimeout(() => window.location.href = 'index.html', 2000); 
                return;
            }
            _authReady = true;
            refreshNgoList(); // Trigger refresh after auth is verified
        } catch (err) {
            console.error('Auth Guard Error:', err);
            const errMsg = '<option value="" disabled selected>Auth error. Try refreshing.</option>';
            ngoSelector.innerHTML = errMsg;
            if (ingestNgoSelector) ingestNgoSelector.innerHTML = errMsg;
        }
    })();

    async function refreshNgoList() {
      if (!_authReady) return;

      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user) {
          console.error('User fetch failed:', userError);
          throw new Error("Auth session lost. Please re-login.");
        }
        const user = userData.user;

        // Fetch NGO map records
        const { data: ngoData, error: ngoErr } = await supabase
          .from('ngos')
          .select('*')
          .eq('user_id', user.id);
          
        if (ngoErr) console.warn('ngos table fetch error:', ngoErr);

        // Fetch NGO profile records
        const { data: detailData, error: detailErr } = await supabase
          .from('ngo_details')
          .select('org_name as name, org_type as category, location_name as region')
          .eq('user_id', user.id);

        if (detailErr) console.warn('ngo_details table fetch error:', detailErr);
        
        // Merge datasets (even if one query failed)
        const merged = [...(ngoData || []), ...(detailData || [])];
        if (merged.length === 0 && (ngoErr || detailErr)) {
          throw new Error("Database sync error. Ensure your NGO registration is complete.");
        }

        const uniqueNames = new Set();
        const data = merged.filter(item => {
          const name = (item.name || '').trim();
          if (name && !uniqueNames.has(name.toLowerCase())) {
            uniqueNames.add(name.toLowerCase());
            return true;
          }
          return false;
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        ngoCache = data;
        
        if (data.length === 0) {
          const noNgoHtml = '<option value="" disabled selected>No organizations found</option>';
          ngoSelector.innerHTML = noNgoHtml;
          if (ingestNgoSelector) ingestNgoSelector.innerHTML = noNgoHtml;
          showToast('No registered NGO found. Please use the Register page.');
          return;
        }

        let html = '<option value="" disabled selected>Select an Organization</option>';
        data.forEach(ngo => {
          html += `<option value="${ngo.name}">${ngo.name}</option>`;
        });

        ngoSelector.innerHTML = html;
        if (ingestNgoSelector) ingestNgoSelector.innerHTML = html;

        if (data.length >= 1) {
          ngoSelector.value = data[0].name;
          if (ingestNgoSelector) ingestNgoSelector.value = data[0].name;
          if (regionInput) regionInput.value = data[0].region || '';
        }
      } catch (e) {
        console.error('RefreshNgoList Critical:', e);
        const errorHtml = `<option value="" disabled selected>Error: ${e.message || 'Loading failed'}</option>`;
        ngoSelector.innerHTML = errorHtml;
        if (ingestNgoSelector) ingestNgoSelector.innerHTML = errorHtml;
        showToast('NGO Load Error: ' + e.message, true);
      }
    }

    // refreshNgoList is now called inside the Auth State Observer

    ngoSelector.onchange = () => {
      const chosen = ngoCache.find(n => n.name === ngoSelector.value);
      if (chosen && regionInput) regionInput.value = chosen.region || '';
    };

    surveyBtn.onclick = async () => {
      const needs = document.getElementById('ngo-needs').value.trim();
      const people = parseInt(document.getElementById('ngo-people').value) || 1;
      const category = document.getElementById('ngo-category').value;
      const status = document.getElementById('survey-status');

      if (!ngoSelector.value || !needs) {
        showToast('Please select an organization and describe needs.', true);
        return;
      }
      
      setLoadingState(surveyBtn, true, 'Submit Survey');

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Authentication required.");

        const embedding = await getEmbedding(needs);

        const { error } = await supabase.from('surveys').insert([{ 
          user_id: user.id,
          ngo_name: ngoSelector.value, 
          region: regionInput ? regionInput.value : '', 
          needs, 
          embedding,
          people_affected: people,
          category,
          source: 'manual'
        }]);
        if (error) throw error;
        showToast('Survey submitted successfully!');
        document.getElementById('ngo-needs').value = '';
      } catch (e) {
        showToast(e.message, true);
      } finally {
        setLoadingState(surveyBtn, false, 'Submit Survey');
      }
    };
  }

  // ── Tab Switching for NGO Survey Page ─────────────────────────
  window.switchSurveyTab = function(tab) {
    const manual = document.getElementById('content-survey');
    const ingestion = document.getElementById('content-ingestion');
    const tabManual = document.getElementById('tab-manual');
    const tabIngest = document.getElementById('tab-ingestion');
    if (!manual || !ingestion) return;

    if (tab === 'ingestion') {
      manual.classList.add('hidden');
      ingestion.classList.remove('hidden');
      tabManual.className = 'flex-1 py-2.5 rounded-t-xl text-xs font-bold uppercase tracking-widest transition-all bg-gray-900 border border-gray-800 border-b-0 text-gray-500 hover:text-white';
      tabIngest.className = 'flex-1 py-2.5 rounded-t-xl text-xs font-bold uppercase tracking-widest transition-all bg-gray-800 border border-gray-700 border-b-0 text-blue-400';
    } else {
      ingestion.classList.add('hidden');
      manual.classList.remove('hidden');
      tabManual.className = 'flex-1 py-2.5 rounded-t-xl text-xs font-bold uppercase tracking-widest transition-all bg-gray-800 border border-gray-700 border-b-0 text-blue-400';
      tabIngest.className = 'flex-1 py-2.5 rounded-t-xl text-xs font-bold uppercase tracking-widest transition-all bg-gray-900 border border-gray-800 border-b-0 text-gray-500 hover:text-white';
    }
  };

  // ── Phase 2: High-Volume Data Ingestion ────────────────────────
  const fileInput = document.getElementById('file-input');
  const ingestStatus = document.getElementById('ingest-status-container');
  const ingestStatusText = document.getElementById('ingest-status-text');

  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      const selectedNgo = document.getElementById('ingest-ngo-select').value;
      
      if (!file) return;
      
      ingestStatus.classList.remove('hidden');
      ingestStatusText.textContent = 'Reading Document...';

      try {
        let text = '';
        if (file.type === 'application/pdf') {
          text = await extractPdfText(file);
        } else {
          text = await file.text();
        }

        if (!text || text.trim().length === 0) throw new Error('Document is empty.');

        ingestStatusText.textContent = 'AI Extracting Intelligence...';
        const aiData = await performAiExtraction(text);
        
        showReviewModal(aiData, selectedNgo);
      } catch (err) {
        let msg = err.message;
        if (msg.includes('pdfjsLib')) msg = 'Corrupt or unsupported PDF file.';
        
        showToast('Ingestion Error: ' + msg, true);
        console.error('Ingestion Pipeline Error:', err);
        
        // Only fallback to manual if it's a critical AI or Read error
        if (msg.includes('AI') || msg.includes('empty')) {
            showToast('Switching to Manual Entry mode...', false);
            setTimeout(() => {
                if (typeof window.switchSurveyTab === 'function') window.switchSurveyTab('manual');
            }, 2500);
        }
      } finally {
        ingestStatus.classList.add('hidden');
        fileInput.value = '';
      }
    };
  }

  async function extractPdfText(file) {
    const MAX_PDF_PAGES = 20;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const pageLimit = Math.min(pdf.numPages, MAX_PDF_PAGES);
    if (pdf.numPages > MAX_PDF_PAGES) {
      showToast(`PDF is ${pdf.numPages} pages. Processing first ${MAX_PDF_PAGES} pages only.`, true);
    }
    for (let i = 1; i <= pageLimit; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }
    return fullText;
  }

  async function performAiExtraction(rawText) {
    try {
      if (typeof window.callGeminiGenerate !== 'function') {
        throw new Error('AI helper is not available on this page.');
      }
      let content = await window.callGeminiGenerate(
        [
          'Extract structured disaster-need information from the user text.',
          'Return JSON only, no markdown, no commentary.',
          'Required JSON keys: ngo_name, needs, urgency_level, category, people_affected, location_name.',
          'Allowed urgency_level values: High, Medium, Low.',
          'If uncertain, use safe defaults: urgency_level=Medium, category=General, people_affected=1.'
        ].join(' '),
        rawText.substring(0, 10000),
        { extraction: true }
      );
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('AI returned an empty extraction response.');
      }
      
      // JSON Cleaning: Remove markdown code blocks if present
      if (content.includes('```')) {
        content = content.replace(/```json|```/g, '').trim();
      }
      
      try {
        const extracted = JSON.parse(content);
        
        // Category Sanitization (Case-Insensitive Mapping)
        const validCategories = ['Healthcare', 'Environment', 'Education', 'Child Welfare', 'Women Rights', 'Food Security', 'Sanitation', 'General'];
        if (extracted.category) {
          const matched = validCategories.find(c => c.toLowerCase() === extracted.category.toLowerCase());
          extracted.category = matched || 'General';
        } else {
          extracted.category = 'General';
        }
        
        return extracted;
      } catch (parseErr) {
        console.error('AI Data Parse Error:', content);
        throw new Error('AI returned an invalid data format. Please try manual entry.');
      }
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('AI extraction timed out.');
      throw err;
    }
  }

  let pendingAiData = null;

  function showReviewModal(data, selectedNgo) {
    pendingAiData = data;
    
    // Preference: 1. AI Extracted Name, 2. User Selected NGO
    document.getElementById('review-ngo-name').value = data.ngo_name || selectedNgo;
    document.getElementById('review-needs').value = data.needs || '';
    document.getElementById('review-urgency').value = data.urgency_level || 'Medium';
    document.getElementById('review-category').value = data.category || 'General';
    document.getElementById('review-people').value = data.people_affected || 1;
    document.getElementById('review-location').value = data.location_name || '';
    
    document.getElementById('review-modal').classList.remove('hidden');
  }

  document.getElementById('confirm-save-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('confirm-save-btn');
    const ngoName = document.getElementById('review-ngo-name').value;
    const needs = document.getElementById('review-needs').value;
    const urgency = document.getElementById('review-urgency').value;
    const category = document.getElementById('review-category').value;
    const people = parseInt(document.getElementById('review-people').value) || 1;
    const location = document.getElementById('review-location').value;

    if (!ngoName || !needs) {
      showToast('Organization and Needs are required.', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Session expired. Please sign in again.");

      // Find organization details for region sync (Case-Insensitive)
      const { data: ngoInfo } = await supabase.from('ngos').select('region').ilike('name', ngoName).maybeSingle();
      const region = ngoInfo ? ngoInfo.region : (location || 'Unknown');

      showToast('Generating AI Match Vector...', false);
      const embedding = await getEmbedding(needs);

      const { error } = await supabase.from('surveys').insert([{
        user_id: user.id,
        ngo_name: ngoName,
        needs: needs,
        urgency_level: urgency,
        category: category,
        people_affected: people,
        location_name: location,
        region: region, 
        embedding: embedding,
        source: 'ai_extracted'
      }]);

      if (error) {
        if (error.code === '23503') throw new Error(`Organization "${ngoName}" not found in database.`);
        throw error;
      }

      showToast('Impact data verified and live! 🚀');
      document.getElementById('review-modal').classList.add('hidden');
      
      // Reset logic
      if (typeof window.loadRecentUrgentNeeds === 'function') window.loadRecentUrgentNeeds();
    } catch (err) {
      showToast('Save failed: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Finalize & Post';
    }
  });


  // B: NGO Registration Page (register.html)
  const regMapEl = document.getElementById('registration-map');
  const regBtn   = document.getElementById('submit-registration');

  if (regMapEl && regBtn) {
    // LOCK REGISTRATION FEATURE: Check if user already has an NGO
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: existing } = await supabase.from('ngos').select('id').eq('user_id', user.id).maybeSingle();
        if (existing) {
          // Block the form instead of redirecting
          const inputs = ['reg-name', 'reg-category', 'reg-region', 'submit-registration'];
          inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
              el.disabled = true;
              el.style.opacity = '0.5';
              el.style.cursor = 'not-allowed';
            }
          });
          const status = document.getElementById('reg-status');
          if (status) {
            status.textContent = 'Organization already registered. Manage it in the dashboard.';
            status.classList.remove('hidden');
            status.classList.replace('text-gray-500', 'text-yellow-400');
          }
          showToast('Organization already registered.', true);
        }
      }
    })();

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

      if (!name || !cat || !reg || isNaN(lat)) {
        showToast('Please provide a name, category, region, and click on the map.', true);
        return;
      }
      
      setLoadingState(regBtn, true, 'Complete Registration');

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Authentication required to register NGO.");

        const { error } = await supabase.from('ngos').insert([{ 
          user_id: user.id,
          name, region: reg, category: cat, lat, lng 
        }]);
        if (error) throw error;

        // Sync with ngo_details immediately to prevent modal nagging
        const { data: existingNgoDetails } = await supabase
          .from('ngo_details')
          .select('contact_name, phone')
          .eq('user_id', user.id)
          .maybeSingle();
        await supabase.from('ngo_details').upsert([{
          user_id: user.id,
          org_name: name,
          org_type: cat,
          contact_name: existingNgoDetails?.contact_name || 'Administrator',
          phone: existingNgoDetails?.phone || null
        }], { onConflict: 'user_id' });

        showToast(`Successfully registered ${name}!`);
        setTimeout(() => window.location.href = 'ngo.html', 1500);
      } catch (e) {
        showToast(e.message, true);
      } finally {
        setLoadingState(regBtn, false, 'Complete Registration');
      }
    };
  }

  // C: Volunteer Dashboard Logic
  window.switchContributionTab = function(tab) {
    const activeList = document.getElementById('active-list');
    const historyList = document.getElementById('history-list');
    const activeBtn = document.getElementById('tab-btn-active');
    const historyBtn = document.getElementById('tab-btn-history');
    if (!activeList || !historyList) return;

    if (tab === 'history') {
      activeList.classList.add('hidden');
      historyList.classList.remove('hidden');
      activeBtn.className = 'pb-2 text-[10px] font-black uppercase tracking-widest border-gray-600 text-gray-500 hover:text-white transition-all';
      historyBtn.className = 'pb-2 text-[10px] font-black uppercase tracking-widest border-b-2 border-blue-500 text-blue-400 transition-all';
    } else {
      historyList.classList.add('hidden');
      activeList.classList.remove('hidden');
      activeBtn.className = 'pb-2 text-[10px] font-black uppercase tracking-widest border-b-2 border-blue-500 text-blue-400 transition-all';
      historyBtn.className = 'pb-2 text-[10px] font-black uppercase tracking-widest border-gray-600 text-gray-500 hover:text-white transition-all';
    }
  };

  window.withdrawFromTask = async function(surveyId) {
    if (!confirm('Are you sure you want to withdraw from this task? This will reopen it for other volunteers.')) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Auth required");

      const { error } = await supabase.from('surveys')
        .update({ 
          committed_by: null, 
          is_available: true, 
          status: 'open',
          assigned_at: null 
        })
        .eq('id', surveyId)
        .eq('committed_by', user.id);

      if (error) throw error;
      showToast('Successfully withdrawn from task.');
      window.loadMyCommitments(user.id);
    } catch (err) {
      showToast('Failed to withdraw: ' + err.message, true);
    }
  };

  window.loadMyCommitments = async function(volunteerId) {
    const activeListEl = document.getElementById('my-commitments-list');
    const historyListEl = document.getElementById('my-history-list');
    if (!activeListEl || !historyListEl) return;

    try {
      const { data: surveys, error } = await supabase
        .from('surveys')
        .select(`
          id, needs, ngo_name, created_at, status, completed_at,
          ngos ( lat, lng )
        `)
        .eq('committed_by', volunteerId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const active = surveys.filter(s => s.status !== 'resolved');
      const history = surveys.filter(s => s.status === 'resolved');

      function renderList(list, targetEl, emptyMsg) {
        if (!list || list.length === 0) {
          targetEl.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 bg-gray-900/40 border border-gray-800 rounded-2xl text-center">
              <p class="text-[10px] text-gray-600 font-bold uppercase tracking-widest">${emptyMsg}</p>
            </div>
          `;
          return;
        }

        targetEl.innerHTML = list.map(s => {
          const isResolved = s.status === 'resolved';
          const statusColor = isResolved ? 'emerald' : 'blue';
          const statusText = isResolved ? 'RESOLVED' : 'IN PROGRESS';
          const progressWidth = isResolved ? 'w-full' : 'w-1/3';
          
          return `
            <div class="bg-gray-900/80 border border-gray-800 p-4 rounded-xl hover:border-${statusColor}-500/30 transition-all group relative">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex flex-col">
                      <span class="text-[9px] font-black text-blue-400 uppercase tracking-widest">${s.ngo_name}</span>
                      <span class="text-[8px] text-gray-600 mt-1 uppercase font-bold">${new Date(s.created_at).toLocaleDateString()}</span>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${isResolved ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}">${statusText}</span>
                </div>
                <p class="text-xs text-gray-400 line-clamp-2 italic leading-relaxed group-hover:text-gray-200 transition-colors mb-3">"${escapeHtml(s.needs)}"</p>
                
                <div class="flex items-center gap-2 mb-3">
                    <div class="h-1 flex-1 bg-gray-800 rounded-full overflow-hidden">
                        <div class="h-full bg-${statusColor}-600 ${progressWidth} transition-all"></div>
                    </div>
                </div>

                <div class="flex gap-2">
                  ${!isResolved ? `
                    <button onclick="window.resolveTask('${s.id}')" class="flex-1 py-2 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 hover:border-emerald-500 text-emerald-400 hover:text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all">✓ Complete</button>
                    <button onclick="openChat('${s.id}')" data-chat-survey="${s.id}" class="w-10 h-10 flex items-center justify-center bg-blue-600/10 hover:bg-blue-600 border border-blue-500/20 text-blue-400 hover:text-white rounded-lg transition-all" title="Open chat">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z"/></svg>
                    </button>
                    <button onclick="window.withdrawFromTask('${s.id}')" class="w-10 h-10 flex items-center justify-center bg-gray-800 border border-gray-700 hover:border-red-500 text-gray-500 hover:text-red-400 rounded-lg transition-all" title="Withdraw from task">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  ` : `
                    <div class="flex-1 text-[9px] text-gray-600 font-bold uppercase tracking-tighter">Completed ${s.completed_at ? new Date(s.completed_at).toLocaleDateString() : ''}</div>
                  `}
                </div>
            </div>
          `;
        }).join('');
      }

      renderList(active, activeListEl, 'No active tasks.');
      renderList(history, historyListEl, 'No history found.');
      setTimeout(() => window.loadUnreadBadges && window.loadUnreadBadges(), 300);

    } catch (err) {
      console.error('Failed to load commitments:', err);
    }
  };

  // ── Resolve Task Flow ──────────────────────────────────────────
  window.resolveTask = async function(surveyId) {
    if (!surveyId || !supabase) return;
    if (!confirm('Mark this task as resolved? This action is final.')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Auth required");

      const completedAt = new Date().toISOString();
      const { data: surveyRow } = await supabase
        .from('surveys')
        .select('assigned_at')
        .eq('id', surveyId)
        .single();
      const { error } = await supabase.from('surveys')
        .update({ status: 'resolved', completed_at: completedAt })
        .eq('id', surveyId)
        .eq('committed_by', user.id);

      if (error) throw error;

      const { data: vol } = await supabase.from('volunteer_details')
        .select('tasks_completed, total_hours, impact_score')
        .eq('user_id', user.id).single();

      if (vol) {
        let computedHours = DEFAULT_TASK_HOURS;
        if (surveyRow?.assigned_at) {
          const started = new Date(surveyRow.assigned_at).getTime();
          const ended = new Date(completedAt).getTime();
          if (!Number.isNaN(started) && !Number.isNaN(ended) && ended > started) {
            computedHours = Math.max(1, Math.round((ended - started) / (1000 * 60 * 60)));
          }
        }
        await supabase.from('volunteer_details').update({
          tasks_completed: (vol.tasks_completed || 0) + 1,
          total_hours: (vol.total_hours || 0) + computedHours,
          impact_score: (vol.impact_score || 0) + 15
        }).eq('user_id', user.id);
      }

      showToast('Task marked as resolved! Great work! 🎉');
      window.loadMyCommitments(user.id);
      if (typeof window.refreshVolunteerStats === 'function') {
        window.refreshVolunteerStats(user.id);
      }
    } catch (err) {
      console.error('Resolve task error:', err);
      showToast('Failed to resolve task. ' + err.message, true);
    }
  };

  window.refreshVolunteerStats = async function(userId) {
    if (!supabase || !userId) return;
    try {
        const { data: vol, error } = await supabase.from('volunteer_details').select('tasks_completed, total_hours, impact_score').eq('user_id', userId).single();
        if (error || !vol) return;
        const dashTasks = document.getElementById('vol-stat-tasks');
        const dashHours = document.getElementById('vol-stat-hours');
        const dashScore = document.getElementById('vol-stat-score');
        if (dashTasks) dashTasks.textContent = vol.tasks_completed || 0;
        if (dashHours) dashHours.textContent = vol.total_hours || 0;
        if (dashScore) dashScore.textContent = vol.impact_score || 0;
        const profTasks = document.getElementById('stat-1-val');
        const profHours = document.getElementById('stat-2-val');
        const profScore = document.getElementById('stat-3-val');
        if (profTasks) profTasks.textContent = vol.tasks_completed || 0;
        if (profHours) profHours.textContent = vol.total_hours || 0;
        if (profScore) profScore.textContent = vol.impact_score || 0;
    } catch (e) { console.warn('Silent stats refresh failed:', e); }
  };

  let pushChannel = null;
  let inboxChannel = null;
  window.setupPushNotifications = async function(requestIfDenied = false) {
    if (!('Notification' in window)) return false;
    let perm = Notification.permission;
    if (perm === 'default' || (perm === 'denied' && requestIfDenied)) {
      perm = await Notification.requestPermission();
    }
    if (perm === 'denied' || perm !== 'granted') return false;
    if (pushChannel) return true;
    pushChannel = supabase.channel('public:push_notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'surveys' }, (payload) => {
        const row = payload.new;
        if (row && row.urgency_level === 'High') {
          if (window.playSuccessSound) window.playSuccessSound();
          const notif = new Notification('🚨 URGENT: New Relief Need', {
            body: row.ngo_name + ' needs ' + row.needs.substring(0, 50) + '...',
            icon: 'logo.png',
            requireInteraction: true
          });
          notif.onclick = function() {
            window.focus();
            window.setUrgencyFilter && window.setUrgencyFilter('High');
            notif.close();
          };
        }
      })
      .subscribe();
    return true;
  };

  // --- INBOX NOTIFICATIONS SYSTEM ---
  window.syncInboxBadge = async function(userId) {
    if (!supabase || !userId) return;
    try {
      const { count, error } = await supabase
        .from('invitations')
        .select('*', { count: 'exact', head: true })
        .eq('volunteer_user_id', userId)
        .eq('status', 'pending');
      
      if (error) throw error;
      const badge = document.getElementById('nav-inbox-badge');
      if (badge) {
        badge.textContent = count || 0;
        if (count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
      }
    } catch (e) { console.warn('Inbox sync failed:', e); }
  };

  window.setupInboxRealtime = function(userId) {
    if (!supabase || !userId) return;
    if (inboxChannel) inboxChannel.unsubscribe();
    inboxChannel = supabase.channel('inbox-updates')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'invitations',
        filter: `volunteer_user_id=eq.${userId}` 
      }, () => {
        window.syncInboxBadge(userId);
      })
      .subscribe();
  };

  window.addEventListener('beforeunload', () => {
    inboxChannel?.unsubscribe();
  });

  function showMapEmptyState(show) {
    let overlay = document.getElementById('map-empty-overlay');
    if (show) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'map-empty-overlay';
        overlay.className = 'absolute inset-0 z-[1000] flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px] pointer-events-none';
        overlay.innerHTML = `
          <div class="bg-gray-900/90 border border-emerald-500/30 p-8 rounded-3xl text-center shadow-2xl max-w-xs transform translate-y-12">
            <div class="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
              <svg class="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </div>
            <h3 class="text-lg font-bold text-white mb-2">The Map is Waiting</h3>
            <p class="text-xs text-gray-500 leading-relaxed mb-6">No needs have been pinned in this area yet. NGOs haven't reported any missions lately.</p>
            <div class="text-[10px] text-emerald-400 font-bold uppercase tracking-widest animate-pulse">Be the first to create change</div>
          </div>
        `;
        document.getElementById('map')?.appendChild(overlay);
      }
    } else if (overlay) {
      overlay.remove();
    }
  }
});
