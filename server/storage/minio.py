import os
import io
from datetime import timedelta
from minio import Minio
from minio.deleteobjects import DeleteObject
from minio.commonconfig import CopySource
from .base import BaseStorageClient


class MinioClient(BaseStorageClient):  


    def __init__(self) -> None:
        self.client = Minio(endpoint=os.getenv('MINIO_URL'),
                            access_key=os.getenv('MINIO_ACCESS_KEY'),
                            secret_key=os.getenv('MINIO_SECRET_KEY'),
                            secure=False)


    def ls(self, bucket_name, prefix, recursive=False):
        return self.client.list_objects(bucket_name=bucket_name,
                                        prefix=prefix,
                                        recursive=recursive)


    def get(self, bucket_name, object_name):
        try:
            response = self.client.get_object(bucket_name=bucket_name, 
                                              object_name=object_name)
            return io.BytesIO(response.read())
        
        finally:
            response.close()
            response.release_conn()


    def fget(self, bucket_name, object_name, file_path):
        try:
            self.client.fget_object(bucket_name=bucket_name,
                                    object_name=object_name,
                                    file_path=file_path)
        except Exception as e:
            print(f'Error while downloading {object_name} from minio because: {e}')


    def fget_dir(self, bucket_name, prefix, file_path):
        for file in self.ls(bucket_name, prefix, recursive=True):
            self.fget(bucket_name=bucket_name,
                      object_name=file.object_name,
                      file_path=os.path.join(file_path, os.path.relpath(file.object_name, prefix)))


    def put(self, bucket_name, object_name, data: io.BytesIO):
        if not isinstance(data, io.BytesIO):
            data = io.BytesIO(data)
        result = self.client.put_object(bucket_name=bucket_name,
                                        object_name=object_name,
                                        data=data,
                                        length=-1,
                                        part_size=10*1024*1024)
        print("created {0} object; etag: {1}, version-id: {2}".format(result.object_name, result.etag, result.version_id),)


    def fput(self, bucket_name, object_name, filepath):
        result = self.client.fput_object(bucket_name=bucket_name,
                                         object_name=object_name,
                                         file_path=filepath)
        print("created {0} object; etag: {1}, version-id: {2}".format(result.object_name, result.etag, result.version_id),)


    def fput_dir(self, bucket_name, prefix, filepath):
        if os.path.exists(filepath) and os.path.isdir(filepath):
            for filename in os.listdir(filepath):
                path = os.path.join(filepath, filename)
                object_name = f'{prefix}/{filename}'
                try:
                    if os.path.isfile(path) or os.path.islink(path):
                        self.fput(bucket_name, object_name, path)
                    elif os.path.isdir(path):
                        self.fput_dir(bucket_name, object_name, path)
                except Exception as e:
                    print('Failed to upload file %s. Reason: %s' % (filepath, e))

                    
    def copy(self, bucket_name, object_name, source_object):
        result = self.client.copy_object(bucket_name=bucket_name, 
                                         object_name=object_name, 
                                         source=CopySource(bucket_name=bucket_name, 
                                                           source_object=source_object))
        print("copied {0} object to {1}".format(object_name, result.object_name))


    def delete(self, bucket_name, object_name):
        self.client.remove_object(bucket_name=bucket_name, 
                                  object_name=object_name)


    def delete_dir(self, bucket_name, prefix):    
        errors = self.client.remove_objects(bucket_name=bucket_name,
                                            delete_object_list=map(lambda x: DeleteObject(x.object_name),
                                                                   self.ls(bucket_name=bucket_name,
                                                                                     prefix=prefix,
                                                                                     recursive=True)))
        for error in errors:
            print("error occured when deleting object", error)
