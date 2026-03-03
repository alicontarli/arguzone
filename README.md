# ArguZone

![Status](https://img.shields.io/badge/Status-Beta-orange)

**ArguZone** is a real-time voice and text chat application built for friend groups. It delivers a Discord-like experience by combining WebRTC peer-to-peer audio with Firebase-powered text chat, packaged as both a web app and a native desktop application via Electron.

---

## ✨ Features

### 💬 Text Chat
- Real-time messaging powered by Firebase Firestore
- Messages persist across sessions and are ordered chronologically
- Auto-scroll to the latest message
- 2000-character message limit with a live remaining-characters counter
- Visible send button (also supports Enter key)

### 🎙️ Voice Chat
- Peer-to-peer audio via **PeerJS (WebRTC)** — no extra server costs
- Noise gate with a configurable threshold (filters out background noise between words)
- Configurable microphone input gain (0–200%)
- Active speakers list in the sidebar with mute indicators (🔇)
- Heartbeat system — automatically removes inactive users from the voice channel
- Graceful cleanup on tab close or app exit

### 🔐 Authentication
- Email/password login and **registration** (create an account in-app)
- Auto-generated avatar using [UI Avatars](https://ui-avatars.com)
- Change display name from the Settings panel

### ⚙️ Settings Panel
Click the **⚙️** button in the top bar to open Settings.

#### 🎧 Audio Settings
| Setting | Description |
|---|---|
| **Microphone (Input Device)** | Choose from all available audio input devices; selection persists across sessions |
| **Speaker / Headset (Output Device)** | Choose from all available audio output devices; applied immediately to active calls via `setSinkId` |
| **Microphone Input Volume** | Boost or reduce your microphone level (0–200%), applied in real-time via Web Audio API |
| **Output Volume** | Adjust the volume of all incoming voice streams (0–100%), applied in real-time |
| **Noise Gate Threshold** | Fine-tune the silence threshold (0–50); changes apply instantly without reconnecting |
| **Echo Cancellation** | Toggle browser-level echo cancellation (applied on next connection) |
| **Noise Suppression** | Toggle browser-level noise suppression (applied on next connection) |

All settings are persisted to `localStorage` and restored on next launch.

#### 👤 Account Settings
- View your current avatar, display name, and email
- Change your display name at any time

### 🖥️ Desktop (Electron)
- Native Windows application via Electron + NSIS installer
- **Global hotkey `Alt+M`** — mute/unmute your microphone even when the app is in the background
- Graceful cleanup on app close (removes you from the voice channel)
- Menu bar hidden for a cleaner experience

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| UI | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| Desktop | [Electron 33](https://www.electronjs.org/) |
| Backend / Auth | [Firebase](https://firebase.google.com/) (Firestore + Auth) |
| Voice / P2P | [PeerJS](https://peerjs.com/) (WebRTC wrapper) |
| Audio Processing | Web Audio API (noise gate, gain nodes) |
| Build | electron-builder (NSIS for Windows) |

---

## ⚙️ Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/alicontarli/arguzone.git
cd arguzone
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file in the root directory with your Firebase project credentials:
```env
VITE_apiKey=your_firebase_api_key
VITE_authDomain=your_project.firebaseapp.com
VITE_projectId=your_project_id
VITE_storageBucket=your_project.appspot.com
VITE_messagingSenderId=your_sender_id
VITE_appId=your_app_id
VITE_measurementId=your_measurement_id
```
> Obtain these values from the [Firebase Console](https://console.firebase.google.com/) → Project Settings → Your apps.

### 4. Firebase setup
Enable the following in the Firebase Console:
- **Authentication** → Email/Password sign-in method
- **Firestore Database** → create a database, use the following collections:
  - `chat` — text messages
  - `voice_active` — active voice participants

### 5. Run in development mode

Web only:
```bash
npm run dev
```

Web + Electron simultaneously:
```bash
npm run electron:dev
```

### 6. Build

Web build:
```bash
npm run build
```

Windows installer (`.exe`):
```bash
npm run electron:build
```
Output is placed in the `release/` folder.

---

## 🗂️ Project Structure

```
arguzone/
├── electron/
│   ├── main.cjs        # Electron main process (window, global shortcuts)
│   └── preload.cjs     # Context bridge (IPC → React)
├── src/
│   ├── App.jsx         # Main React component (all UI & logic)
│   ├── firebase.js     # Firebase initialization & Firestore export
│   ├── main.jsx        # React entry point
│   └── index.css       # Global styles
├── public/
├── index.html
├── vite.config.js
└── package.json
```

---

## 🤝 Contributing

This project is in active development. Bug reports and feature requests are welcome via the [Issues](https://github.com/alicontarli/arguzone/issues) tab.
