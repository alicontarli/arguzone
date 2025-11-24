# ArguZone (Beta v0.0.1)

![Status](https://img.shields.io/badge/Status-Beta-orange) ![Version](https://img.shields.io/badge/Version-v0.0.1-blue) ![License](https://img.shields.io/badge/License-MIT-green)

**ArguZone** is a modern chat application designed for friend groups, providing low-latency voice and text communication. It aims to offer a Discord-like experience by bringing the power of web technologies to the desktop with Electron.

## 🚀 Features

* **Real-Time Messaging:** Instant text communication via Firebase Firestore infrastructure.
* **P2P Voice Chat:** Direct and low-latency voice transmission between users using PeerJS without server costs.
* **Desktop Integration:**
    * Native application experience on Windows with Electron.
    * **Global Mute:** Ability to toggle the microphone with the `Alt + M` shortcut even when the application is in the background.
* **Cross-Platform:** A structure that can work both in the web browser and as a desktop application.

## 🛠️ Tech Stack

This project is developed using the following technologies:

* **Core:** [React](https://react.dev/) + [Vite](https://vitejs.dev/)
* **Desktop Framework:** [Electron](https://www.electronjs.org/)
* **Backend & Database:** [Firebase](https://firebase.google.com/) (Auth & Firestore)
* **Voice / P2P:** [PeerJS](https://peerjs.com/) (WebRTC Wrapper)
* **Build Tool:** Electron Builder

## ⚙️ Installation and Setup

Follow the steps below to run the project in your local environment:

### 1. Clone the Repository
```bash
git clone [https://github.com/YOUR_USERNAME/arguzone-beta.git](https://github.com/YOUR_USERNAME/arguzone-beta.git)
cd arguzone-beta
```
### 2. Install Dependencies
```Bash
npm install
```
### 3. Environment Variables (.env)
You need a .env file containing Firebase and PeerJS configurations for the project to run. Create a .env file in the root directory and fill in the following keys by obtaining them from your own Firebase project:
```Bash
VITE_API_KEY=your_firebase_api_key
VITE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_PROJECT_ID=your_project_id
VITE_STORAGE_BUCKET=your_project.appspot.com
VITE_MESSAGING_SENDER_ID=your_sender_id
VITE_APP_ID=your_app_id
```
### 4. Running in Development Mode (Dev)
To open Web and Electron simultaneously in development mode:
```Bash
npm run electron:dev
```
For Web version only:
```Bash
npm run dev
```

### 📦 Build
If you want to create an .exe file for Windows:
```Bash
npm run electron:build
```
Output files will be created in the release/ folder.

### 🤝 Contribution
This project is currently in the development stage. You can report bugs via the "Issues" tab.
