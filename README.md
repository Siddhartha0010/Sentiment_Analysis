# SentimentStream - Real-Time RSS Sentiment Analysis

Real-time temporal sentiment analysis of RSS feeds using streaming NLP pipelines.

## 🚀 Quick Start

**New to development?** Start here: **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**

**Experienced developer?** See: **[QUICK_START.md](./QUICK_START.md)**

**Want to verify your setup?** Check: **[VERIFY_SETUP.md](./VERIFY_SETUP.md)**

---

## 📋 What You Need

- **Node.js** 20.x or higher
- **Java JDK** 11 or higher (for Kafka)
- **Kafka** 3.6.x
- **MariaDB/MySQL** (optional - for data persistence)
- **Memcached** (optional - for caching)

---

## ⚡ Quick Setup (4 Steps)

1. **Install Prerequisites** (Node.js, Java, Kafka) - See [SETUP_GUIDE.md](./SETUP_GUIDE.md)

2. **Start Kafka:**
   ```bash
   # Windows: Run start-kafka-windows.bat
   # Mac/Linux: Run ./start-kafka.sh
   # Or manually start Zookeeper then Kafka (see guide)
   ```

3. **Start Backend:**
   ```bash
   cd backend
   npm install
   npm start
   ```

4. **Start Frontend:**
   ```bash
   npm install
   npm run dev
   ```

5. **Open Browser:** http://localhost:5173

---

## 📚 Documentation

- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Complete beginner-friendly setup instructions
- **[QUICK_START.md](./QUICK_START.md)** - TL;DR version for experienced developers
- **[VERIFY_SETUP.md](./VERIFY_SETUP.md)** - Verification checklist
- **[RSS_IMPLEMENTATION.md](./RSS_IMPLEMENTATION.md)** - RSS integration details
- **[SENTIMENT_IMPLEMENTATION.md](./SENTIMENT_IMPLEMENTATION.md)** - Sentiment processing details
- **[AGGREGATION_IMPLEMENTATION.md](./AGGREGATION_IMPLEMENTATION.md)** - Time-based aggregation details

---

## 🏗️ Architecture

```
RSS Feeds → Backend (Node.js) → Kafka → Sentiment Analysis → WebSocket → Dashboard
```

- **RSS Service**: Polls RSS feeds every 5 seconds
- **Sentiment Service**: Classifies text (positive/negative/neutral)
- **Aggregation Service**: Groups by minute, calculates percentages
- **WebSocket**: Real-time updates to dashboard
- **Kafka**: Message streaming (optional for demo)

---

## 🛠️ Technologies

**Backend:**
- Node.js + Express
- Kafka (message streaming)
- RSS Parser (feed fetching)
- Sentiment (AFINN-based classification)
- WebSocket (real-time communication)

**Frontend:**
- React + TypeScript
- Vite (build tool)
- shadcn-ui (component library)
- Tailwind CSS (styling)
- Recharts (data visualization)

---

## 📝 Configuration

**Backend** (`backend/.env`):
```env
PORT=3000
KAFKA_BROKERS=localhost:9092
RSS_FEED_URL=https://news.ycombinator.com/rss,https://feeds.bbci.co.uk/news/rss.xml
```

**Frontend** (`.env` - optional):
```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

---

## 🐛 Troubleshooting

See [SETUP_GUIDE.md - Troubleshooting Section](./SETUP_GUIDE.md#troubleshooting)

Common issues:
- Kafka connection failed → Check Kafka is running
- Port already in use → Change PORT in `.env`
- Module not found → Run `npm install`
- Frontend shows "Demo Mode" → Backend not running

---

## 📖 Project Structure

```
sentiment/stream-sentiment/
├── backend/              # Node.js backend
│   ├── services/        # RSS, Kafka, Sentiment, WebSocket
│   ├── routes/          # API endpoints
│   └── .env            # Backend configuration
├── src/                 # React frontend
│   ├── components/     # UI components
│   ├── hooks/          # React hooks
│   └── lib/            # API client
├── db/                  # Database schema
└── spark/              # Spark ML (optional)
```

---

## 🎯 Features

- ✅ Real-time RSS feed streaming
- ✅ Sentiment classification (positive/negative/neutral)
- ✅ Time-based aggregation (minute buckets)
- ✅ Real-time dashboard updates via WebSocket
- ✅ Kafka integration for scalable message streaming
- ✅ Beautiful, responsive UI (no changes needed)

---

