/* ============================================================
   SmartAllocation — Chat Widget (chat.js)
   Per-task messaging between NGO and committed volunteer.
   FIX 8: Unread message badge tracking via localStorage.
   ============================================================ */

(function() {
  let chatSurveyId = null;
  let chatSupabase = null;
  let chatUserId = null;
  let chatChannel = null;

  function getChatSupabase() {
    if (!chatSupabase && typeof CONFIG !== 'undefined' && window.supabase) {
      chatSupabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return chatSupabase;
  }

  // FIX 8: Get last-read timestamp for a survey
  function getLastRead(surveyId) {
    return localStorage.getItem(`last_read_${surveyId}`) || '1970-01-01T00:00:00Z';
  }

  // FIX 8: Mark messages as read for a survey
  function markAsRead(surveyId) {
    localStorage.setItem(`last_read_${surveyId}`, new Date().toISOString());
    // Remove badge from the chat button for this survey
    const btn = document.querySelector(`[data-chat-survey="${surveyId}"]`);
    if (btn) {
      const dot = btn.querySelector('.unread-dot');
      if (dot) dot.remove();
    }
  }

  // FIX 8: Check unread count for a specific survey
  window.checkUnreadMessages = async function(surveyId) {
    const sb = getChatSupabase();
    if (!sb) return 0;
    const lastRead = getLastRead(surveyId);
    const { count, error } = await sb
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('survey_id', surveyId)
      .gt('created_at', lastRead);
    if (error) return 0;
    return count || 0;
  };

  // FIX 8: Load unread badges for all surveys on page
  window.loadUnreadBadges = async function() {
    const chatBtns = document.querySelectorAll('[data-chat-survey]');
    for (const btn of chatBtns) {
      const surveyId = btn.getAttribute('data-chat-survey');
      if (!surveyId) continue;
      const sb = getChatSupabase();
      if (!sb) continue;
      const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!user) continue;
      const lastRead = getLastRead(surveyId);
      const { data } = await sb
        .from('messages')
        .select('id')
        .eq('survey_id', surveyId)
        .gt('created_at', lastRead)
        .neq('sender_id', user.id);
      if (data && data.length > 0) {
        if (!btn.querySelector('.unread-dot')) {
          const dot = document.createElement('span');
          dot.className = 'unread-dot';
          btn.appendChild(dot);
        }
      }
    }
  };

  window.openChat = async function(surveyId) {
    const panel = document.getElementById('chat-panel');
    if (!panel) return;

    const sb = getChatSupabase();
    if (!sb) return;

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    chatSurveyId = surveyId;
    chatUserId = user.id;

    panel.style.transform = 'translateX(0)';

    // FIX 8: Mark as read when chat is opened
    markAsRead(surveyId);

    await loadMessages();

    if (chatChannel) chatChannel.unsubscribe();
    chatChannel = sb.channel(`chat-${surveyId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `survey_id=eq.${surveyId}` },
        (payload) => {
          appendMessage(payload.new);
          scrollToBottom();
          // Auto-mark read since panel is open
          markAsRead(surveyId);
        }
      )
      .subscribe();
  };

  window.closeChatPanel = function() {
    const panel = document.getElementById('chat-panel');
    if (panel) panel.style.transform = 'translateX(100%)';
    if (chatChannel) { chatChannel.unsubscribe(); chatChannel = null; }
    chatSurveyId = null;
  };

  async function loadMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const sb = getChatSupabase();
    const { data: messages, error } = await sb
      .from('messages')
      .select('*')
      .eq('survey_id', chatSurveyId)
      .order('created_at', { ascending: true });

    if (error) {
      container.innerHTML = '<p class="text-red-400 text-xs text-center py-4">Failed to load messages.</p>';
      return;
    }

    if (!messages || messages.length === 0) {
      container.innerHTML = '<p class="text-gray-600 text-xs text-center py-8">No messages yet. Start the conversation!</p>';
      return;
    }

    container.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
  }

  function appendMessage(msg) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const emptyMsg = container.querySelector('.text-gray-600');
    if (emptyMsg) emptyMsg.remove();

    const isMine = msg.sender_id === chatUserId;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = `flex ${isMine ? 'justify-end' : 'justify-start'}`;
    div.innerHTML = `
      <div class="max-w-[80%] ${isMine ? 'bg-emerald-600/20 border-emerald-500/20' : 'bg-gray-800 border-gray-700'} border rounded-2xl ${isMine ? 'rounded-br-md' : 'rounded-bl-md'} px-4 py-2.5">
        <p class="text-sm text-white">${escapeHtml(msg.content)}</p>
        <p class="text-[9px] ${isMine ? 'text-emerald-500/60' : 'text-gray-600'} mt-1">${time}</p>
      </div>
    `;
    container.appendChild(div);
  }

  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }


  document.addEventListener('DOMContentLoaded', () => {
    const sendBtn = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');

    if (sendBtn) {
      const sendMessage = async () => {
        if (!chatSurveyId || !chatInput) return;
        const content = chatInput.value.trim();
        if (!content) return;

        const sb = getChatSupabase();
        if (!sb) return;

        chatInput.value = '';
        const { error } = await sb.from('messages').insert([{
          survey_id: chatSurveyId,
          sender_id: chatUserId,
          content
        }]);

        if (error) {
          console.error('Send message error:', error);
          chatInput.value = content;
        }
      };

      sendBtn.addEventListener('click', sendMessage);
      chatInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    }

    // FIX 8: Load unread badges after a short delay to let pages render
    setTimeout(() => window.loadUnreadBadges && window.loadUnreadBadges(), 1500);
  });
})();
