"""
Model Training Script for Sentiment Analysis
Trains Logistic Regression classifier on Sentiment140 dataset
"""

import os
import sys
import logging
import argparse
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, when, udf
from pyspark.sql.types import StringType
from pyspark.ml import Pipeline
from pyspark.ml.feature import (
    Tokenizer, StopWordsRemover, HashingTF, IDF,
    StringIndexer, IndexToString
)
from pyspark.ml.classification import LogisticRegression
from pyspark.ml.evaluation import MulticlassClassificationEvaluator
from pyspark.ml.tuning import ParamGridBuilder, CrossValidator
import re

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def create_spark_session():
    """Create Spark session for training"""
    return (SparkSession.builder
        .appName("SentimentModelTraining")
        .config("spark.driver.memory", "4g")
        .config("spark.executor.memory", "4g")
        .config("spark.sql.shuffle.partitions", "200")
        .getOrCreate())


def clean_text(text):
    """Comprehensive text cleaning for tweets"""
    if text is None:
        return ""
    
    # Decode HTML entities
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&quot;", '"')
    
    # Remove URLs
    text = re.sub(r'http\S+|www\S+|https\S+', '', text, flags=re.MULTILINE)
    
    # Remove user mentions
    text = re.sub(r'@\w+', '', text)
    
    # Remove hashtag symbols but keep words
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


clean_text_udf = udf(clean_text, StringType())


def load_sentiment140(spark, data_path, sample_fraction=None):
    """
    Load Sentiment140 dataset
    
    Dataset format (no header):
    0 - polarity (0=negative, 2=neutral, 4=positive)
    1 - tweet id
    2 - date
    3 - query
    4 - user
    5 - text
    """
    logger.info(f"Loading dataset from {data_path}")
    
    df = (spark.read
        .option("header", "false")
        .option("encoding", "ISO-8859-1")
        .csv(data_path)
        .toDF("polarity", "id", "date", "query", "user", "text"))
    
    # Sample if specified (for faster training/testing)
    if sample_fraction:
        df = df.sample(fraction=sample_fraction, seed=42)
        logger.info(f"Sampled {sample_fraction*100}% of data")
    
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
    df = df.filter(col("cleaned_text").isNotNull())
    
    # Select relevant columns
    df = df.select("cleaned_text", "sentiment", "text")
    
    logger.info(f"Loaded {df.count()} samples")
    
    # Show class distribution
    logger.info("Class distribution:")
    df.groupBy("sentiment").count().show()
    
    return df


def create_pipeline(num_features=10000):
    """Create ML pipeline"""
    
    # Tokenization
    tokenizer = Tokenizer(
        inputCol="cleaned_text", 
        outputCol="words"
    )
    
    # Remove stop words
    remover = StopWordsRemover(
        inputCol="words", 
        outputCol="filtered_words"
    )
    
    # Term frequency with hashing
    hashing_tf = HashingTF(
        inputCol="filtered_words", 
        outputCol="raw_features",
        numFeatures=num_features
    )
    
    # IDF
    idf = IDF(
        inputCol="raw_features", 
        outputCol="features",
        minDocFreq=5
    )
    
    # Label indexer
    label_indexer = StringIndexer(
        inputCol="sentiment", 
        outputCol="label",
        handleInvalid="keep"
    )
    
    # Logistic Regression
    lr = LogisticRegression(
        featuresCol="features",
        labelCol="label",
        predictionCol="prediction",
        probabilityCol="probability",
        maxIter=100,
        regParam=0.01,
        elasticNetParam=0.8
    )
    
    # Convert prediction back to label
    label_converter = IndexToString(
        inputCol="prediction",
        outputCol="predicted_sentiment",
        labels=["negative", "neutral", "positive"]
    )
    
    pipeline = Pipeline(stages=[
        tokenizer,
        remover,
        hashing_tf,
        idf,
        label_indexer,
        lr,
        label_converter
    ])
    
    return pipeline


def train_with_cross_validation(pipeline, train_df):
    """Train with cross-validation for hyperparameter tuning"""
    
    # Get logistic regression stage
    lr = pipeline.getStages()[-2]
    
    # Parameter grid
    param_grid = (ParamGridBuilder()
        .addGrid(lr.regParam, [0.001, 0.01, 0.1])
        .addGrid(lr.elasticNetParam, [0.0, 0.5, 0.8, 1.0])
        .build())
    
    # Evaluator
    evaluator = MulticlassClassificationEvaluator(
        labelCol="label",
        predictionCol="prediction",
        metricName="accuracy"
    )
    
    # Cross validator
    cv = CrossValidator(
        estimator=pipeline,
        estimatorParamMaps=param_grid,
        evaluator=evaluator,
        numFolds=3,
        parallelism=2
    )
    
    logger.info("Starting cross-validation training...")
    cv_model = cv.fit(train_df)
    
    logger.info(f"Best model params: {cv_model.bestModel.stages[-2].extractParamMap()}")
    
    return cv_model.bestModel


def evaluate_model(model, test_df):
    """Evaluate model performance"""
    predictions = model.transform(test_df)
    
    # Accuracy
    accuracy_evaluator = MulticlassClassificationEvaluator(
        labelCol="label",
        predictionCol="prediction",
        metricName="accuracy"
    )
    accuracy = accuracy_evaluator.evaluate(predictions)
    
    # Precision
    precision_evaluator = MulticlassClassificationEvaluator(
        labelCol="label",
        predictionCol="prediction",
        metricName="weightedPrecision"
    )
    precision = precision_evaluator.evaluate(predictions)
    
    # Recall
    recall_evaluator = MulticlassClassificationEvaluator(
        labelCol="label",
        predictionCol="prediction",
        metricName="weightedRecall"
    )
    recall = recall_evaluator.evaluate(predictions)
    
    # F1 Score
    f1_evaluator = MulticlassClassificationEvaluator(
        labelCol="label",
        predictionCol="prediction",
        metricName="f1"
    )
    f1 = f1_evaluator.evaluate(predictions)
    
    logger.info("=" * 50)
    logger.info("Model Evaluation Results:")
    logger.info(f"  Accuracy:  {accuracy:.4f}")
    logger.info(f"  Precision: {precision:.4f}")
    logger.info(f"  Recall:    {recall:.4f}")
    logger.info(f"  F1 Score:  {f1:.4f}")
    logger.info("=" * 50)
    
    # Show confusion matrix
    logger.info("\nPrediction Distribution:")
    predictions.groupBy("sentiment", "predicted_sentiment").count().show()
    
    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1
    }


def main():
    parser = argparse.ArgumentParser(description="Train sentiment analysis model")
    parser.add_argument("--data", type=str, required=True, help="Path to Sentiment140 CSV")
    parser.add_argument("--output", type=str, required=True, help="Path to save model")
    parser.add_argument("--sample", type=float, default=None, help="Sample fraction (0-1)")
    parser.add_argument("--cv", action="store_true", help="Use cross-validation")
    parser.add_argument("--features", type=int, default=10000, help="Number of TF features")
    
    args = parser.parse_args()
    
    # Create Spark session
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")
    
    logger.info("=" * 60)
    logger.info("Sentiment Analysis Model Training")
    logger.info("=" * 60)
    
    # Load data
    df = load_sentiment140(spark, args.data, args.sample)
    
    # Split data
    train_df, test_df = df.randomSplit([0.8, 0.2], seed=42)
    logger.info(f"Training samples: {train_df.count()}")
    logger.info(f"Test samples: {test_df.count()}")
    
    # Create pipeline
    pipeline = create_pipeline(args.features)
    
    # Train model
    if args.cv:
        model = train_with_cross_validation(pipeline, train_df)
    else:
        logger.info("Training model...")
        model = pipeline.fit(train_df)
    
    # Evaluate
    metrics = evaluate_model(model, test_df)
    
    # Save model
    logger.info(f"Saving model to {args.output}")
    model.write().overwrite().save(args.output)
    
    # Save metrics
    metrics_path = os.path.join(args.output, "metrics.json")
    import json
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)
    
    logger.info("Training complete!")
    
    spark.stop()


if __name__ == "__main__":
    main()
