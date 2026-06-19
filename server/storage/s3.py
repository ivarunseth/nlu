import boto3
import os
import io
from .base import BaseStorageClient

class S3Client(BaseStorageClient):
    def __init__(self):
        self.client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_REGION')
        )

    def ls(self, bucket, prefix, recursive=False):
        response = self.client.list_objects_v2(Bucket=bucket, Prefix=prefix)
        return [obj['Key'] for obj in response.get('Contents', [])]
    
    def put(self, bucket, object_name, data):
        if not hasattr(data, 'read'):
            data = io.BytesIO(data)
        self.client.upload_fileobj(data, bucket, object_name)

    def fput(self, bucket, object_name, filepath):
        self.client.upload_file(filepath, bucket, object_name)

    def get(self, bucket, object_name):
        buffer = io.BytesIO()
        self.client.download_fileobj(bucket, object_name, buffer)
        buffer.seek(0)
        return buffer

    def fget(self, bucket, object_name, filepath):
        self.client.download_file(bucket, object_name, filepath)

    def fput_dir(self, bucket, prefix, directory_path):
        for root, dirs, files in os.walk(directory_path):
            for file in files:
                local_path = os.path.join(root, file)
                relative_path = os.path.relpath(local_path, directory_path)
                s3_path = os.path.join(prefix, relative_path).replace(os.sep, '/')
                self.fput(bucket, s3_path, local_path)

    def fget_dir(self, bucket, prefix, directory_path):
        paginator = self.client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                s3_path = obj['Key']
                relative_path = os.path.relpath(s3_path, prefix)
                local_path = os.path.join(directory_path, relative_path).replace('/', os.sep)
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                self.fget(bucket, s3_path, local_path)

    def copy(self, bucket, source, destination):
        copy_source = {'Bucket': bucket, 'Key': source}
        self.client.copy(copy_source, bucket, destination)

    def delete(self, bucket, object_name):
        self.client.delete_object(Bucket=bucket, Key=object_name)

    def delete_dir(self, bucket, prefix):
        paginator = self.client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            delete_objs = [{'Key': obj['Key']} for obj in page.get('Contents', [])]
            if delete_objs:
                self.client.delete_objects(Bucket=bucket, Delete={'Objects': delete_objs})
