"""
Utility functions for Spark sentiment analysis
"""

import re
from pyspark.sql.functions import udf
from pyspark.sql.types import StringType, ArrayType, DoubleType


# Contractions mapping for text expansion
CONTRACTIONS = {
    "ain't": "am not",
    "aren't": "are not",
    "can't": "cannot",
    "couldn't": "could not",
    "didn't": "did not",
    "doesn't": "does not",
    "don't": "do not",
    "hadn't": "had not",
    "hasn't": "has not",
    "haven't": "have not",
    "he'd": "he would",
    "he'll": "he will",
    "he's": "he is",
    "i'd": "i would",
    "i'll": "i will",
    "i'm": "i am",
    "i've": "i have",
    "isn't": "is not",
    "it's": "it is",
    "let's": "let us",
    "mustn't": "must not",
    "shan't": "shall not",
    "she'd": "she would",
    "she'll": "she will",
    "she's": "she is",
    "shouldn't": "should not",
    "that's": "that is",
    "there's": "there is",
    "they'd": "they would",
    "they'll": "they will",
    "they're": "they are",
    "they've": "they have",
    "we'd": "we would",
    "we're": "we are",
    "we've": "we have",
    "weren't": "were not",
    "what'll": "what will",
    "what're": "what are",
    "what's": "what is",
    "what've": "what have",
    "where's": "where is",
    "who'd": "who would",
    "who'll": "who will",
    "who're": "who are",
    "who's": "who is",
    "who've": "who have",
    "won't": "will not",
    "wouldn't": "would not",
    "you'd": "you would",
    "you'll": "you will",
    "you're": "you are",
    "you've": "you have"
}

# Slang and abbreviation mapping
SLANG_MAPPING = {
    "lol": "laughing out loud",
    "lmao": "laughing my ass off",
    "rofl": "rolling on floor laughing",
    "brb": "be right back",
    "btw": "by the way",
    "idk": "i do not know",
    "imo": "in my opinion",
    "imho": "in my humble opinion",
    "tbh": "to be honest",
    "omg": "oh my god",
    "wtf": "what the fuck",
    "wth": "what the hell",
    "smh": "shaking my head",
    "fyi": "for your information",
    "afaik": "as far as i know",
    "iirc": "if i remember correctly",
    "np": "no problem",
    "ty": "thank you",
    "thx": "thanks",
    "pls": "please",
    "plz": "please",
    "u": "you",
    "ur": "your",
    "r": "are",
    "b4": "before",
    "2day": "today",
    "2moro": "tomorrow",
    "gr8": "great",
    "l8r": "later"
}


def expand_contractions(text):
    """Expand contractions in text"""
    if text is None:
        return ""
    
    words = text.lower().split()
    expanded = []
    
    for word in words:
        if word in CONTRACTIONS:
            expanded.append(CONTRACTIONS[word])
        else:
            expanded.append(word)
    
    return ' '.join(expanded)


def expand_slang(text):
    """Expand slang and abbreviations"""
    if text is None:
        return ""
    
    words = text.lower().split()
    expanded = []
    
    for word in words:
        if word in SLANG_MAPPING:
            expanded.append(SLANG_MAPPING[word])
        else:
            expanded.append(word)
    
    return ' '.join(expanded)


def remove_repeated_chars(text):
    """Remove repeated characters (e.g., 'sooooo' -> 'so')"""
    if text is None:
        return ""
    return re.sub(r'(.)\1{2,}', r'\1\1', text)


def clean_text_advanced(text):
    """
    Advanced text cleaning with multiple preprocessing steps
    """
    if text is None:
        return ""
    
    # Decode HTML entities
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&quot;", '"')
    text = text.replace("&#39;", "'")
    
    # Remove URLs
    text = re.sub(r'http\S+|www\S+|https\S+', '', text, flags=re.MULTILINE)
    
    # Remove user mentions
    text = re.sub(r'@\w+', '', text)
    
    # Remove hashtag symbols but keep words
    text = re.sub(r'#(\w+)', r'\1', text)
    
    # Remove RT prefix
    text = re.sub(r'^RT[\s]+', '', text)
    
    # Convert to lowercase
    text = text.lower()
    
    # Expand contractions
    text = expand_contractions(text)
    
    # Expand slang
    text = expand_slang(text)
    
    # Remove repeated characters
    text = remove_repeated_chars(text)
    
    # Remove special characters and numbers
    text = re.sub(r'[^a-zA-Z\s]', '', text)
    
    # Remove extra whitespace
    text = ' '.join(text.split())
    
    return text.strip()


def extract_sentiment_features(text):
    """
    Extract additional sentiment-related features
    Returns: [exclamation_count, question_count, caps_ratio, word_count]
    """
    if text is None:
        return [0.0, 0.0, 0.0, 0.0]
    
    original = text
    
    # Count exclamation marks
    exclamation_count = original.count('!')
    
    # Count question marks
    question_count = original.count('?')
    
    # Calculate caps ratio
    alpha_chars = [c for c in original if c.isalpha()]
    if len(alpha_chars) > 0:
        caps_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
    else:
        caps_ratio = 0.0
    
    # Word count
    word_count = len(original.split())
    
    return [
        float(exclamation_count),
        float(question_count),
        caps_ratio,
        float(word_count)
    ]


# Register UDFs
clean_text_advanced_udf = udf(clean_text_advanced, StringType())
extract_features_udf = udf(extract_sentiment_features, ArrayType(DoubleType()))


def get_sentiment_label(prediction):
    """Convert prediction index to sentiment label"""
    labels = ["negative", "neutral", "positive"]
    try:
        return labels[int(prediction)]
    except:
        return "neutral"


get_sentiment_label_udf = udf(get_sentiment_label, StringType())
