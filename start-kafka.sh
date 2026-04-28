#!/bin/bash

echo "========================================"
echo "Starting Kafka (Mac/Linux)"
echo "========================================"
echo ""
echo "This script will start Zookeeper and Kafka."
echo "Keep both terminals open!"
echo ""

# Check if Kafka directory exists
if [ ! -d "$HOME/kafka" ] && [ ! -d "/opt/kafka" ]; then
    echo "ERROR: Kafka not found!"
    echo "Expected location: ~/kafka or /opt/kafka"
    echo "Please install Kafka first. See SETUP_GUIDE.md"
    exit 1
fi

# Determine Kafka path
KAFKA_PATH=""
if [ -d "$HOME/kafka" ]; then
    KAFKA_PATH="$HOME/kafka"
elif [ -d "/opt/kafka" ]; then
    KAFKA_PATH="/opt/kafka"
fi

echo "Starting Zookeeper..."
gnome-terminal -- bash -c "cd $KAFKA_PATH && bin/zookeeper-server-start.sh config/zookeeper.properties; exec bash" 2>/dev/null || \
xterm -e "cd $KAFKA_PATH && bin/zookeeper-server-start.sh config/zookeeper.properties; exec bash" 2>/dev/null || \
osascript -e "tell app \"Terminal\" to do script \"cd $KAFKA_PATH && bin/zookeeper-server-start.sh config/zookeeper.properties\"" 2>/dev/null || \
echo "Please start Zookeeper manually in a new terminal:"
echo "  cd $KAFKA_PATH"
echo "  bin/zookeeper-server-start.sh config/zookeeper.properties"

echo "Waiting 10 seconds for Zookeeper to start..."
sleep 10

echo "Starting Kafka..."
gnome-terminal -- bash -c "cd $KAFKA_PATH && bin/kafka-server-start.sh config/server.properties; exec bash" 2>/dev/null || \
xterm -e "cd $KAFKA_PATH && bin/kafka-server-start.sh config/server.properties; exec bash" 2>/dev/null || \
osascript -e "tell app \"Terminal\" to do script \"cd $KAFKA_PATH && bin/kafka-server-start.sh config/server.properties\"" 2>/dev/null || \
echo "Please start Kafka manually in a new terminal:"
echo "  cd $KAFKA_PATH"
echo "  bin/kafka-server-start.sh config/server.properties"

echo ""
echo "========================================"
echo "Kafka started!"
echo "========================================"
echo ""
echo "Two new terminals should have opened:"
echo "- Terminal 1: Zookeeper"
echo "- Terminal 2: Kafka"
echo ""
echo "Keep both terminals open!"
echo ""
echo "To stop Kafka, press Ctrl+C in each terminal."
echo ""
