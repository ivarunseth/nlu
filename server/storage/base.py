class BaseStorageClient:
    def put(self, bucket, object_name, data):
        raise NotImplementedError

    def fput(self, bucket, object_name, filepath):
        raise NotImplementedError

    def get(self, bucket, object_name):
        raise NotImplementedError

    def fget(self, bucket, object_name, filepath):
        raise NotImplementedError

    def fput_dir(self, bucket, prefix, directory_path):
        raise NotImplementedError

    def fget_dir(self, bucket, prefix, directory_path):
        raise NotImplementedError

    def copy(self, bucket, source, destination):
        raise NotImplementedError

    def delete(self, bucket, object_name):
        raise NotImplementedError

    def delete_dir(self, bucket, prefix):
        raise NotImplementedError

    def ls(self, bucket, prefix, recursive=False):
        raise NotImplementedError
