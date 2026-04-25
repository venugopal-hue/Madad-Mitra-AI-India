# Madad Mitra AI - Setup Guide

Madad Mitra AI is a real-time NGO-Volunteer coordination platform.

## 🛠 Prerequisites

1.  **Firebase Project**: Create a project at [console.firebase.google.com](https://console.firebase.google.com/).
2.  **OpenAI API Key**: Get your key from [platform.openai.com](https://platform.openai.com/).

## 🚀 Setup Instructions

### 1. Firebase Configuration
- Enable **Authentication** (Email/Password).
- Enable **Cloud Firestore**.
- In Firestore, create two collections: `users` and `issues`.
- Add the following **Firestore Rules** (Basic for development):
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if request.auth != null;
      }
    }
  }
  ```

### 2. Configure API Keys
Open `js/config.js` and replace the placeholders:
- `FIREBASE_CONFIG`: Copy from your Firebase Project Settings > Web App.
- `OPENAI_CONFIG`: Enter your OpenAI API Key.

### 3. Local Development
Since this project uses ES Modules, you need a local server.
- Using VS Code: Install **Live Server** extension and click "Go Live".
- Using Python: `python -m http.server 8000`
- Using Node: `npx serve .`

## 📦 Deployment

### Vercel (Recommended)
1.  Install Vercel CLI: `npm i -g vercel`.
2.  Run `vercel` in the project root.
3.  Follow prompts.

### Netlify
1.  Drag and drop the folder into the Netlify dashboard.
2.  Or connect your GitHub repository.

## 🧠 Core Logic Locations

- **Matching Algorithm**: `js/matching.js`
- **AI Prioritization**: `js/ngo.js` (see `analyzeWithAI`)
- **Map Integration**: `js/ngo.js` and `js/volunteer.js` using Leaflet.js.
- **Distance Calculation**: `js/utils.js` (Haversine Formula).
