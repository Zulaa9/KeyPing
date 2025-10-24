# 🛡️ KeyPing

**KeyPing** is a desktop application that detects when a user tries to create a password too similar or identical to one previously used — improving personal password hygiene.

Unlike a password manager, **KeyPing doesn’t store or autofill credentials.**  
It simply analyzes password patterns locally and alerts you when a new one resembles an old one.

---

## ✨ Features

- 💾 **Fully local storage** — encrypted with AES  
- 🔍 **Similarity detection** — Levenshtein distance + partial hash comparison  
- ⚠️ **Smart alerts** — warns about reused or predictable patterns  
- 🎨 **Modern & minimalist UI** built with Angular + Electron  
- 🔐 **Offline-first** — no cloud, no accounts, no tracking

---

## 🧩 Tech Stack

| Layer | Technology |
|:------|:------------|
| Frontend | Angular |
| Desktop Shell | Electron |
| Local Logic | Node.js (or .NET 9 Minimal API optional) |
| Encryption | AES-256-GCM (Node crypto) |
| Build | Electron Builder |

---

## 🧭 Project Goals

Create a polished MVP that demonstrates:
- Secure local password pattern detection  
- Privacy-focused offline design  
- Modern and intuitive UX  
- Cross-platform compatibility (Windows, Linux, macOS)

---

## 🚀 Getting Started (MVP)

> A detailed setup guide will be added as development progresses.

```bash
# clone repository
git clone https://github.com/zulaa9/keyping.git
cd keyping

# install dependencies
npm install

# run angular + electron in dev mode
npm run dev
```
---
### 📜 License
Released under the [MIT License](LICENSE).

---

👤 Developed by **Unax Zulaika Fuente**

📍 [Github](https://github.com/Unax-Zulaika-Fuente)
