"""
Spark Streaming Sentiment Analysis Application
Real-time sentiment classification using NLP pipeline with Logistic Regression
"""

import os
import json
import re
import logging
from datetime import datetime

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, from_json, to_json, struct, udf, current_timestamp,
    when, lit, lower, regexp_replace, trim
)
from pyspark.sql.types import (
    StructType, StructField, StringType, LongType, 
    DoubleType, TimestampType, MapType
)
from pyspark.ml import Pipeline, PipelineModel
from pyspark.ml.feature import (
    Tokenizer, StopWordsRemover, HashingTF, IDF,
    StringIndexer, IndexToString
)
from pyspark.ml.classification import LogisticRegression
from pyspark.ml.evaluation import MulticlassClassificationEvaluator

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration from environment
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka-service:9092")
KAFKA_TWEET_TOPIC = os.getenv("KAFKA_TWEET_TOPIC", "tweet_topic")
KAFKA_SENTIMENT_TOPIC = os.getenv("KAFKA_SENTIMENT_TOPIC", "sentiment_topic")
DB_HOST = os.getenv("DB_HOST", "mariadb-service")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_USER = os.getenv("DB_USER", "sentiment_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "sentiment_pass")
DB_NAME = os.getenv("DB_NAME", "sentiment_db")
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/sentiment_model")
CHECKPOINT_PATH = os.getenv("CHECKPOINT_PATH", "/app/checkpoints")

# Tweet schema for Kafka messages
TWEET_SCHEMA = StructType([
    StructField("id", StringType(), True),
    StructField("text", StringType(), True),
    StructField("author_id", StringType(), True),
    StructField("topic", StringType(), True),
    StructField("created_at", StringType(), True),
    StructField("timestamp", LongType(), True),
    StructField("author", MapType(StringType(), StringType()), True),
    StructField("metrics", MapType(StringType(), LongType()), True)
])


def create_spark_session():
    """Create and configure Spark session"""
    return (SparkSession.builder
        .appName("SentimentAnalysis")
        .config("spark.streaming.kafka.consumer.cache.enabled", "false")
        .config("spark.sql.streaming.checkpointLocation", CHECKPOINT_PATH)
        .config("spark.jars.packages", 
                "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,"
                "org.mariadb.jdbc:mariadb-java-client:3.2.0")
        .config("spark.executor.memory", "2g")
        .config("spark.driver.memory", "2g")
        .getOrCreate())


def clean_text(text):
    """
    Clean and preprocess tweet text
    - Remove URLs, mentions, hashtags, special characters
    - Convert to lowercase
    - Remove extra whitespace
    """
    if text is None:
        return ""
    
    # Remove URLs
    text = re.sub(r'http\S+|www\S+|https\S+', '', text, flags=re.MULTILINE)
    
    # Remove user mentions
    text = re.sub(r'@\w+', '', text)
    
    # Remove hashtag symbols (keep the word)
    text = re.sub(r'#', '', text)
    
    # Remove RT prefix
    text = re.sub(r'^RT[\s]+', '', text)
    
    # Remove special characters and numbers
    text = re.sub(r'[^a-zA-Z\s]', '', text)
    
    # Convert to lowercase
    text = text.lower()
    
    # Remove extra whitespace
    text = ' '.join(text.split())
    
    return text.strip()


# Register UDF for text cleaning
clean_text_udf = udf(clean_text, StringType())


def load_sentiment140_data(spark, data_path="/app/data/sentiment140.csv"):
    """
    Load and prepare Sentiment140 dataset for training
    Dataset format: polarity, id, date, query, user, text
    Polarity: 0 = negative, 2 = neutral, 4 = positive
    """
    logger.info(f"Loading training data from {data_path}")
    
    try:
        # Load CSV with specific schema
        df = (spark.read
            .option("header", "false")
            .option("inferSchema", "false")
            .csv(data_path)
            .toDF("polarity", "id", "date", "query", "user", "text"))
        
        # Map polarity to sentiment labels
        df = df.withColumn(
            "sentiment",
            when(col("polarity") == "0", "negative")
            .when(col("polarity") == "2", "neutral")
            .when(col("polarity") == "4", "positive")
            .otherwise("neutral")
        )
        
        # Clean text
        df = df.withColumn("cleaned_text", clean_text_udf(col("text")))
        
        # Filter empty texts
        df = df.filter(col("cleaned_text") != "")
        
        logger.info(f"Loaded {df.count()} training samples")
        return df.select("cleaned_text", "sentiment")
        
    except Exception as e:
        logger.error(f"Error loading training data: {e}")
        raise


def create_ml_pipeline():
    """
    Create ML pipeline with:
    1. Tokenizer
    2. Stop words remover
    3. TF-IDF vectorization
    4. Logistic Regression classifier
    """
    # Tokenization
    tokenizer = Tokenizer(inputCol="cleaned_text", outputCol="words")
    
    # Remove stop words
    stopwords_remover = StopWordsRemover(
        inputCol="words", 
        outputCol="filtered_words"
    )
    
    # Term Frequency (Hashing TF)
    hashing_tf = HashingTF(
        inputCol="filtered_words", 
        outputCol="raw_features",
        numFeatures=10000
    )
    
    # Inverse Document Frequency
    idf = IDF(
        inputCol="raw_features", 
        outputCol="features",
        minDocFreq=5
    )
    
    # String indexer for labels
    label_indexer = StringIndexer(
        inputCol="sentiment", 
        outputCol="label",
        handleInvalid="keep"
    )
    
    # Logistic Regression classifier
    lr = LogisticRegression(
        maxIter=100,
        regParam=0.01,
        elasticNetParam=0.8,
        featuresCol="features",
        labelCol="label",
        predictionCol="prediction",
        probabilityCol="probability"
    )
    
    # Index to string for predictions
    label_converter = IndexToString(
        inputCol="prediction",
        outputCol="predicted_sentiment",
        labels=["negative", "neutral", "positive"]
    )
    
    # Create pipeline
    pipeline = Pipeline(stages=[
        tokenizer,
        stopwords_remover,
        hashing_tf,
        idf,
        label_indexer,
        lr,
        label_converter
    ])
    
    return pipeline


def train_model(spark, save_path=MODEL_PATH):
    """Train sentiment analysis model on Sentiment140 dataset"""
    logger.info("Starting model training...")
    
    # Load training data
    training_data = load_sentiment140_data(spark)
    
    # Split data
    train_df, test_df = training_data.randomSplit([0.8, 0.2], seed=42)
    
    logger.info(f"Training samples: {train_df.count()}")
    logger.info(f"Test samples: {test_df.count()}")
    
    # Create and train pipeline
    pipeline = create_ml_pipeline()
    model = pipeline.fit(train_df)
    
    # Evaluate model
    predictions = model.transform(test_df)
    evaluator = MulticlassClassificationEvaluator(
        labelCol="label",
        predictionCol="prediction",
        metricName="accuracy"
    )
    accuracy = evaluator.evaluate(predictions)
    
    logger.info(f"Model accuracy: {accuracy:.4f}")
    
    # Save model
    model.write().overwrite().save(save_path)
    logger.info(f"Model saved to {save_path}")
    
    return model


def load_model(model_path=MODEL_PATH):
    """Load pre-trained sentiment model"""
    try:
        model = PipelineModel.load(model_path)
        logger.info(f"Model loaded from {model_path}")
        return model
    except Exception as e:
        logger.error(f"Error loading model: {e}")
        return None


def get_confidence(probability, prediction):
    """Extract confidence score from probability vector"""
    if probability is None:
        return 0.0
    try:
        return float(probability[int(prediction)])
    except:
        return 0.0


get_confidence_udf = udf(get_confidence, DoubleType())


def process_stream(spark, model):
    """
    Process tweet stream from Kafka
    Apply sentiment analysis and write results
    """
    logger.info("Starting stream processing...")
    
    # Read from Kafka
    kafka_df = (spark
        .readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKERS)
        .option("subscribe", KAFKA_TWEET_TOPIC)
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .load())
    
    # Parse JSON messages
    parsed_df = (kafka_df
        .selectExpr("CAST(value AS STRING) as json_str")
        .select(from_json(col("json_str"), TWEET_SCHEMA).alias("data"))
        .select("data.*"))
    
    # Clean text
    cleaned_df = parsed_df.withColumn(
        "cleaned_text", 
        clean_text_udf(col("text"))
    ).filter(col("cleaned_text") != "")
    
    # Apply sentiment model
    predictions_df = model.transform(cleaned_df)
    
    # Add confidence score
    result_df = predictions_df.withColumn(
        "confidence",
        get_confidence_udf(col("probability"), col("prediction"))
    )
    
    # Select output columns
    output_df = result_df.select(
        col("id").alias("tweet_id"),
        col("text"),
        col("cleaned_text"),
        col("author_id"),
        col("topic"),
        col("predicted_sentiment").alias("sentiment"),
        col("confidence"),
        col("created_at"),
        current_timestamp().alias("processed_at")
    )
    
    # Write to Kafka (sentiment results)
    kafka_query = (output_df
        .select(
            col("tweet_id").alias("key"),
            to_json(struct("*")).alias("value")
        )
        .writeStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKERS)
        .option("topic", KAFKA_SENTIMENT_TOPIC)
        .option("checkpointLocation", f"{CHECKPOINT_PATH}/kafka")
        .outputMode("append")
        .start())
    
    # Write to MariaDB
    def write_to_db(batch_df, batch_id):
        """Write batch to MariaDB"""
        if batch_df.count() > 0:
            jdbc_url = f"jdbc:mariadb://{DB_HOST}:{DB_PORT}/{DB_NAME}"
            
            (batch_df.write
                .format("jdbc")
                .option("url", jdbc_url)
                .option("dbtable", "tweets")
                .option("user", DB_USER)
                .option("password", DB_PASSWORD)
                .option("driver", "org.mariadb.jdbc.Driver")
                .mode("append")
                .save())
            
            logger.info(f"Batch {batch_id}: Wrote {batch_df.count()} records to database")
    
    # Prepare data for database
    db_df = output_df.select(
        col("tweet_id"),
        col("text"),
        col("author_id"),
        lit(None).alias("author_username"),
        lit(None).alias("author_name"),
        col("topic"),
        col("sentiment"),
        col("confidence"),
        col("created_at")
    )
    
    db_query = (db_df
        .writeStream
        .foreachBatch(write_to_db)
        .option("checkpointLocation", f"{CHECKPOINT_PATH}/db")
        .outputMode("append")
        .start())
    
    # Wait for queries
    kafka_query.awaitTermination()
    db_query.awaitTermination()


def main():
    """Main entry point"""
    logger.info("=" * 60)
    logger.info("Starting Spark Sentiment Analysis Application")
    logger.info("=" * 60)
    
    # Create Spark session
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")
    
    logger.info(f"Spark version: {spark.version}")
    logger.info(f"Kafka brokers: {KAFKA_BROKERS}")
    logger.info(f"Tweet topic: {KAFKA_TWEET_TOPIC}")
    logger.info(f"Sentiment topic: {KAFKA_SENTIMENT_TOPIC}")
    
    # Try to load existing model, or train new one
    model = load_model()
    
    if model is None:
        logger.info("No existing model found, training new model...")
        model = train_model(spark)
    
    # Start stream processing
    process_stream(spark, model)
    
    # Keep application running
    spark.streams.awaitAnyTermination()


if __name__ == "__main__":
    main()
