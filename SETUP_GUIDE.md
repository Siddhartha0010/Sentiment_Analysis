# Local Setup Guide for Streaming Sentiment Analysis

This guide explains how to set up and run your streaming sentiment analysis pipeline locally on Windows. Since this project strictly uses a true event-driven architecture with Apache Kafka and Apache Spark, you will need all components running simultaneously.

## Architecture Overview
Your project works like an assembly line:
1. **Node.js (Backend)**: Actively fetches RSS feed news and pushes it into **Kafka** (topic: `tweet_topic`)
2. **Kafka Broker**: Acts as the message highway.
3. **PySpark Script**: Listens to the `tweet_topic`, cleans the text, runs a Sentiment Machine Learning model on it, and sends the result back to another Kafka topic (`sentiment_topic`). It *also* saves the result to **MariaDB** for historical graphs.
4. **Node.js (Backend)**: Listens to the `sentiment_topic`. When it gets a classified event from Spark, it broadcasts it continuously via WebSockets.
5. **React Dashboard**: Listens to the WebSocket and draws the beautiful real-time charts you see on your screen.

---

## 🛠 Prerequisites Checklist
To run this complex pipeline locally on Windows, ensure you have:
- [ ] **Node.js** (v18+)
- [ ] **Java 11 or 17** (Required for Kafka and Spark)
- [ ] **Apache Kafka (Windows)** downloaded and extracted (e.g. `C:\kafka\`)
- [ ] **Python 3.10+** (Required for PySpark)
- [ ] **MariaDB** or **MySQL** Server installed locally

---

## 🚀 Step 1: Start MariaDB
You must start your MariaDB server and apply the provided schema.
1. Open your database tool (like DBeaver or MySQL Workbench or CLI).
2. Run the provided SQL script located in: `db/init.sql`.
   - This creates the `sentiment_db` database.
   - This creates the `tweets` table.
   - It also creates the user `sentiment_user` with password `sentiment_pass` which the apps use.

## 🚀 Step 2: Start Kafka
In your project root, there is a `start-kafka-windows.bat` script.
1. Ensure your Kafka installation is extracted inside `C:\kafka\kafka_2.13-3.6.1` (or change the path inside the script).
2. Double-click **`start-kafka-windows.bat`**.
3. It will open two black terminal windows: one for **Zookeeper** and one for **Kafka Server**. Leave both completely open. DO NOT CLOSE THEM.

## 🚀 Step 3: Start Spark NLP Pipeline
Open a new terminal (Command Prompt or PowerShell).
1. Navigate to the spark folder: `cd spark`
2. Install the python dependencies:
   ```cmd
   pip install pyspark numpy pandas
   ```
3. Run the processing stream:
   ```cmd
   python sentiment_analysis.py
   ```
   > Note: This will listen to Kafka `tweet_topic` forever. Leave this window open!

## 🚀 Step 4: Start the Node.js Server
Open a new terminal.
1. Navigate to the backend folder: `cd backend`
2. Install npm packages: `npm install`
3. Run the backend: `npm start`
   > It should say: `Server running on port 3000`, `Kafka producer connected`, and `Kafka consumer reconnected`.

## 🚀 Step 5: Start the React Dashboard
Open one final terminal.
1. Stay in the root folder of the project.
2. Install npm packages: `npm install`
3. Run the frontend: `npm run dev`
4. Open your browser to `http://localhost:5173`.

### 🧪 Testing Real-Time Events
- On the dashboard, as soon as you connect, the Node.js backend starts polling from RSS (like BBC News).
- You can watch the terminals: 
  - The **Node** terminal will print: `RSS item published to Kafka: rss-<id>`
  - The **Spark** terminal will read it, classify it, and push it back.
  - The **Node** terminal will print: `Received sentiment from Kafka: rss-<id> -> positive/negative/neutral`
  - Finally, your Dashboard UI will instantly flash green, red, or gray in real-time as the data simulates live events.
