function token() { return localStorage.getItem('token'); }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function logout() { localStorage.clear(); location.href = '/'; }

async function api(path, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token()) headers.Authorization = 'Bearer ' + token();
  const res = await fetch('/api' + path, { method: method || 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token()) localStorage.clear();
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// Logged in user (fresh from the server) or null
async function whoami() {
  if (!token()) return null;
  try { return (await api('/auth/me')).user; } catch (e) { return null; }
}

async function renderNav() {
  const u = await whoami();
  let h = '<a href="/">Home</a> | <a href="/projects.html">Projects</a> | <a href="/leaderboard.html">Leaderboard</a> | ';
  if (u && u.role === 'leader') h += '<a href="/register.html">Register Team</a> | ';
  h += u ? esc(u.name) + ' (' + u.role + ') <a href="#" onclick="logout();return false">Logout</a>' : '<a href="/login.html">Login</a>';
  document.getElementById('nav').innerHTML = h + '<hr>';
  return u;
}

// N number inputs (0-5) + submit. onSubmit may return a message string to show.
function scoreForm(el, labels, initial, buttonText, onSubmit) {
  el.innerHTML = labels.map((l, i) =>
    '<div class="row">' + esc(l) + ' (0-5): <input type="number" min="0" max="5" step="1" style="width:50px" id="' + el.id + '_' + i + '" value="' + (initial ? initial[i] : '') + '"></div>'
  ).join('') + '<button id="' + el.id + '_btn">' + buttonText + '</button><div class="msg" id="' + el.id + '_msg"></div>';
  document.getElementById(el.id + '_btn').onclick = async () => {
    const msg = document.getElementById(el.id + '_msg');
    const vals = labels.map((_, i) => document.getElementById(el.id + '_' + i).value);
    if (vals.some((v) => v === '')) { msg.textContent = 'Fill all scores'; return; }
    try { msg.textContent = (await onSubmit(vals.map(Number))) || 'Saved'; }
    catch (e) { msg.textContent = e.message; }
  };
}
