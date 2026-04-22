/* ============================================================
   SmartAllocation — Profile Logic (profile.js)
   Updated with premium Volunteer overhaul & Typography support.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    const safeSetHTML = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };

    const loadingEl = document.getElementById('profile-loading');

    if (typeof CONFIG === 'undefined') {
        loadingEl.innerHTML = `<p class="text-red-400 font-bold uppercase tracking-widest">Error: Configuration Missing</p>`;
        return;
    }

    const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

    const loadTimeout = setTimeout(() => {
        if (!loadingEl.classList.contains('hidden') && !loadingEl.querySelector('.text-red-400')) {
            loadingEl.innerHTML = `
                <div class="text-center p-8 bg-gray-900/50 border border-gray-800 rounded-2xl">
                    <p class="text-gray-400 font-bold uppercase tracking-widest mb-4">Connection is slow...</p>
                    <button onclick="window.location.reload()" class="bg-blue-600 px-6 py-2 rounded-xl text-xs font-bold hover:bg-blue-500 transition-all">Retry Now</button>
                </div>
            `;
        }
    }, 8000);

    async function init() {
        try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;
            if (!session) {
                window.location.href = 'login.html';
                return;
            }

            const { user } = session;
            let currentRole = null;
            let detailData = null;

            // 1. Fetch Basic Profile
            let { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (profileError && profileError.code === 'PGRST116') {
                const { data: newP, error: e } = await supabase.from('profiles').insert([{ id: user.id, role: 'Volunteer' }]).select().single();
                if (e) throw e; profile = newP;
            } else if (profileError) throw profileError;

            currentRole = profile.role;

            // 2. Fetch Detailed Metadata
            const tableName = currentRole === 'NGO' ? 'ngo_details' : 'volunteer_details';
            const { data: details } = await supabase.from(tableName).select('*').eq('user_id', user.id).single();
            detailData = details || {};

            // Fetch extra NGO data if needed (Category)
            if (currentRole === 'NGO') {
                const { data: ngoRow } = await supabase.from('ngos').select('category').eq('user_id', user.id).single();
                if (ngoRow?.category) detailData.category = ngoRow.category;
                // Ensure org_name and category are populated from registration metadata if missing
                if (!detailData.org_name && user.user_metadata?.full_name) {
                    detailData.org_name = user.user_metadata.full_name;
                }
                if (!detailData.category && user.user_metadata?.category) {
                    detailData.category = user.user_metadata.category;
                }
            }
            
            // 3. Update Header
            safeSetText('page-subtitle', currentRole);
            safeSetText('page-title', (currentRole === 'NGO' ? detailData.org_name : detailData.full_name) || 'My Profile');

            // 4. Render View
            if (currentRole === 'NGO') {
                renderNGO(detailData, user.email);
            } else {
                renderVolunteer(detailData, user.email);
                loadRecentActivity(user.id);
            }
            loadStats(currentRole, detailData, user.id);
            setupListeners(user, currentRole, detailData);

        } catch (err) {
            console.error("Initialization Failed:", err);
            loadingEl.innerHTML = `<div class="text-center p-10 bg-red-950/10 border border-red-900/30 rounded-3xl"><p class="text-red-500 font-extrabold uppercase tracking-[0.2em] mb-3 text-xs">Access Fault</p><p class="text-gray-500 text-[10px] leading-relaxed mb-6">${err.message}</p></div>`;
        } finally {
            if (!loadingEl.querySelector('.text-red-500')) {
                clearTimeout(loadTimeout);
                loadingEl.classList.add('hidden');
                const activitySec = document.getElementById('activity-section');
                if (activitySec) {
                    activitySec.classList.remove('opacity-0', 'translate-y-4');
                }
            }
        }
    }

    function renderNGO(data, email) {
        const viewNgo = document.getElementById('view-ngo');
        if (viewNgo) viewNgo.classList.remove('hidden');
        safeSetText('ngo-display-name', data.org_name || 'Org Name');
        safeSetHTML('ngo-display-email', `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> ${email}`);
        safeSetText('ngo-display-category', data.category || 'General');
        safeSetHTML('ngo-display-est', `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Est. ${data.est_year || 'Not set'}`);
        safeSetText('ngo-display-mission', data.mission_statement || 'No mission statement provided.');

        const locSpan = document.getElementById('ngo-display-location')?.querySelector('span');
        if (locSpan) locSpan.textContent = data.location_name || 'Location not set';

        const websiteEl = document.getElementById('ngo-display-website');
        if (data.website) {
            websiteEl.href = data.website.startsWith('http') ? data.website : `https://${data.website}`;
            websiteEl.querySelector('span').textContent = data.website;
        } else {
            websiteEl.classList.add('opacity-40', 'pointer-events-none');
            websiteEl.querySelector('span').textContent = 'No website';
        }

        const focus = document.getElementById('ngo-display-focus');
        focus.innerHTML = (data.focus_areas || ['General']).map(a => `<span class="tag tag-blue">${escapeHtml(a)}</span>`).join('');
    }

    function renderVolunteer(data, email) {
        const viewVol = document.getElementById('view-volunteer');
        if (viewVol) viewVol.classList.remove('hidden');
        safeSetText('vol-display-name', data.full_name || 'Volunteer');
        safeSetHTML('vol-display-email', `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> ${email}`);

        const volLocSpan = document.getElementById('vol-display-location')?.querySelector('span');
        if (volLocSpan) volLocSpan.textContent = data.location_name || 'Not set';

        const avail = data.availability || { weekdays: false, weekends: false };
        document.getElementById('vol-chk-weekdays').checked = !!avail.weekdays;
        document.getElementById('vol-chk-weekends').checked = !!avail.weekends;

        document.getElementById('vol-display-skills').innerHTML = (data.skills || ['Volunteer']).map(s => `<span class="tag tag-blue">${escapeHtml(s)}</span>`).join('');
        document.getElementById('vol-display-languages').innerHTML = (data.languages || ['English']).map(l => `<span class="tag tag-gray">${escapeHtml(l)}</span>`).join('');

        const vriScore = calculateVRI(data.tasks_completed || 0, data.total_hours || 0);
        const badge = getVRIBadge(vriScore);

        const nameContainer = document.getElementById('vol-display-name').parentElement;
        let badgeEl = document.getElementById('vri-badge');
        if (!badgeEl) {
            badgeEl = document.createElement('div');
            badgeEl.id = 'vri-badge';
            nameContainer.appendChild(badgeEl);
        }

        badgeEl.className = "mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest cursor-help transition-all hover:scale-105";
        badgeEl.style.borderColor = `${badge.color}44`;
        badgeEl.style.backgroundColor = `${badge.color}11`;
        badgeEl.style.color = badge.color;
        badgeEl.title = `Reliability Index: ${vriScore} points`;
        badgeEl.innerHTML = `${badge.emoji} ${badge.label} Member`;
    }

    function calculateVRI(tasksCompleted, totalHours) {
        return (tasksCompleted * 10) + (totalHours * 2);
    }

    function getVRIBadge(score) {
        if (score < 50) return { label: 'Silver', color: '#C0C0C0', emoji: '🥈' };
        if (score < 150) return { label: 'Gold', color: '#FFD700', emoji: '🥇' };
        return { label: 'Platinum', color: '#E5E4E2', emoji: '💎' };
    }

    async function loadStats(role, data, userId) {
        if (role === 'NGO') {
            document.getElementById('stat-1-label').textContent = 'Active Needs';
            document.getElementById('stat-2-label').textContent = 'Submissions';
            document.getElementById('stat-3-label').textContent = 'Avg matches';
        } else {
            safeSetText('stat-1-val', data?.tasks_completed || 0);
            safeSetText('stat-1-desc', '+0 this month');
            safeSetText('stat-2-val', data?.total_hours || 0);
            safeSetText('stat-3-val', data?.impact_score || 0);
        }
    }

    async function loadRecentActivity(userId) {
        const list = document.getElementById('activity-list');
        if (!list) return;

        const { data: tasks } = await supabase.from('surveys').select('needs, created_at').eq('committed_by', userId).limit(3);

        const mockActivities = [
            { title: 'Water Distribution', date: '2 days ago' },
            { title: 'Education Support', date: '1 week ago' },
            { title: 'Healthcare Assistance', date: '2 weeks ago' }
        ];

        const displayItems = (tasks && tasks.length > 0)
            ? tasks.map(t => ({ title: t.needs.length > 30 ? t.needs.substring(0, 30) + '...' : t.needs, date: new Date(t.created_at).toLocaleDateString() }))
            : mockActivities;

        list.innerHTML = displayItems.map(item => `
            <div class="px-8 py-6 flex items-center justify-between group hover:bg-white/5 transition-all">
                <div class="space-y-1">
                    <h4 class="text-sm font-bold text-gray-200 group-hover:text-white transition-colors capitalize">${escapeHtml(item.title)}</h4>
                    <p class="text-[10px] text-gray-600 font-medium uppercase tracking-wider">${escapeHtml(item.date)}</p>
                </div>
                <span class="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[9px] font-bold uppercase tracking-widest">
                    Completed
                </span>
            </div>
        `).join('');
    }

    function setupListeners(user, currentRole, detailData) {
        const editBtn = document.getElementById('edit-profile-btn');
        const cancelBtn = document.getElementById('cancel-edit-btn');
        const editFormContainer = document.getElementById('edit-form-container');
        const form = document.getElementById('profile-edit-form');

        if (editBtn) {
            editBtn.onclick = () => {
                if (document.getElementById('view-ngo')) document.getElementById('view-ngo').classList.add('hidden');
                if (document.getElementById('view-volunteer')) document.getElementById('view-volunteer').classList.add('hidden');
                if (editFormContainer) editFormContainer.classList.remove('hidden');
                if (editBtn) editBtn.classList.add('hidden');
                
                const mount = document.getElementById('edit-fields-mount');
                mount.innerHTML = '';
                
                const fields = currentRole === 'NGO' ? [
                    { id: 'org_name', label: 'Org Name', type: 'text', val: detailData?.org_name, disabled: true },
                    { id: 'category', label: 'Category', type: 'text', val: detailData?.category, disabled: true },
                    { id: 'est_year', label: 'Established Year', type: 'number', val: detailData?.est_year },
                    { id: 'contact_name', label: 'Contact Person Name', type: 'text', val: detailData?.contact_name },
                    { id: 'contact_role', label: 'Contact Role', type: 'text', val: detailData?.contact_role },
                    { id: 'location_name', label: 'Location (e.g. Pune, India)', type: 'text', val: detailData?.location_name },
                    { id: 'website', label: 'Website URL', type: 'text', val: detailData?.website },
                    { id: 'focus_areas', label: 'Focus Areas (Comma Separated)', type: 'text', val: detailData?.focus_areas?.join(', ') },
                    { id: 'mission_statement', label: 'Mission Statement', type: 'textarea', val: detailData?.mission_statement }
                ] : [
                    { id: 'full_name', label: 'Full Name', type: 'text', val: detailData?.full_name },
                    { id: 'phone', label: 'Phone Number', type: 'text', val: detailData?.phone },
                    { id: 'location_name', label: 'Primary Location', type: 'text', val: detailData?.location_name },
                    { id: 'skills', label: 'Skills (Comma Separated)', type: 'text', val: detailData?.skills?.join(', ') },
                    { id: 'languages', label: 'Languages Spoken', type: 'text', val: detailData?.languages?.join(', ') },
                    { id: 'avail-weekdays', label: 'Available Weekdays', type: 'checkbox', val: detailData?.availability?.weekdays },
                    { id: 'avail-weekends', label: 'Available Weekends', type: 'checkbox', val: detailData?.availability?.weekends }
                ];

                fields.forEach(f => {
                    const div = document.createElement('div');
                    div.className = 'flex flex-col gap-1' + (f.disabled ? ' opacity-60' : '');
                    if (f.type === 'checkbox') {
                        div.className = 'flex items-center gap-3 mt-4';
                        div.innerHTML = `<input type="checkbox" id="edit-${f.id}" ${f.val ? 'checked' : ''} class="w-5 h-5 bg-gray-900 border border-gray-700 rounded text-blue-500"><label class="text-sm text-gray-300">${f.label}</label>`;
                    } else if (f.type === 'textarea') {
                        div.className = 'flex flex-col gap-1 md:col-span-2';
                        div.innerHTML = `<label class="text-xs uppercase font-bold text-gray-500 mb-1">${f.label}</label><textarea id="edit-${f.id}" rows="4" class="bg-black/40 border border-gray-800 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition-all">${f.val || ''}</textarea>`;
                    } else {
                        const disabledAttr = f.disabled ? 'disabled' : '';
                        div.innerHTML = `<label class="text-xs uppercase font-bold text-gray-500 mb-1">${f.label}</label><input type="text" id="edit-${f.id}" value="${f.val || ''}" ${disabledAttr} class="bg-black/40 border border-gray-800 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition-all ${f.disabled ? 'cursor-not-allowed border-gray-900' : ''}">`;
                    }
                    mount.appendChild(div);
                });
            };
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                if (editFormContainer) editFormContainer.classList.add('hidden');
                if (editBtn) editBtn.classList.remove('hidden');
                if (currentRole === 'NGO') document.getElementById('view-ngo').classList.remove('hidden');
                else document.getElementById('view-volunteer').classList.remove('hidden');
            };
        }

        if (form) {
          form.onsubmit = async (e) => {
            e.preventDefault();
            const saveBtn = document.getElementById('save-profile-btn');
            const tableName = currentRole === 'NGO' ? 'ngo_details' : 'volunteer_details';
            let updates = { user_id: user.id };
            
            setLoadingState(saveBtn, true, 'Save Changes');

            try {
                if (currentRole === 'Volunteer') {
                    updates.full_name = document.getElementById('edit-full_name').value.trim();
                    if (!updates.full_name) throw new Error("Full Name is required.");
                    
                    updates.phone = document.getElementById('edit-phone').value;
                    updates.location_name = document.getElementById('edit-location_name').value;
                    const skills = document.getElementById('edit-skills').value.split(',').map(s => s.trim()).filter(s => s);
                    updates.skills = skills;
                    updates.languages = document.getElementById('edit-languages').value.split(',').map(s => s.trim()).filter(s => s);
                    updates.availability = { weekdays: document.getElementById('edit-avail-weekdays').checked, weekends: document.getElementById('edit-avail-weekends').checked };
                    
                    if (skills.length > 0) {
                        try {
                            const embedding = await window.getEmbedding(skills.join(', '));
                            updates.skills_embedding = embedding;
                        } catch (e) {
                            console.warn('AI Skills Embedding failed:', e);
                        }
                    }
                }
                if (currentRole === 'NGO') {
                    // Organization Name is now fixed and cannot be changed from the profile
                    updates.org_name = document.getElementById('edit-org_name').value;
                    updates.est_year = parseInt(document.getElementById('edit-est_year').value) || null;
                    updates.contact_name = document.getElementById('edit-contact_name').value;
                    updates.contact_role = document.getElementById('edit-contact_role').value;
                    updates.location_name = document.getElementById('edit-location_name').value;
                    updates.website = document.getElementById('edit-website').value;
                    updates.focus_areas = document.getElementById('edit-focus_areas').value.split(',').map(s => s.trim()).filter(s => s);
                    updates.mission_statement = document.getElementById('edit-mission_statement').value;
                }

                const { error } = await supabase.from(tableName).upsert(updates, { onConflict: 'user_id' });
                if (error) throw error;
                
                showToast('Profile updated successfully! Refreshing...');
                setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
                showToast(err.message, true);
                setLoadingState(saveBtn, false, 'Save Changes');
            }
          };
        }
    }
    init();
});
