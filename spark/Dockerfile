FROM apache/spark:3.5.0-python3

USER root

# Install Python dependencies
RUN pip install --no-cache-dir \
    pyspark==3.5.0 \
    kafka-python==2.0.2 \
    pymysql==1.1.0 \
    numpy==1.24.3

# Create directories
RUN mkdir -p /app/models /app/data /app/checkpoints /app/logs

# Copy application files
COPY *.py /app/
COPY requirements.txt /app/

WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV SPARK_HOME=/opt/spark
ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

# Download Kafka connector JARs
RUN mkdir -p /opt/spark/jars && \
    curl -L https://repo1.maven.org/maven2/org/apache/spark/spark-sql-kafka-0-10_2.12/3.5.0/spark-sql-kafka-0-10_2.12-3.5.0.jar \
    -o /opt/spark/jars/spark-sql-kafka-0-10_2.12-3.5.0.jar && \
    curl -L https://repo1.maven.org/maven2/org/apache/kafka/kafka-clients/3.5.0/kafka-clients-3.5.0.jar \
    -o /opt/spark/jars/kafka-clients-3.5.0.jar && \
    curl -L https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.2.0/mariadb-java-client-3.2.0.jar \
    -o /opt/spark/jars/mariadb-java-client-3.2.0.jar && \
    curl -L https://repo1.maven.org/maven2/org/apache/spark/spark-token-provider-kafka-0-10_2.12/3.5.0/spark-token-provider-kafka-0-10_2.12-3.5.0.jar \
    -o /opt/spark/jars/spark-token-provider-kafka-0-10_2.12-3.5.0.jar && \
    curl -L https://repo1.maven.org/maven2/org/apache/commons/commons-pool2/2.11.1/commons-pool2-2.11.1.jar \
    -o /opt/spark/jars/commons-pool2-2.11.1.jar

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -f "spark" || exit 1

# Default command
CMD ["spark-submit", \
    "--master", "spark://spark-master:7077", \
    "--deploy-mode", "client", \
    "--driver-memory", "2g", \
    "--executor-memory", "2g", \
    "--packages", "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,org.mariadb.jdbc:mariadb-java-client:3.2.0", \
    "/app/sentiment_analysis.py"]
