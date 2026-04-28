import os
import sys
import logging
import argparse
import re
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, udf, when
from pyspark.sql.types import StringType
from pyspark.ml import Pipeline
from pyspark.ml.feature import (
    Tokenizer, StopWordsRemover, CountVectorizer, IDF,
    StringIndexer, IndexToString, NGram, VectorAssembler
)
from pyspark.ml.classification import LogisticRegression, NaiveBayes
from pyspark.ml.evaluation import MulticlassClassificationEvaluator

# Explicitly use standard python executable
os.environ["PYSPARK_PYTHON"] = sys.executable
os.environ["PYSPARK_DRIVER_PYTHON"] = sys.executable

# Ensure NLTK resources
import nltk
from nltk.stem import WordNetLemmatizer
from nltk.corpus import stopwords
nltk.download('wordnet', quiet=True)
nltk.download('omw-1.4', quiet=True)
nltk.download('stopwords', quiet=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize lemmatizer and stopwords globally so workers can access them
lemmatizer = WordNetLemmatizer()
english_stops = set(stopwords.words('english'))

def clean_and_lemmatize(text):
    """Robust preprocessing: lowercase, remove URLs/HTML, remove special chars, lemmatize, remove stopwords"""
    if not text or not isinstance(text, str):
        return ""
    
    text = text.lower()
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Remove URLs
    text = re.sub(r'http\S+|www\S+|https\S+', '', text, flags=re.MULTILINE)
    # Remove mentions
    text = re.sub(r'@\w+', '', text)
    # Remove special characters and numbers
    text = re.sub(r'[^a-z\s]', ' ', text)
    
    # Tokenize manually for NLTK lemmatization and quick stopword removal
    words = text.split()
    cleaned_words = [
        lemmatizer.lemmatize(w) for w in words 
        if w not in english_stops and len(w) > 1
    ]
    
    return " ".join(cleaned_words).strip()

# Register UDF
clean_text_udf = udf(clean_and_lemmatize, StringType())

def create_spark_session():
    return (SparkSession.builder
        .appName("SentimentModelTraining_Production")
        .config("spark.driver.memory", "4g")
        .config("spark.executor.memory", "4g")
        .config("spark.sql.shuffle.partitions", "200")
        .getOrCreate())

def load_data(spark, data_path, sample_fraction):
    logger.info(f"Loading Sentiment140 dataset from {data_path}")
    
    df = (spark.read
        .option("header", "false")
        .option("encoding", "ISO-8859-1")
        .csv(data_path)
        .toDF("polarity", "id", "date", "query", "user", "text"))
        
    if sample_fraction < 1.0:
        logger.info(f"Sampling {sample_fraction * 100}% of data for faster training")
        df = df.sample(withReplacement=False, fraction=sample_fraction, seed=42)
        
    # Sentiment140 labels: 0=Negative, 4=Positive
    df = df.withColumn(
        "sentiment",
        when(col("polarity") == "0", "Negative")
        .when(col("polarity") == "4", "Positive")
        .otherwise(None)
    ).dropna(subset=["sentiment"])
    
    # Apply text cleaning
    logger.info("Applying NLTK text preprocessing...")
    df = df.withColumn("cleaned_text", clean_text_udf(col("text")))
    df = df.filter(col("cleaned_text") != "")
    
    logger.info(f"Total training records prepared: {df.count()}")
    return df.select("cleaned_text", "sentiment")

def build_pipeline(model_type="LR"):
    """Builds the feature engineering and modeling pipeline"""
    logger.info("Constructing ML Pipeline...")
    
    # Text tokenization
    tokenizer = Tokenizer(inputCol="cleaned_text", outputCol="words")
    
    # Unigrams Feature Extraction
    cv_unigram = CountVectorizer(inputCol="words", outputCol="tf_unigram", vocabSize=10000, minDF=5.0)
    idf_unigram = IDF(inputCol="tf_unigram", outputCol="tfidf_unigram")
    
    # Bigrams Feature Extraction
    bigram = NGram(n=2, inputCol="words", outputCol="bigrams")
    cv_bigram = CountVectorizer(inputCol="bigrams", outputCol="tf_bigram", vocabSize=5000, minDF=3.0)
    idf_bigram = IDF(inputCol="tf_bigram", outputCol="tfidf_bigram")
    
    # Combine Features
    assembler = VectorAssembler(
        inputCols=["tfidf_unigram", "tfidf_bigram"],
        outputCol="features"
    )
    
    # Label indexing
    label_indexer = StringIndexer(inputCol="sentiment", outputCol="label", handleInvalid="keep")
    
    # Model Selection
    if model_type == "NB":
        logger.info("Using Multinomial Naive Bayes model")
        classifier = NaiveBayes(
            featuresCol="features",
            labelCol="label",
            predictionCol="prediction",
            probabilityCol="probability"
        )
    else:
        logger.info("Using Logistic Regression model")
        classifier = LogisticRegression(
            featuresCol="features",
            labelCol="label",
            predictionCol="prediction",
            probabilityCol="probability",
            maxIter=100,
            regParam=0.01
        )
        
    # Map index back to string
    label_converter = IndexToString(
        inputCol="prediction",
        outputCol="predicted_label",
        labels=label_indexer.fit(
            # Dummy DataFrame to fit StringIndexer only for getting labels
            SparkSession.builder.getOrCreate().createDataFrame([("Negative",), ("Positive",)], ["sentiment"])
        ).labels
    )
    
    pipeline = Pipeline(stages=[
        tokenizer, cv_unigram, idf_unigram,
        bigram, cv_bigram, idf_bigram,
        assembler, label_indexer, classifier, label_converter
    ])
    
    return pipeline

def main():
    parser = argparse.ArgumentParser(description="Professional Sentiment Analysis Training")
    parser.add_argument("--data", type=str, default="data/sentiment140.csv", help="Path to Sentiment140 dataset")
    parser.add_argument("--output", type=str, default="models/sentiment_model_prod", help="Path to save the model")
    parser.add_argument("--sample", type=float, default=0.05, help="Fraction of data to train on")
    parser.add_argument("--model", type=str, choices=["LR", "NB"], default="LR", help="Model type: LR (LogisticRegression) or NB (NaiveBayes)")
    args = parser.parse_args()
    
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")
    
    # Load and prepare data
    df = load_data(spark, args.data, args.sample)
    train_df, test_df = df.randomSplit([0.8, 0.2], seed=42)
    
    pipeline = build_pipeline(args.model)
    
    logger.info("Training Model... This may take several minutes.")
    model = pipeline.fit(train_df)
    
    logger.info("Evaluating Model...")
    predictions = model.transform(test_df)
    evaluator = MulticlassClassificationEvaluator(labelCol="label", predictionCol="prediction", metricName="accuracy")
    accuracy = evaluator.evaluate(predictions)
    logger.info(f"Model Accuracy: {accuracy:.4f}")
    
    # Save the pipeline model natively
    logger.info(f"Saving fully assembled PipelineModel to {args.output}")
    # Clear the labelCol safely before saving if we want to run inference on unlabeled data
    model.stages[-2].set(model.stages[-2].labelCol, "")
    model.write().overwrite().save(args.output)
    logger.info("Model saved successfully! Ready for streaming.")
    
    spark.stop()

if __name__ == "__main__":
    main()
