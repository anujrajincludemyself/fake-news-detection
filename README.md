# TASDEEQ - AI Fake News Detection Platform

A full-stack web application that detects fake news using machine learning and natural language processing. Supports **text and video** analysis. Built with React, Node.js, MongoDB, and a Python ML microservice.



## Architecture

```
client/ (React + Redux)   -->   server/ (Node.js/Express)   -->   MongoDB
                                       |
                                ml-service/ (Python FastAPI)
```

- **Frontend** -- React SPA with Redux Toolkit, React Router, Framer Motion
- **Backend** -- Express REST API with JWT auth, rate limiting, NLP analysis, media upload
- **ML Service** -- FastAPI microservice with scikit-learn ensemble model + video forensics
- **Database** -- MongoDB for users, analyses, and feedback

### Detection Capabilities

| Type | Techniques |
|------|------------|
| **Text** | ML ensemble (Logistic Regression, Random Forest, Gradient Boosting), NLP heuristics, sentiment & clickbait detection |
| **Video** | Frame extraction, temporal consistency analysis, per-frame ELA, noise profile analysis |

### ML Models Used

#### Text Fake News Detection
| Model | Role |
|-------|------|
| **Logistic Regression** | Fast, interpretable baseline classifier |
| **Random Forest** (200 trees) | Captures non-linear patterns in TF-IDF features |
| **Gradient Boosting** (150 estimators) | Boosts accuracy through iterative correction |
| **Soft Voting Ensemble** | Combines all three for best overall performance |

#### Video Forensics
| Technique | What It Detects |
|-----------|----------------|
| **Frame Sampling + Per-frame ELA** | Manipulated frames within a video sequence |
| **Temporal Consistency Analysis** | Sudden jumps between frames that indicate editing |
| **Noise Profile Analysis** | Inconsistent noise across frames reveals spliced content |
| **FPS / Metadata Flags** | Suspicious frame rates or container anomalies |

---

## Quick Start

### Prerequisites

- Node.js 16+
- Python 3.8+
- MongoDB (local or Atlas)

### 1. Backend Setup

```bash
cd server
npm install
```

Create `server/.env` (a default is already provided):

```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/fakenews_detective
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRE=7d
ML_SERVICE_URL=http://localhost:8000
```

Start the server:

```bash
npm run dev
```

The API runs on **http://localhost:5000**.

### 2. Frontend Setup

```bash
cd client
npm install
npm start
```

The app opens on **http://localhost:3000**.

### 3. ML Service Setup (Optional)

The app works without the ML service -- the backend falls back to a built-in NLP heuristic engine. To enable the trained ML model:

```bash
cd ml-service
pip install -r requirements.txt
```

#### Training a Model

1. Download a dataset (see "Datasets" below)
2. Place the CSV file in `ml-service/data/` (create the `data/` folder if needed)
3. Run the training script:

```bash
python train_model.py --dataset data/your_dataset.csv
```

4. The trained model is saved to `ml-service/models/`

#### Starting the ML Service

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

The service runs on **http://localhost:8000**.

---

## Datasets

Download any of these publicly available datasets:

### Text Datasets
| # | Dataset | Description | Link |
|---|---------|-------------|------|
| 1 | **Kaggle Fake News** | 20K+ labeled articles (title, text, label) | [kaggle.com](https://www.kaggle.com/c/fake-news/data) |
| 2 | **ISOT Fake News** | 44K articles (21K real, 23K fake) from UVic | [uvic.ca](https://onlineacademiccommunity.uvic.ca/isot/2022/11/27/fake-news-detection-datasets/) |
| 3 | **LIAR** | 12.8K labeled statements from PolitiFact | [ucsb.edu](https://www.cs.ucsb.edu/~william/data/liar_dataset.zip) |
| 4 | **FakeNewsNet** | News content + social context | [github.com](https://github.com/KaiDMML/FakeNewsNet) |

### Image / Video Datasets
| # | Dataset | Type | Size | Link |
|---|---------|------|------|------|
| 1 | **CASIA v2** | Image splicing & copy-move | 12K images | [kaggle.com](https://www.kaggle.com/datasets/sophatvathana/casia-dataset) |
| 2 | **FaceForensics++** | Video deepfakes | 1000+ videos | [github.com](https://github.com/ondyari/FaceForensics) |
| 3 | **DFDC** (Facebook) | Video deepfakes | 100K+ clips | [dfdc.ai](https://ai.facebook.com/datasets/dfdc/) |
| 4 | **CIFAKE** | AI-generated vs real images | 120K images | [kaggle.com](https://www.kaggle.com/datasets/birdy654/cifake-real-and-ai-generated-synthetic-images) |
| 5 | **OpenForensics** | Image & video forensics | Large scale | [github.com](https://github.com/ltnghia/openforensics) |

The training script auto-detects common column names (text/content/article, label/class/target).

---

## How the ML Model Works

1. **Preprocessing** -- lowercasing, URL/HTML/special character removal, stopword filtering, Porter stemming
2. **TF-IDF Vectorization** -- up to 50,000 features with unigram-to-trigram support
3. **Ensemble Voting** -- three classifiers combine via soft voting:
   - Logistic Regression (baseline)
   - Random Forest (200 trees)
   - Gradient Boosting (150 estimators)
4. **NLP Fallback** -- if the ML service is offline, the backend uses a built-in heuristic engine that checks clickbait patterns, emotional language, sentiment, subjectivity, source attribution, and readability

---

## API Endpoints

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Get current user (protected) |

### Analysis
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/analysis` | Analyze news text |
| GET | `/api/analysis/history` | Get user history (protected) |
| GET | `/api/analysis/stats` | Get user stats (protected) |
| GET | `/api/analysis/:id` | Get single analysis |
| PUT | `/api/analysis/:id/feedback` | Submit feedback |

### Video Analysis
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/video/analyze` | Analyze video for manipulation (multipart upload) |

---

## Project Structure

```
fake-news/
  client/                  # React frontend
    src/
      components/layout/   # Navbar, Footer
      pages/               # Home, Analyze, MediaAnalyze (video), About, Login, Register, Dashboard, History
      store/               # Redux store + slices (auth, analysis, ui)
      services/            # Axios API service
  server/                  # Node.js backend
    src/
      config/              # Database config
      controllers/         # Auth, Analysis controllers
      middleware/          # JWT auth, error handler, file upload (multer)
      models/              # User, Analysis Mongoose models
      routes/              # Auth, Analysis routes
      services/            # NLP analyzer, prediction service
      utils/               # Logger
  ml-service/              # Python ML microservice
    app.py                 # FastAPI prediction API (text + video)
    train_model.py         # Model training script
    models/                # Saved model files (.pkl)
    data/                  # Dataset CSVs (gitignored)
```

---

## Scripts

| Location | Command | Description |
|----------|---------|-------------|
| `server/` | `npm run dev` | Start backend (nodemon) |
| `server/` | `npm start` | Start backend (production) |
| `client/` | `npm start` | Start React dev server |
| `client/` | `npm run build` | Production build |
| `ml-service/` | `python train_model.py --dataset data/file.csv` | Train ML model |
| `ml-service/` | `uvicorn app:app --port 8000` | Start ML service |

---

## License

MIT
