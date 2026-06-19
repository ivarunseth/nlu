import paramiko
import pysftp
import os
import io
from .base import BaseStorageClient


class SFTPClient(BaseStorageClient):

    def __init__(self) -> None:
        self.cnopts = pysftp.CnOpts(knownhosts=os.getenv('SFTP_KNOWNHOSTS', './config/sftp_hosts'))
        self.cnopts.hostkeys = None
        self.client = None
        self.client = pysftp.Connection(
            host=os.getenv('SFTP_HOST', None),
            username=os.getenv('SFTP_USER', None),
            private_key=os.getenv('SFTP_KEY', None),
            cnopts=self.cnopts
        )


    def ls(self, bucket, prefix='', recursive=False):
        try:
            files = []
            if self.client.isfile(f'{bucket}/{prefix}'):
                files = [prefix.split('/')[-1]]
            else:
                files = self.client.listdir(f'{bucket}/{prefix}')
        except FileNotFoundError:
            files = []
        finally:
            return files
    

    def isfile(self, bucket, object_name):
        return self.client.isfile(f'{bucket}/{object_name}')
    

    def fput(self, bucket, object_name, filepath):
        self.client.makedirs(os.path.dirname(f'{bucket}/{object_name}'))
        self.client.put(filepath, f'{bucket}/{object_name}', preserve_mtime=True)


    def fput_dir(self, bucket, prefix, filepath):
        if os.path.exists(filepath) and os.path.isdir(filepath):
            for filename in os.listdir(filepath):
                path = os.path.join(filepath, filename)
                object_name = f'{prefix}/{filename}'
                try:
                    if os.path.isfile(path) or os.path.islink(path):
                        self.fput(bucket, object_name, path)
                    elif os.path.isdir(path):
                        self.fput_dir(bucket, object_name, path)
                except Exception as e:
                    print('Failed to upload file %s. Reason: %s' % (filepath, e))


    def put(self, bucket, object_name, data):
        if not hasattr(data, 'read'):
            data = io.BytesIO(data)
        self.client.makedirs(os.path.dirname(f'{bucket}/{object_name}'))
        self.client.putfo(data, f'{bucket}/{object_name}')


    def fget(self, bucket, object_name, filepath):
        self.client.get(f'{bucket}/{object_name}', filepath, preserve_mtime=True)


    def fget_dir(self, bucket, prefix, filepath):
        for object_name in self.ls(bucket, prefix):
            if self.isfile(bucket, f'{prefix}/{object_name}'):
                self.fget(bucket, f'{prefix}/{object_name}', os.path.join(filepath, object_name))
            else:
                self.fget_dir(bucket, f'{prefix}/{object_name}', os.path.join(filepath, object_name))


    def get(self, bucket, object_name):
        file = io.BytesIO()
        self.client.getfo(f'{bucket}/{object_name}', file)
        file.seek(0)
        return file
    

    def copy(self, bucket, src, dst):
        self.put(bucket, dst, self.get(bucket, src))
    

    def delete(self, bucket, object_name):
        if self.client.isfile(f'{bucket}/{object_name}'):
            self.client.remove(f'{bucket}/{object_name}')


    def delete_dir(self, bucket, prefix):
        files = self.ls(bucket, prefix)
        for file in files:
            if self.isfile(bucket, f'{prefix}/{file}'):
                self.delete(bucket, f'{prefix}/{file}')
            else:
                self.delete_dir(bucket, f'{prefix}/{file}')
