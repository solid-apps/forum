# forum

A Discord-style forum app for Solid pods. Light theme, channels, posts, members, presence.

Login via [xlogin](https://npm.im/xlogin) — works with both **Solid OIDC** (WebID) and **Nostr** (NIP-07 / NIP-98).

## Install

```bash
jss install forum
```

Then open `http://<your-pod>/public/apps/forum/`.

## Status

MVP, in progress. Checkpoints:

- [x] **1. Scaffold** — light-theme Discord layout with stats cards and channel list (hardcoded data)
- [ ] **2. Auth** — xlogin wired up, header shows identity
- [ ] **3. Channels** — read/write `/forum/index.jsonld`
- [ ] **4. Posts** — open a channel, list posts, compose new posts
- [ ] **5. Presence** — Members + Online via WebSocket

## License

[AGPL-3.0-or-later](./LICENSE)
