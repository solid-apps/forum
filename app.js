// forum app — single-pod-hosted MVP
// Data layout (same-origin as the app):
//   /public/forum/index.jsonld          channel list
//   /public/forum/channels/<name>/      one container per channel
//   /public/forum/channels/<name>/<id>.jsonld   one doc per post

const FORUM_BASE = `${location.origin}/public/forum/`
const INDEX_URL = `${FORUM_BASE}index.jsonld`
const CHANNELS_BASE = `${FORUM_BASE}channels/`

const DEFAULT_INDEX = {
  '@context': { schema: 'https://schema.org/', forum: 'urn:forum:' },
  '@id': '#forum',
  '@type': 'schema:DiscussionForumPosting',
  'schema:name': 'forum',
  'forum:channels': [
    { '@id': '#general', 'schema:name': 'general', 'schema:description': 'The catch-all channel.' }
  ]
}

const state = {
  channels: [],
  postCounts: {}
}

// --- xlogin helpers (works whether logged-in or not) ---

function authFetch(url, opts) {
  if (window.xlogin && window.xlogin.authFetch && window.xlogin.id) {
    return window.xlogin.authFetch(url, opts)
  }
  return fetch(url, opts)
}

function currentIdentity() {
  if (!window.xlogin || !window.xlogin.id) return null
  return { type: window.xlogin.type, id: window.xlogin.id }
}

// --- index (channel list) ---

async function loadIndex() {
  const res = await fetch(INDEX_URL, { headers: { Accept: 'application/ld+json' } })
  if (res.status === 404) {
    if (currentIdentity()) {
      await seedIndex()
      return DEFAULT_INDEX
    }
    return null
  }
  if (!res.ok) throw new Error(`GET ${INDEX_URL} → ${res.status}`)
  return res.json()
}

async function seedIndex() {
  const res = await authFetch(INDEX_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify(DEFAULT_INDEX)
  })
  if (!res.ok) throw new Error(`seed PUT → ${res.status}`)
}

async function saveIndex(doc) {
  const res = await authFetch(INDEX_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify(doc)
  })
  if (!res.ok) throw new Error(`save index PUT → ${res.status}`)
}

function channelsFrom(doc) {
  if (!doc) return []
  const list = doc['forum:channels'] || doc.channels || []
  return list.map(ch => ({
    name: ch['schema:name'] || ch.name || ch['@id']?.replace(/^#/, ''),
    description: ch['schema:description'] || ch.description || '',
    tag: ch['forum:tag'] || ch.tag || null
  })).filter(ch => ch.name)
}

// --- posts ---

async function listPosts(channelName) {
  const url = `${CHANNELS_BASE}${encodeURIComponent(channelName)}/`
  const res = await fetch(url, { headers: { Accept: 'application/ld+json' } })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  const doc = await res.json()
  // Container resources are listed under ldp:contains
  const contains = doc['ldp:contains'] || doc.contains || doc['http://www.w3.org/ns/ldp#contains'] || []
  const refs = Array.isArray(contains) ? contains : [contains]
  return refs
    .map(r => (typeof r === 'string' ? r : r['@id']))
    .filter(r => r && r.endsWith('.jsonld'))
}

async function loadPost(url) {
  const res = await fetch(url, { headers: { Accept: 'application/ld+json' } })
  if (!res.ok) return null
  const doc = await res.json()
  return {
    text: doc['schema:text'] || doc.text || '',
    author: doc['schema:author'] || doc.author || 'unknown',
    date: doc['schema:datePublished'] || doc.datePublished || null,
    url
  }
}

async function createPost(channelName, text) {
  const id = currentIdentity()
  if (!id) throw new Error('not logged in')
  const ulid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const url = `${CHANNELS_BASE}${encodeURIComponent(channelName)}/${ulid}.jsonld`
  const body = {
    '@context': { schema: 'https://schema.org/' },
    '@type': 'schema:Comment',
    'schema:author': id.id,
    'schema:text': text,
    'schema:datePublished': new Date().toISOString()
  }
  const res = await authFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`PUT post → ${res.status}`)
  return url
}

// --- rendering ---

function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function shortAuthor(id) {
  if (!id) return 'unknown'
  if (id.startsWith('http')) {
    try { return new URL(id).host } catch { return id }
  }
  if (id.length > 16) return id.slice(0, 8) + '…' + id.slice(-4)
  return id
}

function renderChannelList() {
  const container = document.getElementById('channels')
  container.innerHTML = ''
  if (state.channels.length === 0) {
    container.appendChild(el(`<div class="empty">No channels yet.</div>`))
    return
  }
  for (const ch of state.channels) {
    const count = state.postCounts[ch.name] ?? 0
    container.appendChild(el(`
      <article class="channel" data-channel="${escapeHtml(ch.name)}">
        <div class="channel-icon">#</div>
        <div class="channel-body">
          <div class="channel-head">
            <h3 class="channel-name">${escapeHtml(ch.name)}</h3>
            ${ch.tag ? `<span class="tag tag-neutral">${escapeHtml(ch.tag)}</span>` : ''}
          </div>
          ${ch.description ? `<p class="channel-desc">${escapeHtml(ch.description)}</p>` : ''}
        </div>
        <div class="channel-side">
          <span class="post-count">${count} post${count === 1 ? '' : 's'}</span>
        </div>
      </article>
    `))
  }
}

function renderStats() {
  const total = Object.values(state.postCounts).reduce((a, b) => a + b, 0)
  document.getElementById('stat-channels').textContent = state.channels.length
  document.getElementById('stat-active-channels').textContent = state.channels.length
  document.getElementById('stat-messages').textContent = total
  document.getElementById('stat-messages-top').textContent = total
}

function renderIdentity() {
  const id = currentIdentity()
  const el = document.getElementById('topbar-id')
  if (id) {
    el.textContent = `· ${shortAuthor(id.id)}`
    el.hidden = false
    document.getElementById('btn-new-channel').hidden = false
    document.getElementById('composer-locked').hidden = true
    document.getElementById('composer').hidden = false
    const hint = document.getElementById('composer-hint')
    hint.textContent = `posting as ${shortAuthor(id.id)}`
  } else {
    el.hidden = true
    document.getElementById('btn-new-channel').hidden = true
    document.getElementById('composer').hidden = true
    document.getElementById('composer-locked').hidden = false
  }
}

async function renderChannelView(channelName) {
  document.getElementById('view-channels').hidden = true
  document.getElementById('view-channel').hidden = false
  const ch = state.channels.find(c => c.name === channelName)
  document.getElementById('channel-title').textContent = `#${channelName}`
  const desc = document.getElementById('channel-description')
  desc.textContent = ch?.description || ''
  const tag = document.getElementById('channel-tag')
  if (ch?.tag) { tag.textContent = ch.tag; tag.hidden = false } else { tag.hidden = true }

  const postsEl = document.getElementById('posts')
  postsEl.innerHTML = '<div class="empty">Loading posts…</div>'
  try {
    const urls = await listPosts(channelName)
    state.postCounts[channelName] = urls.length
    const posts = (await Promise.all(urls.map(loadPost))).filter(Boolean)
    posts.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    postsEl.innerHTML = ''
    if (posts.length === 0) {
      postsEl.appendChild(el(`<div class="empty">No posts yet. Be the first.</div>`))
    }
    for (const p of posts) {
      postsEl.appendChild(el(`
        <article class="post">
          <div class="post-head">
            <span class="post-author">${escapeHtml(shortAuthor(p.author))}</span>
            <span class="post-date">${formatDate(p.date)}</span>
          </div>
          <div class="post-body">${escapeHtml(p.text)}</div>
        </article>
      `))
    }
  } catch (e) {
    postsEl.innerHTML = `<div class="empty">Could not load posts: ${escapeHtml(e.message)}</div>`
  }
}

function showChannelList() {
  document.getElementById('view-channels').hidden = false
  document.getElementById('view-channel').hidden = true
}

// --- post counts (background pass over channels) ---

async function refreshPostCounts() {
  await Promise.all(state.channels.map(async ch => {
    try {
      const urls = await listPosts(ch.name)
      state.postCounts[ch.name] = urls.length
    } catch {
      state.postCounts[ch.name] = 0
    }
  }))
  renderChannelList()
  renderStats()
}

// --- router ---

function route() {
  const hash = location.hash
  const m = hash.match(/^#\/channel\/(.+)$/)
  if (m) {
    renderChannelView(decodeURIComponent(m[1]))
  } else {
    showChannelList()
  }
}

// --- init ---

async function init() {
  renderIdentity()
  try {
    const doc = await loadIndex()
    state.channels = channelsFrom(doc)
  } catch (e) {
    document.getElementById('channels-empty').textContent = `Failed to load: ${e.message}`
    return
  }
  renderChannelList()
  renderStats()
  route()
  // background fetch of post counts
  refreshPostCounts().catch(() => {})
}

// --- events ---

document.addEventListener('click', e => {
  const channelEl = e.target.closest('[data-channel]')
  if (channelEl) {
    const name = channelEl.dataset.channel
    location.hash = `#/channel/${encodeURIComponent(name)}`
  }
})

window.addEventListener('hashchange', route)

document.getElementById('composer').addEventListener('submit', async e => {
  e.preventDefault()
  const textarea = document.getElementById('composer-text')
  const text = textarea.value.trim()
  if (!text) return
  const m = location.hash.match(/^#\/channel\/(.+)$/)
  if (!m) return
  const channel = decodeURIComponent(m[1])
  const btn = e.target.querySelector('button')
  btn.disabled = true
  btn.textContent = 'Posting…'
  try {
    await createPost(channel, text)
    textarea.value = ''
    await renderChannelView(channel)
  } catch (err) {
    alert(`Post failed: ${err.message}`)
  } finally {
    btn.disabled = false
    btn.textContent = 'Post'
  }
})

document.getElementById('btn-new-channel').addEventListener('click', async () => {
  const name = prompt('Channel name (e.g. "ideas")')
  if (!name) return
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!clean) return alert('Invalid name')
  if (state.channels.some(c => c.name === clean)) return alert('Channel already exists')
  const desc = prompt(`Description for #${clean} (optional)`) || ''
  const doc = await loadIndex() || JSON.parse(JSON.stringify(DEFAULT_INDEX))
  const list = doc['forum:channels'] || doc.channels || []
  list.push({ '@id': `#${clean}`, 'schema:name': clean, 'schema:description': desc })
  doc['forum:channels'] = list
  try {
    await saveIndex(doc)
    state.channels = channelsFrom(doc)
    renderChannelList()
    renderStats()
  } catch (e) {
    alert(`Failed: ${e.message}`)
  }
})

document.getElementById('mark-read').addEventListener('click', e => {
  e.preventDefault()
  // no-op for MVP
})

// Wait for xlogin to be ready (it may load async). Re-render on login state changes.
function watchLogin() {
  let last = window.xlogin?.id
  setInterval(() => {
    const now = window.xlogin?.id
    if (now !== last) {
      last = now
      renderIdentity()
    }
  }, 500)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); watchLogin() })
} else {
  init(); watchLogin()
}
