/* Mini App помощника. Два режима:
 *  - полный: в URL есть #api=<адрес API бота> — все разделы читают/пишут через API, подпись Telegram в заголовке;
 *  - только карточки: #d=<колода> (бот без туннеля) — тренажёр, итоги через sendData или /start-ссылку.
 */
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  var API = hashParams.get('api') ? decodeURIComponent(hashParams.get('api')).replace(/\/$/, '') : '';
  var BOT = hashParams.get('u') || '';
  var toastTimer = null;

  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2200);
  }
  function haptic(kind) { try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(kind); } catch (e) {} }
  function setHeader(title, sub, back) {
    $('title').textContent = title; $('sub').textContent = sub || '';
    $('back').style.display = back ? '' : 'none'; $('back').onclick = back || null;
  }
  function setFab(onClick) { $('fab').style.display = onClick ? '' : 'none'; $('fab').onclick = onClick || null; }
  function decodeB64Json(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // ───────── API ─────────
  async function api(method, path, body) {
    var res = await fetch(API + path, {
      method: method, headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': (tg && tg.initData) || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }
  async function guard(fn) { try { return await fn(); } catch (e) { toast('Ошибка: ' + e.message); throw e; } }

  // ───────── речь ─────────
  var speechLang = 'es-ES', voice = null;
  var langMap = { es: 'es-ES', en: 'en-US', it: 'it-IT', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', tr: 'tr-TR', kk: 'kk-KZ' };
  function setSpeechLang(code) { speechLang = langMap[code] || code || 'es-ES'; pickVoice(); }
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    var vs = speechSynthesis.getVoices();
    voice = vs.find(function (v) { return v.lang === speechLang; }) || vs.find(function (v) { return v.lang.slice(0, 2) === speechLang.slice(0, 2); }) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.lang = speechLang; if (voice) u.voice = voice; u.rate = 0.92; speechSynthesis.speak(u); } catch (e) {}
  }

  // ───────── тренажёр карточек (общий для обоих режимов) ─────────
  function runTrainer(cards, opts) {
    var i = 0, ok = 0, no = 0, results = [], flipped = false, flippedAt = 0;
    var main = $('main');
    setFab(null);
    main.innerHTML = '<div class="trainer"><div class="top"><span id="counter">0/0</span><div class="bar"><i id="bar"></i></div><span id="score">✅ 0 · ❌ 0</span></div><div class="stage" id="stage"></div><div class="tactions" id="tactions"></div><div class="hint" id="hint">Нажми на карточку, чтобы перевернуть. Свайп вправо — помню, влево — не помню.</div></div>';
    if (!cards.length) { $('stage').innerHTML = '<div class="empty">🎉 Все карточки повторены.<br>Новые появятся из уроков или по расписанию.</div>'; $('hint').textContent = ''; return; }

    function render() {
      $('counter').textContent = (i + 1) + '/' + cards.length;
      $('bar').style.width = Math.round((i / cards.length) * 100) + '%';
      $('score').textContent = '✅ ' + ok + ' · ❌ ' + no;
      var c = cards[i]; flipped = false;
      $('stage').innerHTML =
        '<div class="card" id="card">' +
          '<div class="face front"><span class="box">коробка ' + (c.x || 1) + '</span><button class="speak" id="spk" aria-label="Озвучить">🔊</button><div class="word">' + esc(c.f) + '</div><div class="small">нажми, чтобы увидеть перевод</div></div>' +
          '<div class="face back"><span class="box">коробка ' + (c.x || 1) + '</span><div class="word">' + esc(c.f) + '</div><div class="trans">' + esc(c.b) + '</div></div>' +
          '<div class="stamp ok" id="stOk">ПОМНЮ</div><div class="stamp no" id="stNo">НЕ ПОМНЮ</div>' +
        '</div>';
      $('tactions').innerHTML = '<button class="btn flip" id="flipBtn">Показать перевод</button>';
      var card = $('card');
      card.addEventListener('click', function (e) { if (e.target.id !== 'spk') flip(); });
      $('spk').addEventListener('click', function (e) { e.stopPropagation(); speak(c.f); });
      $('flipBtn').addEventListener('click', flip);
      attachSwipe(card);
    }
    function flip() {
      if (flipped) return;
      flipped = true; flippedAt = Date.now();
      $('card').classList.add('flipped');
      $('tactions').innerHTML = '';
      setTimeout(function () {
        if (!flipped) return;
        $('tactions').innerHTML = '<button class="btn no" id="noBtn">❌ Не помню</button><button class="btn ok" id="okBtn">✅ Помню</button>';
        $('noBtn').addEventListener('click', function () { answer(false); });
        $('okBtn').addEventListener('click', function () { answer(true); });
      }, 120);
      speak(cards[i].f);
    }
    function answer(remembered) {
      var card = $('card');
      if (!card || card.dataset.done) return;
      if (Date.now() - flippedAt < 350) return;
      card.dataset.done = '1';
      results.push({ i: cards[i].i, ok: remembered });
      if (remembered) ok++; else no++;
      haptic(remembered ? 'success' : 'warning');
      card.classList.add(remembered ? 'out-right' : 'out-left');
      setTimeout(function () { i++; if (i >= cards.length) finish(); else render(); }, 280);
    }
    function attachSwipe(card) {
      var startX = 0, dx = 0, dragging = false;
      card.addEventListener('pointerdown', function (e) { startX = e.clientX; dragging = true; card.style.transition = 'none'; card.setPointerCapture(e.pointerId); });
      card.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        dx = e.clientX - startX;
        card.style.transform = 'translateX(' + dx + 'px) rotate(' + dx / 18 + 'deg)';
        $('stOk').style.opacity = Math.min(1, Math.max(0, dx / 90)); $('stNo').style.opacity = Math.min(1, Math.max(0, -dx / 90));
      });
      function end() {
        if (!dragging) return;
        dragging = false; card.style.transition = '';
        if (Math.abs(dx) > 100) { if (!flipped) { flipped = true; flippedAt = 0; card.classList.add('flipped'); } answer(dx > 0); }
        else { card.style.transform = ''; $('stOk').style.opacity = 0; $('stNo').style.opacity = 0; }
        dx = 0;
      }
      card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
    }
    function finish() {
      $('bar').style.width = '100%'; $('counter').textContent = cards.length + '/' + cards.length;
      var missed = results.filter(function (r) { return !r.ok; }).map(function (r) { return cards.find(function (c) { return c.i === r.i; }); });
      $('stage').innerHTML = '<div class="done"><h2>Готово!</h2><div class="nums"><div>✅<b>' + ok + '</b>помню</div><div>❌<b>' + no + '</b>не помню</div></div>' +
        (missed.length ? '<div class="list">' + missed.map(function (c) { return '<div><span>' + esc(c.f) + '</span><span>' + esc(c.b) + '</span></div>'; }).join('') + '</div>' : '<div class="small">Все карточки на месте 🎉</div>') + '</div>';
      $('tactions').innerHTML = '';
      opts.onFinish(results, { ok: ok, no: no });
    }
    render();
  }

  // ───────── режим «только карточки» (без API) ─────────
  function cardsOnlyMode(deck) {
    setHeader('Карточки', deck.cards.length ? deck.cards.length + ' к повторению' : '');
    setSpeechLang(deck.lang);
    runTrainer(deck.cards, {
      onFinish: function (results) {
        var inTelegram = tg && tg.initData;
        $('hint').textContent = inTelegram ? 'Нажми кнопку внизу, чтобы бот записал результат.' : 'Открыто вне Telegram — результаты не отправляются.';
        if (!(tg && tg.MainButton)) return;
        tg.MainButton.setText('Отправить боту'); tg.MainButton.show();
        tg.MainButton.onClick(function () {
          try {
            if (deck.m && deck.d && deck.u) {
              tg.openTelegramLink('https://t.me/' + deck.u + '?start=' + startPayload(deck, results));
              setTimeout(function () { tg.close(); }, 300);
            } else tg.sendData(JSON.stringify({ type: 'cards', results: results }));
          } catch (e) { $('hint').textContent = 'Не удалось отправить: ' + e; }
        });
      },
    });
    if (!deck.cards.length && tg && tg.MainButton) { tg.MainButton.setText('Закрыть'); tg.MainButton.show(); tg.MainButton.onClick(function () { tg.close(); }); }
  }
  function startPayload(deck, results) {
    var cards = deck.cards, n = cards.length, answered = new Uint8Array(Math.ceil(n / 8)), okMask = new Uint8Array(Math.ceil(n / 8));
    cards.forEach(function (c, idx) {
      var r = results.find(function (x) { return x.i === c.i; }); if (!r) return;
      answered[idx >> 3] |= 1 << (idx & 7); if (r.ok) okMask[idx >> 3] |= 1 << (idx & 7);
    });
    var b64 = function (u8) { var s = ''; for (var k = 0; k < u8.length; k++) s += String.fromCharCode(u8[k]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    return 'cr_' + deck.d.toString(36) + '_' + b64(answered) + '_' + b64(okMask);
  }

  // ───────── полный режим ─────────
  var state = { tab: 'today', me: null };
  var views = {};

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tg && tg.MainButton) tg.MainButton.hide();
    views[tab]();
  }
  document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  function form(fields, submitLabel, onSubmit, onCancel) {
    var main = $('main');
    main.innerHTML = '<div class="section">' + fields.map(function (f) {
      if (f.type === 'textarea') return '<label>' + esc(f.label) + '</label><textarea id="f_' + f.id + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>';
      if (f.type === 'select') return '<label>' + esc(f.label) + '</label><select id="f_' + f.id + '">' + f.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === f.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
      return '<label>' + esc(f.label) + '</label><input id="f_' + f.id + '" type="' + (f.type || 'text') + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '">';
    }).join('') + '<div class="actions"><button class="btn ghost" id="f_cancel">Отмена</button><button class="btn" id="f_ok">' + esc(submitLabel) + '</button></div></div>';
    $('f_cancel').onclick = onCancel;
    $('f_ok').onclick = function () {
      var vals = {}; fields.forEach(function (f) { vals[f.id] = $('f_' + f.id).value.trim(); });
      $('f_ok').disabled = true;
      Promise.resolve(onSubmit(vals)).catch(function () { $('f_ok').disabled = false; });
    };
    setFab(null);
  }

  // Сегодня
  var dayOffset = 0;
  views.today = async function () {
    setHeader('Сегодня', state.me ? state.me.now.split(',')[0] : '');
    setFab(function () { addReminderForm(function () { showTab('today'); }); });
    var a = await guard(function () { return api('GET', '/api/agenda?offset=' + dayOffset); });
    var html = '<div class="daynav"><button id="prev">←</button><b>' + esc(a.title) + ', ' + esc(a.date) + '</b><button id="next">→</button></div>';
    html += '<div class="section"><h3>Напоминания</h3>' + (a.reminders.length ? a.reminders.map(function (r) { return '<div class="row"><div class="grow"><div class="title">⏰ ' + esc(r.time) + ' — ' + esc(r.text) + '</div>' + (r.repeat ? '<div class="meta">🔁 ' + esc(r.repeat) + '</div>' : '') + '</div></div>'; }).join('') : '<div class="meta">Нет напоминаний</div>') + '</div>';
    html += '<div class="section"><h3>Задачи со сроком</h3>' + (a.due.length ? a.due.map(taskRow).join('') : '<div class="meta">Нет задач на этот день</div>') + '</div>';
    if (a.overdue.length) html += '<div class="section"><h3>Просрочено</h3>' + a.overdue.map(taskRow).join('') + '</div>';
    $('main').innerHTML = html;
    $('prev').onclick = function () { dayOffset--; views.today(); };
    $('next').onclick = function () { dayOffset++; views.today(); };
    bindTaskToggles(function () { views.today(); });
  };
  function taskRow(t) {
    return '<div class="row' + (t.done ? ' done' : '') + '"><button class="chk' + (t.done ? ' on' : '') + '" data-toggle="' + t.id + '" data-done="' + (t.done ? 1 : 0) + '">' + (t.done ? '✓' : '') + '</button><div class="grow" data-open="' + t.id + '"><div class="title">' + esc(t.title) + '</div><div class="meta">' + (t.children ? '<span class="pill">' + t.childrenDone + '/' + t.children + '</span>' : '') + (t.dueHuman ? '<span class="pill' + (t.overdue ? ' warn' : '') + '">' + (t.overdue ? '⚠️ ' : 'до ') + esc(t.dueHuman) + '</span>' : '') + '</div></div></div>';
  }
  function bindTaskToggles(refresh) {
    document.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.onclick = async function (e) {
        e.stopPropagation();
        var done = b.dataset.done !== '1';
        await guard(function () { return api('PATCH', '/api/tasks/' + b.dataset.toggle, { done: done }); });
        haptic(done ? 'success' : 'warning'); refresh();
      };
    });
  }

  // Заметки
  var notesQuery = '';
  views.notes = async function () {
    setHeader('Заметки', '');
    setFab(function () { noteForm(null); });
    var data = await guard(function () { return api('GET', '/api/notes?limit=50' + (notesQuery ? '&q=' + encodeURIComponent(notesQuery) : '')); });
    $('sub').textContent = data.total + ' всего';
    var html = '<input class="search" id="q" placeholder="Поиск по заметкам" value="' + esc(notesQuery) + '">';
    html += data.notes.length ? '<div class="section">' + data.notes.map(function (n) { return '<div class="row" data-note="' + n.id + '"><div class="grow"><div class="title">' + (n.hasPhoto ? '🖼 ' : '') + esc(n.text.length > 120 ? n.text.slice(0, 120) + '…' : n.text) + '</div><div class="meta">' + n.tags.map(function (t) { return '<span class="pill">#' + esc(t) + '</span>'; }).join('') + esc(n.created) + '</div></div></div>'; }).join('') + '</div>' : '<div class="empty">' + (notesQuery ? 'Ничего не нашлось' : 'Заметок пока нет — нажми +') + '</div>';
    $('main').innerHTML = html;
    var q = $('q'); var t = null;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { notesQuery = q.value.trim(); views.notes(); }, 350); };
    document.querySelectorAll('[data-note]').forEach(function (row) {
      row.onclick = function () { var n = data.notes.find(function (x) { return String(x.id) === row.dataset.note; }); noteForm(n); };
    });
  };
  function noteForm(note) {
    setHeader(note ? 'Заметка №' + note.id : 'Новая заметка', note ? note.created : '', function () { views.notes(); });
    form([
      { id: 'text', label: 'Текст', type: 'textarea', value: note ? note.text : '', placeholder: 'Что записать?' },
      { id: 'tags', label: 'Теги через запятую', value: note ? note.tags.join(', ') : '' },
    ], note ? 'Сохранить' : 'Добавить', async function (v) {
      if (!v.text) { toast('Текст пустой'); throw new Error('empty'); }
      await guard(function () { return note ? api('PATCH', '/api/notes/' + note.id, { text: v.text, tags: v.tags }) : api('POST', '/api/notes', { text: v.text, tags: v.tags }); });
      haptic('success'); views.notes();
    }, function () { views.notes(); });
    if (note) {
      var del = document.createElement('button'); del.className = 'btn no'; del.style.marginTop = '10px'; del.textContent = '🗑 Удалить заметку';
      del.onclick = async function () { if (!confirm('Удалить заметку?')) return; await guard(function () { return api('DELETE', '/api/notes/' + note.id); }); views.notes(); };
      $('main').appendChild(del);
    }
  }

  // Задачи
  var taskParent = null, showDone = false;
  views.tasks = async function () {
    var data = await guard(function () { return api('GET', '/api/tasks' + (showDone ? '?done=1' : '')); });
    var all = data.tasks;
    var parent = taskParent ? all.find(function (t) { return t.id === taskParent; }) : null;
    if (taskParent && !parent) taskParent = null;
    var list = all.filter(function (t) { return (t.parentId || null) === (taskParent || null); });
    setHeader(parent ? parent.title : 'Задачи', parent ? (parent.dueHuman ? 'до ' + parent.dueHuman : '') : list.filter(function (t) { return !t.done; }).length + ' открытых', parent ? function () { taskParent = parent.parentId || null; views.tasks(); } : null);
    setFab(function () { taskForm(null, taskParent); });
    var html = '';
    if (parent && parent.notes) html += '<div class="section"><div class="meta">' + esc(parent.notes) + '</div></div>';
    html += list.length ? '<div class="section">' + list.map(taskRow).join('') + '</div>' : '<div class="empty">' + (parent ? 'Подзадач нет' : 'Открытых задач нет — нажми +') + '</div>';
    html += '<div class="actions"><button class="btn ghost sm" id="toggleDone">' + (showDone ? 'Скрыть выполненные' : 'Показать выполненные') + '</button>' + (parent ? '<button class="btn ghost sm" id="editParent">✏️ Изменить</button>' : '') + '</div>';
    $('main').innerHTML = html;
    $('toggleDone').onclick = function () { showDone = !showDone; views.tasks(); };
    if (parent) $('editParent').onclick = function () { taskForm(parent, parent.parentId); };
    bindTaskToggles(function () { views.tasks(); });
    document.querySelectorAll('[data-open]').forEach(function (el) {
      el.onclick = function () { var t = all.find(function (x) { return String(x.id) === el.dataset.open; }); if (t.children) { taskParent = t.id; views.tasks(); } else taskForm(t, t.parentId); };
    });
  };
  function taskForm(task, parentId) {
    setHeader(task ? 'Задача' : (parentId ? 'Новая подзадача' : 'Новая задача'), '', function () { views.tasks(); });
    var fields = [
      { id: 'title', label: 'Название', value: task ? task.title : '', placeholder: 'Купить билеты' },
      { id: 'due', label: 'Срок (необязательно)', type: 'date', value: task && task.due ? task.due.slice(0, 10) : '' },
      { id: 'notes', label: 'Детали', type: 'textarea', value: task ? task.notes || '' : '' },
    ];
    if (!task) fields.push({ id: 'subtasks', label: 'Подзадачи, каждая с новой строки (необязательно)', type: 'textarea', value: '' });
    form(fields, task ? 'Сохранить' : 'Добавить', async function (v) {
      if (!v.title) { toast('Название пустое'); throw new Error('empty'); }
      await guard(function () {
        return task
          ? api('PATCH', '/api/tasks/' + task.id, { title: v.title, due: v.due, notes: v.notes })
          : api('POST', '/api/tasks', { title: v.title, due: v.due, notes: v.notes, parentId: parentId || undefined, subtasks: v.subtasks.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) });
      });
      haptic('success'); views.tasks();
    }, function () { views.tasks(); });
    if (task) {
      var del = document.createElement('button'); del.className = 'btn no'; del.style.marginTop = '10px'; del.textContent = '🗑 Удалить задачу' + (task.children ? ' с подзадачами' : '');
      del.onclick = async function () { if (!confirm('Удалить задачу?')) return; await guard(function () { return api('DELETE', '/api/tasks/' + task.id); }); taskParent = task.parentId || null; views.tasks(); };
      $('main').appendChild(del);
    }
  }

  // Напоминания
  views.reminders = async function () {
    setHeader('Напоминания', '');
    setFab(function () { addReminderForm(function () { views.reminders(); }); });
    var data = await guard(function () { return api('GET', '/api/reminders'); });
    $('sub').textContent = data.reminders.length + ' активных';
    $('main').innerHTML = data.reminders.length ? '<div class="section">' + data.reminders.map(function (r) {
      return '<div class="row"><div class="grow"><div class="title">⏰ ' + esc(r.text) + '</div><div class="meta">' + esc(r.when) + (r.repeatHuman ? ' · 🔁 ' + esc(r.repeatHuman) : '') + '</div><div class="actions" style="margin-top:6px"><button class="btn ghost sm" data-snooze="' + r.id + '">+1 час</button><button class="btn ghost sm" data-tomorrow="' + r.id + '">Завтра</button><button class="btn ghost sm" data-del="' + r.id + '">✖</button></div></div></div>';
    }).join('') + '</div>' : '<div class="empty">Напоминаний нет — нажми +</div>';
    document.querySelectorAll('[data-snooze]').forEach(function (b) { b.onclick = async function () { await guard(function () { return api('PATCH', '/api/reminders/' + b.dataset.snooze, { snoozeMinutes: 60 }); }); toast('Отложено на час'); views.reminders(); }; });
    document.querySelectorAll('[data-tomorrow]').forEach(function (b) { b.onclick = async function () { await guard(function () { return api('PATCH', '/api/reminders/' + b.dataset.tomorrow, { tomorrow: true }); }); toast('Перенесено на завтра'); views.reminders(); }; });
    document.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { if (!confirm('Отменить напоминание?')) return; await guard(function () { return api('DELETE', '/api/reminders/' + b.dataset.del); }); views.reminders(); }; });
  };
  function addReminderForm(back) {
    setHeader('Новое напоминание', '', back);
    var d = new Date(Date.now() + 3600000); d.setSeconds(0, 0);
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    form([
      { id: 'text', label: 'О чём напомнить', value: '', placeholder: 'Позвонить маме' },
      { id: 'at', label: 'Когда', type: 'datetime-local', value: local },
      { id: 'repeat', label: 'Повтор', type: 'select', value: 'none', options: [
        { value: 'none', label: 'Один раз' }, { value: 'daily', label: 'Каждый день' }, { value: 'weekdays', label: 'По будням' }, { value: 'weekends', label: 'По выходным' }, { value: 'weekly', label: 'Раз в неделю' }, { value: 'monthly', label: 'Раз в месяц' },
      ] },
    ], 'Поставить', async function (v) {
      if (!v.text) { toast('Текст пустой'); throw new Error('empty'); }
      var r = await guard(function () { return api('POST', '/api/reminders', { text: v.text, at: v.at, repeat: v.repeat }); });
      haptic('success'); toast('Напомню ' + r.when); back();
    }, back);
  }

  // Язык
  views.learn = async function () {
    setHeader('Язык', '');
    setFab(null);
    var L = await guard(function () { return api('GET', '/api/learn'); });
    setSpeechLang(L.settings.lang);
    var langTitle = L.settings.langName.charAt(0).toUpperCase() + L.settings.langName.slice(1);
    $('sub').textContent = langTitle + ' · ' + L.settings.level + (L.session ? ' · идёт ' + (L.session === 'talk' ? 'разговор' : L.session === 'lesson' ? 'урок' : L.session) + ' в чате' : '');
    var html = '<div class="stats"><div class="stat"><b>🔥 ' + L.progress.streak + '</b><span>дней подряд</span></div><div class="stat"><b>' + L.progress.lessonsTotal + '</b><span>уроков</span></div><div class="stat"><b>' + L.cards.due + '</b><span>к повторению</span></div></div>';
    html += '<div class="grid2" style="margin-top:12px">' +
      '<button class="tile" id="lesson"><b>📖 Урок дня</b><span>15 минут в чате, с озвучкой</span></button>' +
      '<button class="tile" id="cards"><b>🃏 Карточки' + (L.cards.due ? ' (' + L.cards.due + ')' : '') + '</b><span>свайпы и озвучка</span></button>' +
      '<button class="tile" id="talk"><b>🗣 Разговор</b><span>с носителем, в чате</span></button>' +
      '<button class="tile" id="talkReview"><b>🗣 Слова в деле</b><span>повторить ' + Math.min(6, L.cards.due) + ' слов в диалоге</span></button>' +
      '<button class="tile" id="gen"><b>➕ Карточки</b><span>сгенерировать по теме</span></button>' +
      '<button class="tile" id="allCards"><b>📚 Колода</b><span>' + L.cards.total + ' карточек</span></button>' +
      '<button class="tile" id="stats"><b>📊 Статистика</b><span>темы и коробки</span></button>' +
      '<button class="tile" id="settings"><b>⚙️ Настройки</b><span>уровень, фокус, язык</span></button>' +
    '</div>';
    if (L.session) html += '<button class="btn ghost" style="margin-top:12px" id="stop">✖ Остановить ' + (L.session === 'talk' ? 'разговор' : 'урок') + ' в чате</button>';
    $('main').innerHTML = html;

    $('lesson').onclick = function () { pickTopic('Тема урока', L.topics, function (topicId) { startInChat('/api/learn/lesson', { topic: topicId }, 'Урок запускается в чате'); }, true); };
    $('talk').onclick = function () { pickTopic('О чём поговорим?', L.topics, function (topicId, title) { startInChat('/api/learn/talk', { topic: title }, 'Разговор начинается в чате'); }, false, true); };
    $('talkReview').onclick = function () { if (!L.cards.due) return toast('Нечего повторять'); startInChat('/api/learn/talk', { topic: 'повторяем слова в деле', review: true }, 'Разговор начинается в чате'); };
    $('cards').onclick = function () {
      setHeader('Карточки', L.cards.due + ' к повторению', function () { views.learn(); });
      runTrainer(L.cards.dueList.map(function (c) { return { i: c.id, f: c.front, b: c.back, x: c.box }; }), {
        onFinish: async function (results) {
          var r = await guard(function () { return api('POST', '/api/learn/review', { results: results.map(function (x) { return { id: x.i, ok: x.ok }; }) }); });
          $('hint').textContent = 'Записано: помню ' + r.known + ', не помню ' + r.unknown + (r.due ? '. Ещё к повторению: ' + r.due : '. На сегодня всё.');
          haptic('success');
          var b = document.createElement('button'); b.className = 'btn'; b.textContent = '← К разделу'; b.onclick = function () { views.learn(); }; $('tactions').appendChild(b);
        },
      });
    };
    $('gen').onclick = function () {
      setHeader('Сгенерировать карточки', '', function () { views.learn(); });
      form([{ id: 'topic', label: 'Тема', value: '', placeholder: 'еда в ресторане' }, { id: 'count', label: 'Сколько (3–40)', type: 'number', value: '15' }], 'Сгенерировать', async function (v) {
        if (!v.topic) { toast('Тема пустая'); throw new Error('empty'); }
        toast('Подбираю слова…');
        var r = await guard(function () { return api('POST', '/api/learn/generate', { topic: v.topic, count: Number(v.count) || 15 }); });
        $('main').innerHTML = '<div class="section"><h3>Добавлено ' + r.added + (r.duplicates ? ' (' + r.duplicates + ' уже были)' : '') + '</h3>' + r.sample.map(function (c) { return '<div class="row"><div class="grow"><div class="title">' + esc(c.front) + '</div><div class="meta">' + esc(c.back) + '</div></div></div>'; }).join('') + '</div><button class="btn" id="toCards">🃏 Повторить сейчас</button><button class="btn ghost" style="margin-top:10px" id="backL">← К разделу</button>';
        $('toCards').onclick = function () { views.learn().then(function () { $('cards').click(); }); };
        $('backL').onclick = function () { views.learn(); };
      }, function () { views.learn(); });
    };
    $('allCards').onclick = async function () {
      setHeader('Колода', L.cards.total + ' карточек', function () { views.learn(); });
      var d = await guard(function () { return api('GET', '/api/learn/cards'); });
      $('main').innerHTML = (d.cards.length ? '<div class="section">' + d.cards.map(function (c) { return '<div class="row"><div class="grow"><div class="title">' + esc(c.front) + ' — ' + esc(c.back) + '</div><div class="meta">коробка ' + c.box + ' · повтор ' + esc(c.due) + '</div></div><button class="btn ghost sm" data-say="' + esc(c.front) + '">🔊</button><button class="btn ghost sm" data-delc="' + c.id + '">✖</button></div>'; }).join('') + '</div>' : '<div class="empty">Колода пуста</div>') + '<button class="btn ghost" id="addCard">+ Добавить карточку</button>';
      document.querySelectorAll('[data-say]').forEach(function (b) { b.onclick = function () { speak(b.dataset.say); }; });
      document.querySelectorAll('[data-delc]').forEach(function (b) { b.onclick = async function () { await guard(function () { return api('DELETE', '/api/learn/cards/' + b.dataset.delc); }); $('allCards').click && views.learn().then(function () { $('allCards').click(); }); }; });
      $('addCard').onclick = function () {
        setHeader('Новая карточка', '', function () { views.learn(); });
        form([{ id: 'front', label: 'Слово на изучаемом языке', value: '' }, { id: 'back', label: 'Перевод', value: '' }], 'Добавить', async function (v) {
          if (!v.front || !v.back) { toast('Заполни оба поля'); throw new Error('empty'); }
          var r = await guard(function () { return api('POST', '/api/learn/cards', { front: v.front, back: v.back }); });
          toast(r.created ? 'Добавлено' : 'Такая уже есть'); views.learn().then(function () { $('allCards').click(); });
        }, function () { views.learn(); });
      };
    };
    $('stats').onclick = function () {
      setHeader('Статистика', '', function () { views.learn(); });
      var topics = L.topics.map(function (t) { return '<div><span>' + esc(t.title) + '</span><b>' + (L.progress.topicCounts[t.id] || 0) + '</b></div>'; }).join('');
      var boxes = L.cards.byBox.map(function (n, i) { return '<div class="stat"><b>' + n + '</b><span>кор. ' + (i + 1) + '</span></div>'; }).join('');
      var hist = L.progress.history.map(function (h) { var t = L.topics.find(function (x) { return x.id === h.topic; }); return '<div><span>' + esc(h.date) + ' · ' + esc(t ? t.title : h.topic) + '</span><b>' + h.score + '/' + h.total + '</b></div>'; }).join('');
      $('main').innerHTML = '<div class="section"><h3>Темы (уроков)</h3><div class="hist">' + topics + '</div></div><div class="section"><h3>Карточки по коробкам</h3><div class="stats">' + boxes + '</div></div>' + (hist ? '<div class="section"><h3>Последние уроки</h3><div class="hist">' + hist + '</div></div>' : '');
    };
    $('settings').onclick = function () {
      setHeader('Настройки обучения', '', function () { views.learn(); });
      var s = L.settings;
      var focusLabel = { grammar: 'грамматика', conversation: 'разговор', listening: 'аудирование' };
      $('main').innerHTML = '<div class="section"><h3>Уровень</h3><div class="chips">' + L.levels.map(function (l) { return '<button class="chip' + (l === s.level ? ' on' : '') + '" data-level="' + l + '">' + l + '</button>'; }).join('') + '</div></div>' +
        '<div class="section"><h3>Фокус урока</h3><div class="chips">' + L.focusAll.map(function (f) { return '<button class="chip' + (s.focus.indexOf(f) >= 0 ? ' on' : '') + '" data-focus="' + f + '">' + focusLabel[f] + '</button>'; }).join('') + '</div></div>' +
        '<div class="section"><h3>Язык</h3><label>Код для озвучки (es, en, it, fr, de, pt)</label><input id="lang" value="' + esc(s.lang) + '"><label>Название по-русски</label><input id="langName" value="' + esc(s.langName) + '"><div class="meta" style="margin-top:6px">Встроенный банк уроков только для испанского, остальные языки — через модель.</div><button class="btn" id="saveLang" style="margin-top:10px">Сохранить язык</button></div>';
      var save = function (patch) { return guard(function () { return api('POST', '/api/learn/settings', patch); }).then(function (ns) { L.settings = ns; $('settings').onclick(); toast('Сохранено'); }); };
      document.querySelectorAll('[data-level]').forEach(function (b) { b.onclick = function () { save({ level: b.dataset.level }); }; });
      document.querySelectorAll('[data-focus]').forEach(function (b) { b.onclick = function () { var f = L.settings.focus.slice(); var i = f.indexOf(b.dataset.focus); if (i >= 0) { if (f.length === 1) return toast('Нужен хотя бы один'); f.splice(i, 1); } else f.push(b.dataset.focus); save({ focus: f }); }; });
      $('saveLang').onclick = function () { save({ lang: $('lang').value.trim().toLowerCase(), langName: $('langName').value.trim().toLowerCase() }); };
    };
    if ($('stop')) $('stop').onclick = async function () { await guard(function () { return api('POST', '/api/learn/stop', {}); }); toast('Остановлено'); views.learn(); };
    return Promise.resolve();
  };
  function pickTopic(title, topics, onPick, allowAuto, allowCustom) {
    setHeader(title, '', function () { views.learn(); });
    var html = '<div class="section">' + (allowAuto ? '<div class="row" data-topic=""><div class="grow"><div class="title">🎲 Какую давно не проходил</div><div class="meta">бот выберет сам</div></div></div>' : '') + topics.map(function (t) { return '<div class="row" data-topic="' + esc(t.id) + '" data-title="' + esc(t.title) + '"><div class="grow"><div class="title">' + esc(t.title) + '</div></div></div>'; }).join('') + '</div>';
    if (allowCustom) html += '<div class="section"><label>Своя тема</label><input id="customTopic" placeholder="заказ кофе, мой город, планы на выходные"><button class="btn" id="customGo" style="margin-top:8px">Начать</button></div>';
    $('main').innerHTML = html;
    setFab(null);
    document.querySelectorAll('[data-topic]').forEach(function (r) { r.onclick = function () { onPick(r.dataset.topic, r.dataset.title || ''); }; });
    if (allowCustom) $('customGo').onclick = function () { var t = $('customTopic').value.trim(); if (!t) return toast('Напиши тему'); onPick('', t); };
  }
  async function startInChat(path, body, msg) {
    var r = await guard(function () { return api('POST', path, body); });
    if (!r.started) { toast(r.reason || 'Не запустилось'); return; }
    toast(msg);
    haptic('success');
    setTimeout(function () { if (tg && tg.close) tg.close(); else views.learn(); }, 600);
  }

  // ───────── старт ─────────
  async function boot() {
    if (API) {
      $('nav').style.display = '';
      try {
        state.me = await api('GET', '/api/me');
      } catch (e) {
        $('main').innerHTML = '<div class="empty">Не могу связаться с ботом: ' + esc(e.message) + '<br><br>Если бот был перезапущен, закрой приложение и открой его заново из чата — адрес обновился.</div>';
        return;
      }
      showTab(state.me.counts.cardsDue && !state.me.counts.reminders ? 'learn' : 'today');
      return;
    }
    var deck = null;
    try { var m = (location.hash || '').match(/d=([A-Za-z0-9_-]+)/); if (m) deck = decodeB64Json(m[1]); } catch (e) {}
    if (deck && deck.cards) { cardsOnlyMode(deck); return; }
    $('main').innerHTML = '<div class="empty">Открой приложение из бота: кнопка меню слева от поля ввода или «🗣 Язык» → «Карточки».</div>';
  }
  boot();
})();
