# Real-Time Spark NLP Sentiment Module

This module is a production-level sentiment analysis pipeline built on PySpark ML.

## Features Added
- **NLTK Preprocessing**: Robust lowercasing, HTML/URL stripping, user mention removal, regex filtering, and Stopword removal/Lemmatization natively integrated.
- **Feature Engineering**: Tokenizer -> Unigram CountVectorizer + IDF -> Bigram CountVectorizer + IDF -> VectorAssembler.
- **Model**: Logistic Regression optimized for fast inference.
- **Thresholding Strategy**: Models trained on `Sentiment140` typically only see Positive (4) and Negative (0). To achieve a True **Neutral** label, the streaming script evaluates the exact class probabilities (`confidence`). Any text with `< 0.60` confidence is gracefully overriden to `Neutral`.

---

## 🚀 How To Deploy

### 1. Requirements Prep
Make sure you have NLTK and its corpora downloaded (the scripts handle this automatically on startup, but you need network access).

### 2. Train the Model (Required First Time)
Since the feature engineering and model weights must be identical in stream inference, you **must train and export the model once**.
Place your `sentiment140.csv` in `spark/data/sentiment140.csv` (or use the `--data` flag).

```bash
cd spark
python train_model.py --sample 0.05 --model LR
```
*(You can use `--sample 0.1` or `1.0` if you want to train on the full dataset, which will take longer but be highly accurate).* 
This will create a pre-trained ML Pipeline in `models/sentiment_model_prod`.

### 3. Start the Kafka Infrastructure
If not already running, start your Zookeeper and Kafka servers in separate terminals using your `start-kafka-windows.bat`.

### 4. Run the Stream Consumer
Once the model is saved to `models/sentiment_model_prod`, start the streaming listener:

```bash
cd spark
python sentiment_analysis.py
```

### 5. Send RSS Feed Data (Testing)
You can directly pipe testing JSONs into the Kafka `tweet_topic` to verify output to the dashboard.
A `data/sample_rss.json` file has been provided to test exact formats.
```bash
# Example if using windows Kafka console producer
kafka-console-producer.bat --broker-list localhost:9092 --topic tweet_topic < data/sample_rss.json
```
