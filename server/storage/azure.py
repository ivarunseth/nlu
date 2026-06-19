from azure.storage.blob import BlobServiceClient
from io import BytesIO
import os
from .base import BaseStorageClient


class AzureStorageClient(BaseStorageClient):
    def __init__(self):
        connection_string = os.getenv('AZURE_CONNECTION_STRING', None)
        
        if not connection_string:
            connection_string = 'DefaultEndpointsProtocol={0};AccountName={1};AccountKey={2};EndpointSuffix={3}'

            default_endpoints_protocol = os.getenv('AZURE_DEFAULT_ENDPOINTS_PROTOCOL', 'https')
            account_name = os.getenv('AZURE_ACCOUNT_NAME', None)
            account_key = os.getenv('AZURE_ACCOUNT_KEY', None)
            endpoint_suffix = os.getenv('AZURE_ENDPOINT_SUFFIX', 'core.windows.net')

            connection_string = connection_string.format(default_endpoints_protocol, 
                                                         account_name, 
                                                         account_key, 
                                                         endpoint_suffix)

        self.client = BlobServiceClient.from_connection_string(connection_string)
    
    def ls(self, container_name, prefix=None, recursive=False):
        container_client = self.client.get_container_client(container_name)
        return container_client.list_blobs(name_starts_with=prefix)
    
    def put(self, container_name, blob_name, data):
        try:
            if not hasattr(data, 'read'):
                data = BytesIO(data)
            blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
            blob_client.upload_blob(data, overwrite=True)
        except Exception as e:
            print(f'Failed to upload file. Reason: {e}')

    def get(self, container_name, blob_name):
        try:
            blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
            stream = BytesIO()
            stream.write(blob_client.download_blob().readall())
            stream.seek(0)
            return stream
        except Exception as e:
            print(f'Failed to get blob {blob_name}. Reason: {e}')

    def fput(self, container_name, blob_name, file_path):
        try:
            blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
            with open(file_path, 'rb') as data:
                blob_client.upload_blob(data, overwrite=True)
        except Exception as e:
            print(f'Failed to upload file {file_path}. Reason: {e}')

    def fput_dir(self, container_name, prefix, directory_path):
        if os.path.exists(directory_path) and os.path.isdir(directory_path):
            for filename in os.listdir(directory_path):
                file_path = os.path.join(directory_path, filename)
                blob_name = f'{prefix}/{filename}'
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        self.fput(container_name, blob_name, file_path)
                    elif os.path.isdir(file_path):
                        self.fput_dir(container_name, blob_name, file_path)
                except Exception as e:
                    print(f'Failed to upload file {file_path}. Reason: {e}')

    def fget(self, container_name, blob_name, file_path):
        try:
            blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
            with open(file_path, 'wb') as file:
                file.write(blob_client.download_blob().readall())
        except Exception as e:
            print(f'Failed to download file {blob_name}. Reason: {e}')

    def fget_dir(self, container_name, prefix, directory_path):
        try:
            blobs = self.ls(container_name, prefix)
            for blob in blobs:
                file_path = os.path.join(directory_path, os.path.relpath(blob.name, prefix)).replace("/", os.sep)
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                self.fget(container_name, blob.name, file_path)
        except Exception as e:
            print(f'Failed to download blobs with prefix {prefix}. Reason: {e}')

    def copy(self, container_name, source_blob_name, destination_blob_name):
        try:
            source_blob_client = self.client.get_blob_client(container=container_name, blob=source_blob_name)
            destination_blob_client = self.client.get_blob_client(container=container_name, blob=destination_blob_name)
            destination_blob_client.start_copy_from_url(source_blob_client.url)
        except Exception as e:
            print(f'Failed to copy blob {source_blob_name} to {destination_blob_name}. Reason: {e}')

    def delete(self, container_name, blob_name):
        try:
            blob_client = self.client.get_blob_client(container=container_name, blob=blob_name)
            blob_client.delete_blob()
        except Exception as e:
            print(f'Failed to delete blob {blob_name}. Reason: {e}')

    def delete_dir(self, container_name, prefix):
        try:
            container_client = self.client.get_container_client(container_name)
            blobs = container_client.list_blobs(name_starts_with=prefix)
            for blob in blobs:
                container_client.delete_blob(blob.name)
        except Exception as e:
            print(f'Failed to remove blobs. Reason: {e}')
