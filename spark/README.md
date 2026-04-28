# Spark Sentiment Analysis Application

Real-time sentiment analysis pipeline using Apache Spark Streaming with NLP and Logistic Regression classifier.

## Architecture

```
RSS Feed → Kafka (tweet_topic) → Spark Streaming → [NLP Pipeline] → Kafka (sentiment_topic)
                                                                  → MariaDB
```

## NLP Pipeline

1. **Text Cleaning**: Remove URLs, mentions, hashtags, special characters
2. **Tokenization**: Split text into words
3. **Stop Words Removal**: Filter common English stop words
4. **TF-IDF Vectorization**: Convert text to numerical features
5. **Logistic Regression**: Classify sentiment (positive/negative/neutral)

## Model Training

The model is trained on the Sentiment140 dataset (1.6M tweets).

### Download Dataset

```bash
# Download from Kaggle or official source
wget http://cs.stanford.edu/people/alecmgo/trainingandtestdata.zip
unzip trainingandtestdata.zip
mv training.1600000.processed.noemoticon.csv data/sentiment140.csv
```

### Train Model

```bash
spark-submit \
  --master local[*] \
  --driver-memory 4g \
  train_model.py \
  --data data/sentiment140.csv \
  --output models/sentiment_model \
  --sample 0.1  # Optional: use 10% for faster training
```

With cross-validation:

```bash
spark-submit \
  --master local[*] \
  --driver-memory 8g \
  train_model.py \
  --data data/sentiment140.csv \
  --output models/sentiment_model \
  --cv
```

## Running the Stream Processor

### Local Development

```bash
spark-submit \
  --master local[*] \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,org.mariadb.jdbc:mariadb-java-client:3.2.0 \
  sentiment_analysis.py
```


## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| KAFKA_BROKERS | localhost:9092 | Kafka broker addresses |
| KAFKA_TWEET_TOPIC | tweet_topic | Input topic for tweets |
| KAFKA_SENTIMENT_TOPIC | sentiment_topic | Output topic for results |
| DB_HOST | localhost | MariaDB host |
| DB_PORT | 3306 | MariaDB port |
| DB_USER | sentiment_user | Database username |
| DB_PASSWORD | sentiment_pass | Database password |
| DB_NAME | sentiment_db | Database name |
| MODEL_PATH | /app/models/sentiment_model | Path to saved model |
| CHECKPOINT_PATH | /app/checkpoints | Spark checkpoint directory |

## Model Performance

Expected metrics on Sentiment140:
- **Accuracy**: ~78-82%
- **F1 Score**: ~0.78-0.82

## Customization


### Adjusting TF-IDF Parameters

In `train_model.py`:

```python
hashing_tf = HashingTF(
    inputCol="filtered_words", 
    outputCol="raw_features",
    numFeatures=20000  # Increase for better accuracy
)
```

### Tuning Logistic Regression

```python
lr = LogisticRegression(
    maxIter=200,        # More iterations
    regParam=0.001,     # Less regularization
    elasticNetParam=0.5 # Mix of L1 and L2
)
```
