# Quick Start Guide (TL;DR Version)

## Prerequisites Check

Run these commands to verify you have everything:

```bash
node --version    # Should show v20.x.x or higher
npm --version     # Should show 10.x.x or higher
java -version     # Should show version 11 or higher
```

---

## Installation (One-Time Setup)

### 1. Install Node.js
- Download from: https://nodejs.org/ (LTS version)
- Install with default settings
- Restart computer

### 2. Install Java JDK 11+
- Windows: Download from https://adoptium.net/
- Mac: `brew install openjdk@11`
- Linux: `sudo apt-get install openjdk-11-jdk`

### 3. Install Kafka
- Download from: https://kafka.apache.org/downloads (Kafka 3.6.x)
- Extract to `C:\kafka` (Windows) or `~/kafka` (Mac/Linux)

---

## Daily Startup (Run Every Time)

### Step 1: Start Kafka (2 terminals needed)

**Terminal 1 - Zookeeper:**
```bash
# Windows
cd C:\kafka\kafka_2.13-3.6.1
.\bin\windows\zookeeper-server-start.bat .\config\zookeeper.properties

# Mac/Linux
cd ~/kafka
bin/zookeeper-server-start.sh config/zookeeper.properties
```

**Terminal 2 - Kafka (wait 10 seconds after Zookeeper):**
```bash
# Windows
cd C:\kafka\kafka_2.13-3.6.1
.\bin\windows\kafka-server-start.bat .\config\server.properties

# Mac/Linux
cd ~/kafka
bin/kafka-server-start.sh config/server.properties
```

### Step 2: Start Spark ML Pipeline

**Terminal 3 - Spark:**
```bash
cd sentiment/stream-sentiment/spark
pip install -r requirements.txt
python sentiment_analysis.py
```

Wait for Spark streaming initialization.

### Step 3: Start Backend

**Terminal 4:**
```bash
cd sentiment/stream-sentiment/backend
npm install  # Only needed first time
npm start
```

Wait for: `Server running on port 3000`

### Step 4: Start Frontend

**Terminal 5:**
```bash
cd sentiment/stream-sentiment
npm install  # Only needed first time
npm run dev
```

Wait for: `Local: http://localhost:5173/`

### Step 5: Open Browser

Go to: **http://localhost:5173**

Type a topic (e.g., "tech") and click "Start Stream"

---

## Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Kafka won't start | Make sure Java is installed and in PATH |
| Port 3000 in use | Change PORT in `backend/.env` to 3001 |
| Backend can't connect to Kafka | Check Kafka is running (Terminal 2) |
| Frontend shows "Demo Mode" | Backend not running - start it! |
| No RSS items | Wait 5-10 seconds, check backend logs |

---

## Stop Everything

Press `Ctrl+C` in each terminal:
1. Frontend (Terminal 5)
2. Backend (Terminal 4)
3. Spark (Terminal 3)
4. Kafka (Terminal 2)
5. Zookeeper (Terminal 1)

---

**Full detailed guide:** See `SETUP_GUIDE.md`
