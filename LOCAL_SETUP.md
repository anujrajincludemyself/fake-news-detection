# Running Fake News Detector Locally

## Prerequisites
- Node.js 18+
- Python 3.9+
- MongoDB (local or Atlas URI)

## 1. Clone & install dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install

# ML service
cd ../ml-service
pip install -r requirements.txt

# Video processing service
cd ../video-processing
pip install -r requirements.txt
```

## 2. Configure environment variables

Create `server/.env`:
```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/fakenews
JWT_SECRET=your_secret_key
JWT_EXPIRE=7d
CLIENT_URL=http://localhost:3000

# AI service keys (add whichever you use)
GEMINI_API_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=
HUGGINGFACE_API_KEY=

# Video processing service URL (default: http://localhost:8001)
VIDEO_SERVICE_URL=http://localhost:8001
```

For the **client**, open `client/.env` and switch the API URL to local:
```env
# Comment out the Render URL:
# REACT_APP_API_URL=https://fake-news-detection-f1ha.onrender.com/api

# Uncomment this:
REACT_APP_API_URL=http://localhost:5000/api
```

## 3. Start all services

```bash
# Terminal 1 — backend
cd server
npm run dev

# Terminal 2 — ML service
cd ml-service
python app.py

# Terminal 3 — Video processing service (needed for /video-analyze)
cd video-processing
cp .env.example .env          # then fill in GROQ_API_KEY
python app.py

# Terminal 4 — frontend
cd client
npm start
```

App opens at **http://localhost:3000**

## 4. Push Notifications (local)

The Firebase service worker only works over **HTTPS or localhost**.  
When testing on a phone, run the frontend over your local network:
```bash
# Find your local IP (e.g. 192.168.1.x) then open on phone:
http://192.168.1.x:3000
```
> Note: Push permission will not trigger on plain HTTP on phones. Use `ngrok` or deploy to test on mobile.
