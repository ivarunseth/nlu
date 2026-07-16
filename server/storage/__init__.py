import os
import shutil
import io

from functools import wraps

from .akamai import NetstorageClient
from .azure import AzureStorageClient
from .ftp import FTPClient
from .google import GoogleCloudStorageClient
from .minio import MinioClient
from .s3 import S3Client
from .sftp import SFTPClient

from ..utils.common import zip_file


def retry(max_retries=3):
    def decorator(f):
        @wraps(f)
        def wrapper(self, *args, **kwargs):
            retries = 0
            while retries < max_retries:
                try:
                    return f(self, *args, **kwargs)
                except Exception as e:
                    retries += 1
                    print(f"Error: {e}. Retrying {retries}/{max_retries}...")
                    if self.client:
                        self.init_client()
                    if retries >= max_retries:
                        raise
        return wrapper
    return decorator


class Storage:

    _clients = {
        'akamai': NetstorageClient,
        'azure': AzureStorageClient,
        'ftp': FTPClient,
        'google': GoogleCloudStorageClient,
        'minio': MinioClient,
        's3': S3Client,
        'sftp': SFTPClient,
        'local': None
    }

    def __init__(self, app=None):
        self.client = None
        if app is not None:
            self.init_app(app)
        else:
            self.provider = os.getenv('STORAGE_PROVIDER', 'local')
            self.init_client()

    def init_app(self, app):
        self.provider = app.config.get('STORAGE_PROVIDER', 'local')
        self.init_client()
    
    def init_client(self):
        if self.provider in self._clients:
            client_class = self._clients[self.provider]
            if client_class is not None:
                self.client = client_class()
        else:
            raise ValueError(f"Invalid option for storage provider: {self.provider}. "
                             f"Supported providers are {', '.join(self._clients.keys())}.")

    def _get_local_path(self, bucket, object_name):
        return os.path.join(os.getcwd(), *bucket.split('/'), *object_name.split('/'))

    @retry()
    def put(self, bucket, object_name, data):       
        if self.provider == 'local':
            filepath = self._get_local_path(bucket, object_name)
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, 'wb') as f:
                if hasattr(data, 'read'):
                    f.write(data.read())
                elif hasattr(data, 'getbuffer'):
                    f.write(data.getbuffer())
                else:
                    f.write(data)
        else:
            self.client.put(bucket, object_name, data)

    @retry()
    def fput(self, bucket, object_name, filepath):
        if self.provider == 'local':
            target_path = self._get_local_path(bucket, object_name)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            shutil.copy2(filepath, target_path)
        else:
            self.client.fput(bucket, object_name, filepath)

    @retry()
    def get(self, bucket, object_name):
        if self.provider == 'local':
            filepath = self._get_local_path(bucket, object_name)
            if os.path.exists(filepath):
                if os.path.isfile(filepath) or os.path.islink(filepath):
                    with open(filepath, 'rb') as f:
                        return io.BytesIO(f.read())
                elif os.path.isdir(filepath):
                    return zip_file(filepath)
            return None
        else:
            return self.client.get(bucket, object_name)

    @retry()
    def fget(self, bucket, object_name, filepath):
        if self.provider == 'local':
            source_path = self._get_local_path(bucket, object_name)
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            shutil.copy2(source_path, filepath)
        else:
            self.client.fget(bucket, object_name, filepath)

    @retry()
    def fput_dir(self, bucket, prefix, directory_path):
        if self.provider == 'local':
            target_dir = os.path.join(os.getcwd(), bucket, prefix)
            if os.path.exists(target_dir):
                shutil.rmtree(target_dir)
            shutil.copytree(directory_path, target_dir)
        else:
            self.client.fput_dir(bucket, prefix, directory_path)

    @retry()
    def fget_dir(self, bucket, prefix, directory_path):
        if self.provider == 'local':
            source_dir = os.path.join(os.getcwd(), bucket, prefix)
            if os.path.exists(directory_path):
                shutil.rmtree(directory_path)
            shutil.copytree(source_dir, directory_path)
        else:
            self.client.fget_dir(bucket, prefix, directory_path)

    @retry()
    def copy(self, bucket, source, destination):
        if self.provider == 'local':
            src_path = self._get_local_path(bucket, source)
            dst_path = self._get_local_path(bucket, destination)
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            shutil.copy2(src_path, dst_path)
        else:
            self.client.copy(bucket, source, destination)

    @retry()
    def delete(self, bucket, object_name):
        if self.provider == 'local':
            path = self._get_local_path(bucket, object_name)
            if os.path.isfile(path) or os.path.islink(path):
                os.unlink(path)
        else:
            self.client.delete(bucket, object_name)

    @retry()
    def delete_dir(self, bucket, prefix):
        if self.provider == 'local':
            path = os.path.join(os.getcwd(), bucket, prefix)
            if os.path.exists(path) and os.path.isdir(path):
                shutil.rmtree(path)
        else:
            self.client.delete_dir(bucket, prefix)

    @retry()
    def ls(self, bucket, prefix, recursive=False):
        if self.provider == 'local':
            path = os.path.join(os.getcwd(), bucket, prefix)
            if not os.path.exists(path):
                return []
            if recursive:
                files = []
                for root, dirs, filenames in os.walk(path):
                    for filename in filenames:
                        files.append(os.path.relpath(os.path.join(root, filename), path))
                return files
            else:
                return os.listdir(path)
        else:
            return self.client.ls(bucket, prefix, recursive=recursive)
