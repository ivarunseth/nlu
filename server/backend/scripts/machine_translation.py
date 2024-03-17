import pandas as pd

import numpy as np

import typing
from typing import Any, Tuple

import tensorflow as tf
# import tensorflow_text as tf_text


dataset = pd.read_csv('./data/examples/hindi_english_parallel.csv', encoding='utf-8')
print(dataset.head())

X = dataset.iloc[:, 0].values.astype(str)
y = dataset.iloc[:, 1].values.astype(str)

print(f'{X.shape=}')
print(f'{y.shape=}')

BUFFER_SIZE = len(X)
BATCH_SIZE = 64

split = np.random.uniform(size=(len(y),)) < 0.8

train_ds = (
    tf.data.Dataset
    .from_tensor_slices((X[split], y[split]))
    .shuffle(BUFFER_SIZE)
    .batch(BATCH_SIZE))

validation_ds = (
    tf.data.Dataset
    .from_tensor_slices((X[~split], y[~split]))
    .shuffle(BUFFER_SIZE)
    .batch(BATCH_SIZE))

for example_context_strings, example_target_strings in train_ds.take(1):
    print(example_context_strings[:5])
    print()
    print(example_target_strings[:5])
    break