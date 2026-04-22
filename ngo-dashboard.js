/* ============================================================
   SmartAllocation — NGO Dashboard Logic (ngo-dashboard.js)
   FIX 3: Find Volunteers tab + Invite modal
   FIX 6: Kanban board with drag-and-drop
   FIX 8: Unread message badges on chat buttons
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof CONFIG === 'undefined') return;

  const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const DEFAULT_TASK_HOURS = 2;
  const VOLUNTEER_PAGE_SIZE = 20;

  // ── Auth Check ──────────────────────────────────────────────
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const userId = session.user.id;

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (!profile || profile.role !== 'NGO') {
    window.location.href = 'index.html';
    return;
  }

  const authNav = document.getElementById('auth-nav');
  if (authNav) {
    let displayName = session.user.email;
    const { data: ngoInfo } = await supabase.from('ngo_details').select('org_name').eq('user_id', userId).maybeSingle();
    if (ngoInfo && ngoInfo.org_name) displayName = ngoInfo.org_name;
    else {
      const { data: ngoMap } = await supabase.from('ngos').select('name').eq('user_id', userId).maybeSingle();
      if (ngoMap && ngoMap.name) displayName = ngoMap.name;
    }

    authNav.innerHTML = `
      <span class="text-xs text-gray-400 font-bold uppercase tracking-wider mr-2">${escapeHtml(displayName)}</span>
      <button onclick="signOut()" class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 font-bold" style="min-height:44px">Sign Out</button>
    `;
  }
  window.signOut = async () => { await supabase.auth.signOut(); window.location.href = 'login.html'; };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    ['rating-modal', 'edit-survey-modal', 'invite-modal', 'assign-volunteer-modal'].forEach((id) => {
      const modal = document.getElementById(id);
      if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    });
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel && !chatPanel.classList.contains('translate-x-full') && typeof window.closeChatPanel === 'function') {
      window.closeChatPanel();
    }
  });


  // ── Tab Switching ────────────────────────────────────────────
  window.switchTab = function(tab) {
    document.querySelectorAll('.dash-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.dash-tab-btn').forEach(el => {
      el.classList.remove('border-emerald-400', 'text-emerald-400');
      el.classList.add('text-gray-500', 'border-transparent');
    });
    const tabContent = document.getElementById(`tab-content-${tab}`);
    if (tabContent) {
      tabContent.classList.remove('hidden');
      tabContent.classList.remove('tab-enter');
      requestAnimationFrame(() => tabContent.classList.add('tab-enter'));
      setTimeout(() => tabContent.classList.remove('tab-enter'), 380);
    }
    const activeBtn = document.getElementById(`tab-btn-${tab}`);
    if (activeBtn) {
      activeBtn.classList.add('border-emerald-400', 'text-emerald-400');
      activeBtn.classList.remove('text-gray-500', 'border-transparent');
    }
    if (tab === 'volunteers') loadVolunteers();
    if (tab === 'needs') loadDashboard();
    if (tab === 'analytics') loadAnalytics();
  };

  // 🔥 NEW: Global Priority Ticker Logic (Align according to page)
  async function loadGlobalPriorityTicker() {
    const ticker = document.getElementById('global-priority-ticker');
    const msg = document.getElementById('priority-ticker-msg');
    if (!ticker || !msg) return;

    try {
      const { data: topNeed, error } = await supabase
        .from('surveys')
        .select('needs, ngo_name, priority_score')
        .eq('is_available', true)
        .order('priority_score', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && topNeed && topNeed.priority_score > 0.8) {
        ticker.classList.remove('hidden');
        msg.innerHTML = `<strong>CRITICAL:</strong> ${topNeed.ngo_name} urgently needs "${topNeed.needs}" (${Math.round(topNeed.priority_score * 100)}% Priority)`;
      } else {
        ticker.classList.add('hidden');
      }
    } catch (e) {
      console.warn('Ticker error:', e);
    }
  }

  // Initial loads
  loadDashboard();
  loadGlobalPriorityTicker();
  let ngoDashboardChannel = null;
  let ngoNamesCache = [];
  function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0.5;
    let dotProduct = 0, mA = 0, mB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += (vecA[i] * vecB[i]);
        mA += (vecA[i] * vecA[i]);
        mB += (vecB[i] * vecB[i]);
    }
    mA = Math.sqrt(mA);
    mB = Math.sqrt(mB);
    if ((mA * mB) === 0) return 0.5;
    return dotProduct / (mA * mB);
  }

  function getHaversineDistance(lat1, lon1, lat2, lon2) {
    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async function autoAssignVolunteer(surveyId) {
    const btn = document.querySelector(`[data-auto-assign="${surveyId}"]`);
    if (!btn) return;
    
    setLoadingState(btn, true, '+ Auto Assign');

    try {
      const { data: survey, error: sError } = await supabase.from('surveys').select('*, ngos(lat, lng)').eq('id', surveyId).single();
      if (sError || !survey) throw new Error("Need not found.");

      const surveyLat = survey.ngos?.lat;
      const surveyLng = survey.ngos?.lng;

      const { data: volunteers, error: vError } = await supabase
        .from('volunteer_details')
        .select('*')
        .eq('is_available', true);
      if (vError || !volunteers || volunteers.length === 0) throw new Error("No available volunteers at this time.");

      const scored = volunteers.map(vol => {
          const skillSimilarity = (survey.embedding && vol.skills_embedding) 
            ? cosineSimilarity(survey.embedding, vol.skills_embedding)
            : 0.5;

          let distanceScore = 0.4;
          const dist = getHaversineDistance(surveyLat, surveyLng, vol.lat, vol.lng);
          if (dist !== null) {
              distanceScore = Math.max(0, 1 - (dist / 50));
          } else if (survey.region === vol.location_name) {
              distanceScore = 0.8;
          }

          const urgencyWeight = survey.urgency_level === 'High' ? 1.0 : survey.urgency_level === 'Medium' ? 0.6 : 0.3;
          const reliability = vol.volunteer_reliability || 0.8;
          
          const matchScore = (skillSimilarity * 0.5) + (distanceScore * 0.2) + (urgencyWeight * 0.2) + (reliability * 0.1);
          return { ...vol, matchScore };
      }).sort((a, b) => b.matchScore - a.matchScore);

      const best = scored[0];
      if (best) {
        const { error } = await supabase.from('surveys')
          .update({ 
            committed_by: best.user_id, 
            status: 'in_progress', 
            is_available: false,
            assigned_at: new Date().toISOString() 
          })
          .eq('id', surveyId);
        
        if (error) throw error;
        showToast(`Successfully assigned to ${best.full_name}! 🚀`);
        loadDashboard();
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoadingState(btn, false, '+ Auto Assign');
    }
  }

  window.autoAssignProxy = (id) => autoAssignVolunteer(id);

  // ── Load NGO's Surveys (Kanban - FIX 6) ─────────────────────
  async function loadDashboard() {
    const board = document.getElementById('kanban-board');
    if (!board) return;

    // Kanban skeleton while fetching.
    ['col-open', 'col-in-progress', 'col-resolved'].forEach((id) => {
      const col = document.getElementById(id);
      if (col) {
        col.innerHTML = `
          <div class="animate-pulse bg-gray-800/40 rounded-xl p-4 h-20 mb-2"></div>
          <div class="animate-pulse bg-gray-800/30 rounded-xl p-4 h-20 mb-2"></div>
        `;
      }
    });

    // Add loading skeleton class to stats
    ['stat-total', 'stat-active', 'stat-progress', 'stat-resolved'].forEach(id => {
      document.getElementById(id)?.classList.add('sa-skeleton');
    });

    try {
      const { data: myNgos } = await supabase.from('ngos').select('name').eq('user_id', userId);
      const ngoNames = (myNgos || []).map(n => n.name);
      ngoNamesCache = ngoNames;

      const { data: fetchedSurveys, error } = await supabase
        .from('surveys')
        .select('*')
        .in('ngo_name', ngoNames);

      if (error) throw error;

      // Calculate Real-time Priority Scores
      const surveys = fetchedSurveys.map(s => {
        const waitingDays = (new Date() - new Date(s.created_at)) / (1000 * 60 * 60 * 24);
        const urgencyWeight = { High: 3, Medium: 2, Low: 1 }[s.urgency_level] || 1;
        const normalizedPeople = Math.min((s.people_affected || 0) / 100, 3);
        const normalizedTime = Math.min(waitingDays / 7, 3);
        const resourceGap = s.committed_by ? 0.3 : 1;

        const priorityScore =
          (urgencyWeight * 0.4) +
          (normalizedPeople * 0.3) +
          (normalizedTime * 0.2) +
          (resourceGap * 0.1);

        return { ...s, priorityScore };
      }).sort((a, b) => b.priorityScore - a.priorityScore);

      // Stats
      const total = surveys.length;
      const active = surveys.filter(s => s.is_available).length;
      const inProgress = surveys.filter(s => s.status === 'in_progress').length;
      const resolved = surveys.filter(s => s.status === 'resolved').length;

      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-active').textContent = active;
      document.getElementById('stat-progress').textContent = inProgress;
      document.getElementById('stat-resolved').textContent = resolved;

      // Remove loading skeletons
      ['stat-total', 'stat-active', 'stat-progress', 'stat-resolved'].forEach(id => {
        document.getElementById(id)?.classList.remove('sa-skeleton');
      });

      // Removed empty-state toggle as the element was deleted
      board.classList.remove('hidden');

      // Kanban columns
      const cols = {
        open: surveys.filter(s => s.is_available && s.status !== 'resolved' && s.status !== 'in_progress'),
        in_progress: surveys.filter(s => s.status === 'in_progress'),
        resolved: surveys.filter(s => s.status === 'resolved')
      };

      function renderCard(s) {
        const urgencyColors = { High: 'red', Medium: 'yellow', Low: 'green' };
        const uc = urgencyColors[s.urgency_level] || 'gray';
        const date = new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        
        // Dynamic Badge Logic (Score > 1.8 is roughly Top-tier priority after normalization)
        const isHighPriority = s.priorityScore > 1.8;

        return `
          <div class="kanban-card group border-transparent hover:border-emerald-500/30 transition-all" draggable="true" data-survey-id="${s.id}" data-status="${s.status || 'open'}" 
               style="${isHighPriority ? 'border-color: rgba(249, 115, 22, 0.4); box-shadow: 0 0 20px rgba(249, 115, 22, 0.1);' : ''}">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-${uc}-500/10 text-${uc}-400 border border-${uc}-500/20">${s.urgency_level || 'Medium'}</span>
              ${isHighPriority ? `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400 border border-orange-500/30 shadow-sm animate-pulse">🔥 Critical Priority</span>` : ''}
              <span class="text-[10px] text-gray-600 ml-auto">${date}</span>
            </div>
            <p class="text-xs font-semibold text-blue-400 mb-1">${escapeHtml(s.ngo_name)}</p>
            <p class="text-xs text-gray-300 line-clamp-2">"${escapeHtml(s.needs)}"</p>
            <div class="mt-2 flex items-center justify-between">
                <div class="flex flex-col">
                  <span class="text-[10px] text-gray-500">👥 ${s.people_affected || 0} Affected</span>
                  <span class="text-[9px] text-emerald-500 font-bold mt-0.5">Score: ${s.priorityScore.toFixed(2)}</span>
                </div>
                <span class="text-[10px] text-gray-500">📑 ${s.category || 'General'}</span>
            </div>
            ${s.committed_by ? `<p class="text-[10px] text-emerald-400 mt-2">👤 Volunteer assigned</p>` : ''}
            <div class="flex gap-2 mt-3 flex-wrap">
              ${s.is_available ? `
                <button onclick="window.autoAssignProxy('${s.id}')" class="flex-1 py-1.5 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 text-emerald-400 hover:text-white text-[9px] font-bold uppercase rounded-lg transition-all" style="min-height:36px">+ Auto</button>
                <button onclick="window.openEditModal('${s.id}')" class="w-10 h-10 flex items-center justify-center bg-blue-600/10 hover:bg-blue-600 border border-blue-500/10 text-blue-400 hover:text-white rounded-lg transition-all" title="Edit Need">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
              ` : ''}
              ${s.committed_by && s.status !== 'resolved' ? `<button onclick="openChat('${s.id}')" class="flex-1 py-1.5 bg-blue-600/10 hover:bg-blue-600 border border-blue-500/20 text-blue-400 hover:text-white text-[9px] font-bold uppercase rounded-lg transition-all" style="min-height:36px">💬 Chat</button>` : ''}
              ${s.status === 'resolved' && s.committed_by ? `<button onclick="openRatingModal('${s.id}','${s.committed_by}')" class="flex-1 py-1.5 bg-yellow-600/10 border border-yellow-500/20 text-yellow-400 text-[9px] font-bold uppercase rounded-lg" style="min-height:36px">⭐ Rate</button>` : ''}
              ${s.is_available ? `<button onclick="deleteSurvey('${s.id}')" aria-label="Delete need" title="Delete Need" class="w-10 h-10 flex items-center justify-center bg-red-600/10 hover:bg-red-600 border border-red-500/20 text-red-400 hover:text-white rounded-lg transition-all" style="min-height:36px">✕</button>` : ''}
            </div>
          </div>
        `;
      }

      function renderEmpty(msg) {
        return `
          <div class="flex flex-col items-center justify-center p-6 border border-dashed border-gray-800 rounded-xl bg-gray-900/30 text-center min-h-[120px]">
            <svg class="w-8 h-8 opacity-20 text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
            <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">${msg}</p>
          </div>
        `;
      }

      document.getElementById('col-open').innerHTML = cols.open.map(renderCard).join('') || renderEmpty('No Open Requests');
      document.getElementById('col-in-progress').innerHTML = cols.in_progress.map(renderCard).join('') || renderEmpty('No Active Ops');
      document.getElementById('col-resolved').innerHTML = cols.resolved.map(renderCard).join('') || renderEmpty('None Resolved');

      setupDragAndDrop();
      setTimeout(() => window.loadUnreadBadges && window.loadUnreadBadges(), 500);

    } catch (err) {
      console.error('Dashboard load error:', err);
      ['stat-total', 'stat-active', 'stat-progress', 'stat-resolved'].forEach(id => {
        document.getElementById(id)?.classList.remove('sa-skeleton');
      });
    }
  }

  // ── Phase 4: Impact Analytics & Charting ─────────────────────
  let charts = {};

  async function loadAnalytics() {
    destroyCharts();
    try {
        const { data: myNgos } = await supabase.from('ngos').select('name').eq('user_id', userId);
        const ngoNames = (myNgos || []).map(n => n.name);
        
        const { data: surveys } = await supabase.from('surveys').select('*').in('ngo_name', ngoNames);
        if (!surveys) return;

        const { data: metrics } = await supabase.from('impact_metrics').select('*').in('ngo_name', ngoNames);
        let totalPeople = 0, successSum = 0, responseTotal = 0;
        if (metrics && metrics.length > 0) {
            totalPeople = metrics.reduce((sum, m) => sum + (m.total_people_helped || 0), 0);
            successSum = (metrics.reduce((sum, m) => sum + (m.success_rate || 0), 0) / metrics.length);
            const respTimes = metrics.filter(m => m.avg_response_time).map(m => {
                const match = String(m.avg_response_time).match(/(\d+):(\d+):(\d+)/);
                if (match) return parseInt(match[1]) + (parseInt(match[2]) / 60);
                return 0;
            });
            responseTotal = respTimes.length > 0 ? (respTimes.reduce((a, b) => a + b, 0) / respTimes.length) : 0;
        }
        document.getElementById('ana-people').textContent = totalPeople;
        document.getElementById('ana-success').textContent = Math.round(successSum * 100) + '%';
        document.getElementById('ana-response').textContent = responseTotal > 0 ? `${responseTotal.toFixed(1)}h` : 'N/A';

        // Prepare Category Data
        const categories = {};
        surveys.forEach(s => { if(s.category) categories[s.category] = (categories[s.category] || 0) + 1; });
        
        // Prepare Trend Data (Last 7 days)
        const trends = {};
        surveys.forEach(s => {
            const date = new Date(s.created_at).toLocaleDateString();
            trends[date] = (trends[date] || 0) + 1;
        });

        renderCharts(categories, trends);
        generateAiInsights(surveys);

    } catch (err) {
      destroyCharts();
      console.error('Analytics error:', err);
    }
  }

  function destroyCharts() {
    if (charts.category) charts.category.destroy();
    if (charts.trend) charts.trend.destroy();
    charts.category = null;
    charts.trend = null;
  }

  function renderCharts(categories, trends) {
    destroyCharts();

    const ctxCat = document.getElementById('categoryChart')?.getContext('2d');
    const ctxTrend = document.getElementById('trendChart')?.getContext('2d');

    if (ctxCat) {
      charts.category = new Chart(ctxCat, {
        type: 'bar',
        data: {
            labels: Object.keys(categories),
            datasets: [{
                label: 'Needs by Category',
                data: Object.values(categories),
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                borderColor: '#10b981',
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } } } }
      });
    }

    if (ctxTrend) {
      charts.trend = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: Object.keys(trends),
            datasets: [{
                label: 'Needs Trend',
                data: Object.values(trends),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } } } }
      });
    }
  }

  async function generateAiInsights(surveys) {
    const el = document.getElementById('ai-insights');
    if (!el) return;

    try {
        const categoryCounts = {};
        const urgencyCounts = { High: 0, Medium: 0, Low: 0 };
        surveys.forEach((survey) => {
          const cat = String(survey.category || 'General');
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
          const urgency = String(survey.urgency_level || 'Medium');
          if (urgencyCounts[urgency] !== undefined) urgencyCounts[urgency] += 1;
        });

        const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
        const total = surveys.length || 1;
        const openNeeds = surveys.filter((s) => s.is_available).length;
        const resolvedNeeds = surveys.filter((s) => s.status === 'resolved').length;
        const openRate = Math.round((openNeeds / total) * 100);
        const resolvedRate = Math.round((resolvedNeeds / total) * 100);

        const insights = [
          `Top demand category: ${topCategory ? `${topCategory[0]} (${topCategory[1]} needs)` : 'General'}.`,
          `Urgency mix: High ${urgencyCounts.High}, Medium ${urgencyCounts.Medium}, Low ${urgencyCounts.Low}.`,
          `Pipeline health: ${openRate}% open, ${resolvedRate}% resolved.`
        ];

        el.innerHTML = insights
          .map((line) => `<div class="text-sm text-gray-300 flex gap-2"><span class="text-emerald-400">●</span> ${line}</div>`)
          .join('');
    } catch (e) {
        el.innerHTML = '<div class="text-xs text-gray-600">AI insights currently unavailable.</div>';
    }
  }

  // FIX 6: Drag and Drop for Kanban
  function setupDragAndDrop() {
    function openVolunteerAssignModal(volunteers) {
      return new Promise((resolve) => {
        const modal = document.getElementById('assign-volunteer-modal');
        const list = document.getElementById('assign-volunteer-list');
        const closeBtn = document.getElementById('close-assign-modal-btn');
        const cancelBtn = document.getElementById('cancel-assign-modal-btn');
        if (!modal || !list || !closeBtn || !cancelBtn) {
          resolve(null);
          return;
        }

        list.innerHTML = volunteers.map((v) => `
          <button type="button"
            class="assign-vol-option w-full text-left bg-gray-800/60 border border-gray-700 hover:border-emerald-500/40 hover:bg-emerald-600/10 rounded-xl px-4 py-3 transition-all"
            data-user-id="${v.user_id}">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-bold text-white">${escapeHtml(v.full_name || 'Volunteer')}</p>
                <p class="text-[10px] text-gray-500 mt-1">ID: ${escapeHtml(v.user_id.slice(0, 8))}...</p>
              </div>
              <span class="text-[10px] font-black uppercase tracking-wider text-emerald-400">Select</span>
            </div>
          </button>
        `).join('');

        const cleanup = () => {
          modal.classList.add('hidden');
          closeBtn.onclick = null;
          cancelBtn.onclick = null;
          list.querySelectorAll('.assign-vol-option').forEach((btn) => { btn.onclick = null; });
        };
        const closeWith = (val) => { cleanup(); resolve(val); };

        closeBtn.onclick = () => closeWith(null);
        cancelBtn.onclick = () => closeWith(null);
        list.querySelectorAll('.assign-vol-option').forEach((btn) => {
          btn.onclick = () => closeWith(btn.getAttribute('data-user-id'));
        });

        modal.classList.remove('hidden');
      });
    }

    async function chooseVolunteerForAssignment() {
      const { data: volunteers, error } = await supabase
        .from('volunteer_details')
        .select('user_id, full_name')
        .eq('is_available', true)
        .order('tasks_completed', { ascending: false })
        .limit(10);
      if (error || !volunteers || volunteers.length === 0) {
        throw new Error('No available volunteers to assign.');
      }
      return await openVolunteerAssignModal(volunteers);
    }

    let draggedId = null;
    const colMap = { 'col-open': 'open', 'col-in-progress': 'in_progress', 'col-resolved': 'resolved' };

    document.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', (e) => { draggedId = card.getAttribute('data-survey-id'); e.dataTransfer.effectAllowed = 'move'; });
    });

    document.querySelectorAll('.kanban-col-drop').forEach(col => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!draggedId) return;
        const colId = col.id.replace('-drop', '');
        const newStatus = colMap[colId];
        if (!newStatus) return;

        const updates = { status: newStatus };
        if (newStatus === 'open') { updates.is_available = true; updates.committed_by = null; updates.assigned_at = null; }
        if (newStatus === 'in_progress') {
            const selectedVolunteer = await chooseVolunteerForAssignment();
            if (!selectedVolunteer) {
              showToast('In Progress requires selecting a volunteer.', true);
              draggedId = null;
              return;
            }
            updates.is_available = false; 
            updates.committed_by = selectedVolunteer;
            updates.assigned_at = new Date().toISOString(); 
        }
        if (newStatus === 'resolved') { 
            updates.status = 'resolved'; 
            updates.completed_at = new Date().toISOString();
        }

        const { error } = await supabase.from('surveys').update(updates).eq('id', draggedId);
        
        if (error) {
            showToast('Update failed: ' + error.message, true);
        } else {
            // FIX: Credit volunteer if resolved
            if (newStatus === 'resolved') {
                const { data: s } = await supabase.from('surveys').select('committed_by').eq('id', draggedId).single();
                if (s && s.committed_by) {
                    const { data: vol } = await supabase.from('volunteer_details').select('*').eq('user_id', s.committed_by).single();
                    if (vol) {
                        const { data: surveyRow } = await supabase.from('surveys').select('assigned_at').eq('id', draggedId).single();
                        let computedHours = DEFAULT_TASK_HOURS;
                        if (surveyRow?.assigned_at) {
                          const started = new Date(surveyRow.assigned_at).getTime();
                          const ended = Date.now();
                          if (!Number.isNaN(started) && ended > started) {
                            computedHours = Math.max(1, Math.round((ended - started) / (1000 * 60 * 60)));
                          }
                        }
                        await supabase.from('volunteer_details').update({
                            tasks_completed: (vol.tasks_completed || 0) + 1,
                            total_hours: (vol.total_hours || 0) + computedHours,
                            impact_score: (vol.impact_score || 0) + 15
                        }).eq('user_id', s.committed_by);
                    }
                }
            }
            loadDashboard();
        }
        draggedId = null;
      });
    });
  }

  // ── FIX 3: Find Volunteers Tab ──────────────────────────────
  let volunteerSearchQuery = '';
  let volunteerOffset = 0;
  let hasMoreVolunteers = true;

  async function loadVolunteers() {
    const container = document.getElementById('volunteers-list');
    if (!container) return;
    container.innerHTML = '<div class="text-gray-500 text-sm text-center py-6">Loading volunteers...</div>';

    try {
      let query = supabase.from('volunteer_details').select('*');

      if (volunteerSearchQuery) {
        query = query.or(`full_name.ilike.%${volunteerSearchQuery}%,skills_summary.ilike.%${volunteerSearchQuery}%,location_name.ilike.%${volunteerSearchQuery}%`);
      }

      if (!volunteerSearchQuery) {
        volunteerOffset = 0;
        hasMoreVolunteers = true;
      }

      const { data: volunteers, error } = await query
        .order('tasks_completed', { ascending: false })
        .order('location_name', { ascending: true })
        .range(volunteerOffset, volunteerOffset + VOLUNTEER_PAGE_SIZE - 1);
      if (error) throw error;
      const volunteerRows = volunteers || [];
      const rankedVolunteers = volunteerRows
        .map((vol) => {
          let relevanceScore = vol.tasks_completed || 0;
          if (volunteerSearchQuery) {
            const haystack = `${vol.full_name || ''} ${vol.skills_summary || ''} ${vol.location_name || ''}`.toLowerCase();
            const needle = volunteerSearchQuery.toLowerCase();
            if (haystack.includes(needle)) relevanceScore += 5;
          }
          return { ...vol, relevanceScore };
        })
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
      hasMoreVolunteers = volunteerRows.length === VOLUNTEER_PAGE_SIZE;
      volunteerOffset += volunteerRows.length;

      if (!volunteers || volunteers.length === 0) {
        container.innerHTML = `
          <div class="col-span-2 flex flex-col items-center justify-center p-12 bg-gray-900/30 border border-dashed border-gray-800 rounded-2xl">
            <svg class="w-12 h-12 opacity-20 text-gray-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            <p class="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">No Matches Found</p>
            <p class="text-[10px] text-gray-600">Try adjusting your search criteria or wait for more volunteers to sign up.</p>
          </div>
        `;
        return;
      }

      const cardsHtml = rankedVolunteers.map(vol => {
        const stars = '★'.repeat(Math.round(vol.rating || 5)) + '☆'.repeat(5 - Math.round(vol.rating || 5));
        const skillTags = (vol.skills || []).slice(0, 3).map(s => `<span class="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[9px] font-bold">${escapeHtml(s)}</span>`).join('');
        return `
          <div class="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 hover:border-gray-600 transition-all">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="font-bold text-white text-sm">${escapeHtml(vol.full_name || 'Anonymous')}</p>
                <p class="text-[10px] text-gray-500 mt-0.5">📍 ${escapeHtml(vol.location_name || 'Location not set')}</p>
                <div class="flex items-center gap-3 mt-2">
                  <span class="text-blue-400 text-[10px] font-bold">Reliability: ${Math.round((vol.volunteer_reliability || 0.8)*100)}%</span>
                  <span class="text-yellow-400 text-xs">${stars}</span>
                </div>
                <p class="text-xs text-gray-400 mt-2 line-clamp-2">${escapeHtml(vol.skills_summary || 'No skills listed')}</p>
                <div class="flex items-center gap-2 mt-2 flex-wrap">
                  ${skillTags}
                </div>
              </div>
              <button onclick="openInviteModal('${vol.user_id}', '${(vol.full_name || '').replace(/'/g, "\\'")}', '${(vol.skills_summary || '').replace(/'/g, "\\'")}')"
                class="flex-shrink-0 px-3 py-2 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 hover:border-emerald-500 text-emerald-400 hover:text-white text-[10px] font-bold uppercase rounded-lg transition-all"
                style="min-height:44px">
                ✉ Invite
              </button>
            </div>
          </div>
        `;
      }).join('');
      const loadMoreHtml = hasMoreVolunteers ? `<div class="col-span-2 text-center"><button id="load-more-volunteers" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-bold uppercase tracking-wider">Load More</button></div>` : '';
      container.innerHTML = cardsHtml + loadMoreHtml;
      const attachLoadMoreListener = () => document.getElementById('load-more-volunteers')?.addEventListener('click', async () => {
        const btn = document.getElementById('load-more-volunteers');
        if (btn) btn.disabled = true;
        const existingHtml = container.innerHTML.replace(loadMoreHtml, '');
        let nextQuery = supabase.from('volunteer_details').select('*');
        if (volunteerSearchQuery) {
          nextQuery = nextQuery.or(`full_name.ilike.%${volunteerSearchQuery}%,skills_summary.ilike.%${volunteerSearchQuery}%,location_name.ilike.%${volunteerSearchQuery}%`);
        }
        const { data: nextVols } = await nextQuery
          .order('tasks_completed', { ascending: false })
          .order('location_name', { ascending: true })
          .range(volunteerOffset, volunteerOffset + VOLUNTEER_PAGE_SIZE - 1);
        const nextItems = nextVols || [];
        const rankedNextItems = nextItems
          .map((vol) => {
            let relevanceScore = vol.tasks_completed || 0;
            if (volunteerSearchQuery) {
              const haystack = `${vol.full_name || ''} ${vol.skills_summary || ''} ${vol.location_name || ''}`.toLowerCase();
              const needle = volunteerSearchQuery.toLowerCase();
              if (haystack.includes(needle)) relevanceScore += 5;
            }
            return { ...vol, relevanceScore };
          })
          .sort((a, b) => b.relevanceScore - a.relevanceScore);
        volunteerOffset += nextItems.length;
        hasMoreVolunteers = nextItems.length === VOLUNTEER_PAGE_SIZE;
        const nextHtml = rankedNextItems.map(vol => {
          const stars = '★'.repeat(Math.round(vol.rating || 5)) + '☆'.repeat(5 - Math.round(vol.rating || 5));
          const skillTags = (vol.skills || []).slice(0, 3).map(s => `<span class="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[9px] font-bold">${escapeHtml(s)}</span>`).join('');
          return `<div class="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 hover:border-gray-600 transition-all"><div class="flex items-start justify-between gap-3"><div class="flex-1 min-w-0"><p class="font-bold text-white text-sm">${escapeHtml(vol.full_name || 'Anonymous')}</p><p class="text-[10px] text-gray-500 mt-0.5">📍 ${escapeHtml(vol.location_name || 'Location not set')}</p><div class="flex items-center gap-3 mt-2"><span class="text-blue-400 text-[10px] font-bold">Reliability: ${Math.round((vol.volunteer_reliability || 0.8)*100)}%</span><span class="text-yellow-400 text-xs">${stars}</span></div><p class="text-xs text-gray-400 mt-2 line-clamp-2">${escapeHtml(vol.skills_summary || 'No skills listed')}</p><div class="flex items-center gap-2 mt-2 flex-wrap">${skillTags}</div></div><button onclick="openInviteModal('${vol.user_id}', '${(vol.full_name || '').replace(/'/g, "\\'")}', '${(vol.skills_summary || '').replace(/'/g, "\\'")}')" class="flex-shrink-0 px-3 py-2 bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/20 hover:border-emerald-500 text-emerald-400 hover:text-white text-[10px] font-bold uppercase rounded-lg transition-all" style="min-height:44px">✉ Invite</button></div></div>`;
        }).join('');
        const nextLoadMoreHtml = hasMoreVolunteers ? `<div class="col-span-2 text-center"><button id="load-more-volunteers" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs font-bold uppercase tracking-wider">Load More</button></div>` : '';
        container.innerHTML = existingHtml + nextHtml + nextLoadMoreHtml;
        attachLoadMoreListener();
      });
      attachLoadMoreListener();
    } catch (err) {
      container.innerHTML = `<p class="text-red-400 text-sm text-center py-4">${err.message}</p>`;
    }
  }

  // Volunteer search input
  const volSearchInput = document.getElementById('vol-search-input');
  if (volSearchInput) {
    const handleInput = (e) => {
      volunteerSearchQuery = e.target.value.trim();
      volunteerOffset = 0;
      hasMoreVolunteers = true;
      clearTimeout(volSearchInput._debounce);
      volSearchInput._debounce = setTimeout(loadVolunteers, 400);
    };
    volSearchInput.addEventListener('input', handleInput);
  }

  // ── FIX 3: Invite Modal ─────────────────────────────────────
  let inviteTargetUser = null;

  window.openInviteModal = async function(volunteerUserId, name, skills) {
    inviteTargetUser = volunteerUserId;
    document.getElementById('invite-vol-name').textContent = name;
    document.getElementById('invite-vol-skills').textContent = skills || 'No skills listed';

    const surveySelect = document.getElementById('invite-survey-select');
    surveySelect.innerHTML = '<option value="">Loading surveys...</option>';

    const { data: myNgos } = await supabase.from('ngos').select('name').eq('user_id', userId);
    const ngoNames = (myNgos || []).map(n => n.name);
    const { data: surveys } = await supabase.from('surveys').select('id, ngo_name, needs').in('ngo_name', ngoNames).eq('is_available', true);

    if (!surveys || surveys.length === 0) {
      surveySelect.innerHTML = '<option value="">No active surveys available</option>';
    } else {
      surveySelect.innerHTML = '<option value="">Select a survey to invite for...</option>' +
        surveys.map(s => `<option value="${s.id}">[${s.ngo_name}] ${s.needs.substring(0, 60)}...</option>`).join('');
    }

    document.getElementById('invite-modal').classList.remove('hidden');
  };

  document.getElementById('submit-invite-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    const surveyId = document.getElementById('invite-survey-select').value;
    const message = document.getElementById('invite-message').value.trim();

    if (!surveyId) { showToast('Please select a survey.', true); return; }
    if (!inviteTargetUser) return;

    setLoadingState(btn, true, 'Send Invitation');

    try {
      const { error } = await supabase.from('invitations').insert([{
        survey_id: surveyId,
        ngo_user_id: userId,
        volunteer_user_id: inviteTargetUser,
        message: message || null,
        status: 'pending'
      }]);

      if (error) throw error;
      
      showToast('Invitation sent successfully!');
      document.getElementById('invite-modal').classList.add('hidden');
      document.getElementById('invite-message').value = '';
      inviteTargetUser = null;
    } catch (err) {
      showToast('Failed to send invitation: ' + err.message, true);
    } finally {
      setLoadingState(btn, false, 'Send Invitation');
    }
  });

  // ── Delete Survey ────────────────────────────────────────────
  window.deleteSurvey = async (surveyId) => {
    if (!confirm('Delete this survey? This cannot be undone.')) return;
    const { error } = await supabase.from('surveys').delete().eq('id', surveyId).eq('user_id', userId);
    if (error) { showToast('Error: ' + error.message, true); return; }
    showToast('Survey deleted.');
    loadDashboard();
  };

  // ── Edit Survey ──────────────────────────────────────────────
  window.openEditModal = async (surveyId) => {
    try {
      const { data: s, error } = await supabase.from('surveys').select('*').eq('id', surveyId).single();
      if (error) throw error;

      document.getElementById('edit-survey-id').value = s.id;
      document.getElementById('edit-needs-text').value = s.needs;
      document.getElementById('edit-urgency-level').value = s.urgency_level || 'Medium';
      document.getElementById('edit-people-affected').value = s.people_affected || 1;
      document.getElementById('edit-category').value = s.category || 'General';
      
      document.getElementById('edit-survey-modal').classList.remove('hidden');
    } catch (e) {
      showToast('Error loading survey: ' + e.message, true);
    }
  };

  document.getElementById('save-edit-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    const surveyId = document.getElementById('edit-survey-id').value;
    const needs = document.getElementById('edit-needs-text').value.trim();
    const urgency = document.getElementById('edit-urgency-level').value;
    const people = parseInt(document.getElementById('edit-people-affected').value) || 1;
    const category = document.getElementById('edit-category').value;

    if (!needs) { showToast('Needs description is required.', true); return; }

    setLoadingState(btn, true, 'Save Changes');

    try {
        const { data: existingSurvey } = await supabase
          .from('surveys')
          .select('created_at, committed_by')
          .eq('id', surveyId)
          .single();
        const waitingDays = existingSurvey?.created_at
          ? (new Date() - new Date(existingSurvey.created_at)) / (1000 * 60 * 60 * 24)
          : 0;
        const urgencyWeight = { High: 3, Medium: 2, Low: 1 }[urgency] || 1;
        const normalizedPeople = Math.min((people || 0) / 100, 3);
        const normalizedTime = Math.min(waitingDays / 7, 3);
        const resourceGap = existingSurvey?.committed_by ? 0.3 : 1;
        const priorityScore =
          (urgencyWeight * 0.4) +
          (normalizedPeople * 0.3) +
          (normalizedTime * 0.2) +
          (resourceGap * 0.1);

        const { error } = await supabase.from('surveys').update({
            needs,
            urgency_level: urgency,
            people_affected: people,
            category,
            priority_score: priorityScore
        }).eq('id', surveyId).eq('user_id', userId);

        if (error) throw error;
        
        // If needs changed, regenerate embedding
        try {
            const embedding = await window.getEmbedding(needs);
            await supabase.from('surveys').update({ embedding }).eq('id', surveyId);
        } catch (embErr) {
            console.warn('Embedding update failed (silent):', embErr);
        }

        document.getElementById('edit-survey-modal').classList.add('hidden');
        showToast('Mission updated successfully!');
        loadDashboard();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        setLoadingState(btn, false, 'Save Changes');
    }
  });

  // ── Rating System ────────────────────────────────────────────
  let currentRatingSurveyId = null;
  let currentRatedUser = null;
  let currentRatingScore = 0;

  window.setRating = (score) => {
    currentRatingScore = score;
    document.querySelectorAll('.rating-star').forEach((star, i) => { star.style.color = i < score ? '#facc15' : '#4b5563'; });
  };

  window.openRatingModal = async (surveyId, volunteerId) => {
    const { data: survey, error } = await supabase
      .from('surveys')
      .select('user_id')
      .eq('id', surveyId)
      .single();
    if (error || !survey || survey.user_id !== userId) {
      showToast('You can only rate volunteers for your own surveys.', true);
      return;
    }
    currentRatingSurveyId = surveyId;
    currentRatedUser = volunteerId;
    currentRatingScore = 0;
    document.querySelectorAll('.rating-star').forEach(s => s.style.color = '#4b5563');
    document.getElementById('rating-comment').value = '';
    document.getElementById('rating-modal').classList.remove('hidden');
  };

  document.getElementById('submit-rating-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    if (currentRatingScore === 0) { showToast('Please select a rating.', true); return; }

    setLoadingState(btn, true, 'Submit Rating');

    try {
      const { error } = await supabase.from('ratings').insert([{
        survey_id: currentRatingSurveyId,
        rated_by: userId,
        rated_user: currentRatedUser,
        score: currentRatingScore,
        comment: document.getElementById('rating-comment').value
      }]);

      if (error) {
        if (error.code === '23505') throw new Error('You already rated this task.');
        throw error;
      }

      const { data: allRatings } = await supabase.from('ratings').select('score').eq('rated_user', currentRatedUser);
      if (allRatings && allRatings.length > 0) {
        const avg = allRatings.reduce((sum, r) => sum + r.score, 0) / allRatings.length;
        const { data: vol } = await supabase.from('volunteer_details').select('volunteer_reliability, impact_score').eq('user_id', currentRatedUser).single();
        
        let oldReliability = vol.volunteer_reliability || 0.8;
        let newReliability = (oldReliability * 0.7) + ((currentRatingScore / 5) * 0.3);

        await supabase.from('volunteer_details').update({
          rating: Math.round(avg * 10) / 10,
          reviews_count: allRatings.length,
          volunteer_reliability: Math.min(1.0, newReliability),
          impact_score: (vol.impact_score || 0) + (currentRatingScore * 10)
        }).eq('user_id', currentRatedUser);
      }

      document.getElementById('rating-modal').classList.add('hidden');
      showToast('Rating submitted! Thank you.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoadingState(btn, false, 'Submit Rating');
    }
  });

  // ── Real-Time Updates ─────────────────────────────────────────
  if (ngoNamesCache.length === 0) {
    const { data: myNgos } = await supabase.from('ngos').select('name').eq('user_id', userId);
    ngoNamesCache = (myNgos || []).map(n => n.name);
  }
  const safeNgoNames = ngoNamesCache
    .map(name => `"${String(name).replace(/"/g, '\\"')}"`)
    .join(',');
  if (safeNgoNames) {
    ngoDashboardChannel = supabase.channel('ngo-dashboard-live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'surveys', filter: `ngo_name=in.(${safeNgoNames})` },
        () => { loadDashboard(); }
      )
      .subscribe();
  }

  window.addEventListener('beforeunload', () => {
    ngoDashboardChannel?.unsubscribe();
  });
});
