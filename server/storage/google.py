from google.cloud import storage
from io import BytesIO
import os
from .base import BaseStorageClient


class GoogleCloudStorageClient(BaseStorageClient):


    def __init__(self):
        self.client = storage.Client()


    def ls(self, bucket_name, prefix=None, recursive=False):
        return self.client.list_blobs(bucket_name, prefix=prefix)
    

    def put(self, bucket_name, blob_name, data):
        try:
            bucket = self.client.get_bucket(bucket_name)
            blob = bucket.blob(blob_name)
            if hasattr(data, 'read'):
                blob.upload_from_file(data)
            else:
                blob.upload_from_file(BytesIO(data))
        except Exception as e:
            print('Failed to upload file. Reason: %s' % (e))


    def get(self, bucket_name, blob_name):
        try:
            bucket = self.client.get_bucket(bucket_name)
            blob = bucket.blob(blob_name)
            file = BytesIO()
            self.client.download_blob_to_file(blob, file)
            file.seek(0)
            return file
        except Exception as e:
            print('Failed to get blob %s. Reason: %s' % (blob_name, e))


    def fput(self, bucket_name, blob_name, file_path):
        try:
            bucket = self.client.get_bucket(bucket_name)
            blob = bucket.blob(blob_name)
            blob.upload_from_filename(file_path)
        except Exception as e:
            print('Failed to upload file %s. Reason: %s' % (file_path, e))


    def fput_dir(self, bucket_name, prefix, filepath):
        if os.path.exists(filepath) and os.path.isdir(filepath):
            for filename in os.listdir(filepath):
                path = os.path.join(filepath, filename)
                blob_name = f'{prefix}/{filename}'
                try:
                    if os.path.isfile(path) or os.path.islink(path):
                        self.fput(bucket_name, blob_name, path)
                    elif os.path.isdir(path):
                        self.fput_dir(bucket_name, blob_name, path)
                except Exception as e:
                    print('Failed to upload file %s. Reason: %s' % (filepath, e))


    def fget(self, bucket_name, blob_name, file_path):
        try:
            bucket = self.client.get_bucket(bucket_name)
            blob = bucket.blob(blob_name)
            with open(file_path, 'wb') as f:
                self.client.download_blob_to_file(blob, f)
        except Exception as e:
            print('Failed to download file %s. Reason: %s' % (blob_name, e))

    def fget_dir(self, bucket_name, prefix, directory_path):
        try:
            blobs = self.ls(bucket_name, prefix)
            for blob in blobs:
                file_path = os.path.join(directory_path, os.path.relpath(blob.name, prefix)).replace("/", os.sep)
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                self.fget(bucket_name, blob.name, file_path)
        except Exception as e:
            print('Failed to download blobs with prefix %s. Reason: %s' % (prefix, e))


    def copy(self, bucket_name, source_blob_name, destination_blob_name):
        try:
            bucket = self.client.get_bucket(bucket_name)
            source_blob = bucket.blob(source_blob_name)
            bucket.copy_blob(source_blob, bucket, destination_blob_name)
        except Exception as e:
            print('Failed to copy blob %s to %s. Reason: %s' % (source_blob_name, destination_blob_name, e))


    def delete(self, bucket_name, blob_name):
        try:
            bucket = self.client.get_bucket(bucket_name)
            blob = bucket.blob(blob_name)
            blob.delete()
        except Exception as e:
            print('Failed to delete blob %s' % blob_name)


    def delete_dir(self, bucket_name, prefix):
        try:
            blobs = self.ls(bucket_name, prefix)
            for blob in blobs:
                blob.delete()
        except Exception as e:
            print('Failed to remove blobs. Reason: %s' % e)
