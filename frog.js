(() => {
  const byId = id => document.getElementById(id);
  const panel = byId('frogPanel');
  const toggle = byId('frogToggle');
  function update() {
    const loggedIn = byId('connection').classList.contains('connected');
    const result = byId('resultTitle').textContent;
    const seatCount = Number(result.match(/(\d+) 個座位/)?.[1] || 0);
    const message = byId('notice');
    let text = '呱～先登入，再來找位子。';
    let action = '前往登入';
    if (loggedIn) {
      text = seatCount > 0 ? '找到位子了！點「預約」就能選結束時間。' : '想幾點開始讀？選好時間，我陪你找。';
      action = seatCount > 0 ? '看座位' : '選時間';
    }
    if (!message.hidden && message.classList.contains('success')) text = '呱！' + message.textContent;
    byId('frogMessage').textContent = text;
    byId('frogAction').textContent = action;
  }
  function open(value) {
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) update();
  }
  toggle.addEventListener('click', () => open(panel.hidden));
  byId('frogClose').addEventListener('click', () => { open(false); toggle.focus(); });
  byId('frogAction').addEventListener('click', () => {
    open(false);
    if (!byId('connection').classList.contains('connected')) {
      byId('loginPanel').open = true;
      byId('account').focus();
    } else if (Number(byId('resultTitle').textContent.match(/(\d+) 個座位/)?.[1]) > 0) {
      byId('results').scrollIntoView({ block: 'start' });
    } else {
      byId('date').focus();
    }
  });
  byId('frogBookings').addEventListener('click', () => {
    open(false);
    byId('myReservations').open = true;
    byId('myReservations').scrollIntoView({ block: 'center' });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { open(false); toggle.focus(); }
  });
  const observer = new MutationObserver(() => { if (!panel.hidden) update(); });
  for (const id of ['connection', 'notice', 'resultTitle']) observer.observe(byId(id), { childList: true, subtree: true, attributes: true });
})();
