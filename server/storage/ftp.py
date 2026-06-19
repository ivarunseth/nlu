import ftplib
import os
import io
from .base import BaseStorageClient


class FTPClient(BaseStorageClient):


    def __init__(self):
        self.client = ftplib.FTP()
        self.client.connect(os.getenv('FTP_HOST', None))
        self.client.login(os.getenv('FTP_USER', None), os.getenv('FTP_PASS', None))


    def ls(self, bucket, prefix='', **kwargs):
        return self.client.nlst(f'{bucket}/{prefix}')


    def fput(self, bucket, object_name, filepath):
        directory = os.path.dirname(object_name)
        parts = directory.split('/')
        path = ''
        for part in parts:
            if path == '':
                path = part
            else:
                path = f'{path}/{part}'
            try:
                self.client.mkd(f'{bucket}/{path}')
            except ftplib.error_perm as e:
                if not str(e).startswith('550'):
                    raise
        with open(filepath, 'rb') as file:
            self.client.storbinary(f'STOR {bucket}/{object_name}', file)
    
    
    def put(self, bucket, object_name, data):
        if not hasattr(data, 'read'):
            data = io.BytesIO(data)
        directory = os.path.dirname(object_name)
        parts = directory.split('/')
        path = ''
        for part in parts:
            if path == '':
                path = part
            else:
                path = f'{path}/{part}'
            try:
                self.client.mkd(f'{bucket}/{path}')
            except ftplib.error_perm as e:
                if not str(e).startswith('550'):
                    raise
        self.client.storbinary(f'STOR {bucket}/{object_name}', data)


    def fget(self, bucket, object_name, filepath):
        with open(filepath, 'wb') as file:
            self.client.retrbinary(f'RETR {bucket}/{object_name}', file.write)


    def get(self, bucket, object_name):
        file = io.BytesIO()
        self.client.retrbinary(f'RETR {bucket}/{object_name}', file.write)
        file.seek(0)
        return file


    def copy(self, bucket, src, dst):
        self.put(bucket, dst, self.get(bucket, src))


    def delete(self, bucket, object_name):
        self.client.delete(f'{bucket}/{object_name}')
            

    def delete_dir(self, bucket, prefix):
        path = f'{bucket}/{prefix}'
        files = self.ls(bucket, prefix)
        for file in files:
            self.client.delete(f'{path}/{file}')
