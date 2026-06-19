import base64
import hashlib
import hmac
import mmap
import ntpath
import os
import io
import random
import time
from urllib.parse import quote_plus, quote, urlencode
from xml.etree import ElementTree
from typing import Optional, List, Dict
from dataclasses import asdict, dataclass
from datetime import datetime

import requests
from .base import BaseStorageClient


@dataclass
class Element:
    type: str
    name: str
    bytes: Optional[int] = None
    files: Optional[int] = None
    mtime: Optional[datetime] = None
    size: Optional[int] = None
    md5: Optional[str] = None

    def to_dict(self) -> Dict:
        return asdict(self, dict_factory=lambda x: {k: v for (k, v) in x if v is not None or v != 0})


class NetstorageError(Exception):
    """Base-class for all exceptions raised by Netstorage Class"""


def remove_slash(p):
    if p.endswith("/"):
        return p[:-1]
    return p


def remove_prefix(s: str, sub):
    if s.startswith(sub):
        return s[len(sub):]
    return s


class Netstorage:

    def __init__(self, hostname, keyname, key, cpcode, ssl=False):
        if not (hostname and keyname and key):
            raise NetstorageError(
                '[NetstorageError] You should input netstorage hostname, keyname and key all')

        self.hostname = hostname
        self.keyname = keyname
        self.key = key
        self.cpcode = cpcode
        self.ssl = 's' if ssl else ''
        self.http_client = requests.Session()
        self.proxies = {
          "http": os.getenv('ORG_PROXY', None),
          "https": os.getenv('ORG_PROXY', None),
        }

    def _get_full_path(self, path):
        return f"/{self.cpcode}{path}"

    def _construct_list(self, content) -> List[Element]:
        print(content)
        root = ElementTree.fromstring(content)
        elements = []
        for child in root:
            if child.tag != 'file':
                continue
            attrs = child.attrib
            bytes = int(attrs.get('bytes', '0'))
            files = int(attrs.get('files', '0'))
            size = int(attrs.get('size', '0'))
            mtime = attrs.get('mtime')
            if mtime:
                mtime = datetime.fromtimestamp(int(mtime))
            elements.append(Element(
                type=attrs['type'],
                name=attrs['name'],
                bytes=bytes,
                files=files,
                mtime=mtime,
                size=size,
                md5=attrs.get('md5')
                ))
        return elements

    def _download_data_from_response(self, response, ns_path, local_destination, chunk_size=16*1024):
        if not local_destination:
            local_destination = ntpath.basename(ns_path)
        elif os.path.isdir(local_destination):
            local_destination = os.path.join(
                local_destination, ntpath.basename(ns_path))

        if response.status_code == 200:
            try:
                with open(local_destination, 'wb') as f:
                    for chunk in response.iter_content(chunk_size):
                        if chunk:
                            f.write(chunk)
            except Exception as e:
                raise NetstorageError(e)

    def _upload_data_to_request(self, source):
        mmapped_data = None
        try:
            with open(source, 'rb') as f:
                if os.fstat(f.fileno()).st_size == 0:
                    mmapped_data = ''
                else:
                    mmapped_data = mmap.mmap(
                        f.fileno(), 0, access=mmap.ACCESS_READ)
        except Exception as e:
            if mmapped_data:
                mmapped_data.close()
            raise NetstorageError(e)

        return mmapped_data

    def _request(self, **kwargs):
        path = kwargs['path']
        if not path.startswith('/'):
            raise NetstorageError('[NetstorageError] Invalid netstorage path')

        path = quote(path)
        acs_action = "version=1&action={0}".format(kwargs['action'])
        acs_auth_data = "5, 0.0.0.0, 0.0.0.0, {0}, {1}, {2}".format(
            int(time.time()),
            str(random.getrandbits(32)),
            self.keyname)
        sign_string = "{0}\nx-akamai-acs-action:{1}\n".format(path, acs_action)
        message = acs_auth_data + sign_string
        hash_ = hmac.new(self.key.encode(), message.encode(),
                         hashlib.sha256).digest()

        acs_auth_sign = base64.b64encode(hash_)

        request_url = "http{0}://{1}{2}".format(self.ssl, self.hostname, path)

        headers = {
            'X-Akamai-ACS-Action': acs_action,
            'X-Akamai-ACS-Auth-Data': acs_auth_data,
            'X-Akamai-ACS-Auth-Sign': acs_auth_sign,
            'Accept-Encoding': 'identity',
            'User-Agent': 'NetStorageKit-Python'
        }

        response = None
        if kwargs['method'] == 'GET':
            if kwargs['action'] == 'download':
                response = self.http_client.get(
                    request_url, headers=headers, stream=True, proxies=self.proxies)
                if 'stream' not in kwargs.keys():
                    self._download_data_from_response(
                        response, kwargs['path'], kwargs['destination'])
            else:
                response = self.http_client.get(request_url, headers=headers, proxies=self.proxies)

        elif kwargs['method'] == 'POST':
            response = self.http_client.post(request_url, headers=headers, proxies=self.proxies)

        elif kwargs['method'] == 'PUT':  # Use only upload
            if 'stream' in kwargs.keys():
                response = self.http_client.put(
                    request_url, headers=headers, data=kwargs['stream'], proxies=self.proxies)
            elif kwargs['action'].startswith('upload'):
                mmapped_data = self._upload_data_to_request(kwargs['source'])
                response = self.http_client.put(
                    request_url, headers=headers, data=mmapped_data, proxies=self.proxies)
                if not isinstance(mmapped_data, str):
                    mmapped_data.close()

        return response.status_code == 200, response

    def dir(self, ns_path, option=None) -> List[Element]:
        option = option or {}
        option = "dir&format=xml&{0}".format(urlencode(option))
        ok, response = self._request(action=option,
                                     method='GET',
                                     path=self._get_full_path(ns_path))
        if not ok:
            raise NetstorageError(f"Failed : Code {response.status_code}, Reason : {response.reason}")
        return self._construct_list(response.content)

    def list(self, ns_path, option=None):
        option = option or {}
        if 'end' not in option:
            option['end'] = remove_slash(self._get_full_path(ns_path)) + "0"
        option = "list&format=xml&{0}".format(urlencode(option))
        ok, response = self._request(action=option,
                             method='GET',
                             path=self._get_full_path(ns_path))
        if not ok:
            raise NetstorageError(f"Failed : Code {response.status_code}, Status : {response.reason}")
        return self._construct_list(response.content)

    def download(self, ns_source, local_destination=''):
        if ns_source.endswith('/'):
            raise NetstorageError(
                "[NetstorageError] Nestorage download path shouldn't be a directory: {0}".format(ns_source))
        return self._request(action='download',
                             method='GET',
                             path=self._get_full_path(ns_source),
                             destination=local_destination)

    def stream_download(self, ns_source):
        return self._request(action='download',
                             method='GET',
                             path=self._get_full_path(ns_source),
                             stream=True)

    def du(self, ns_path):
        return self._request(action='du&format=xml',
                             method='GET',
                             path=self._get_full_path(ns_path))

    def stat(self, ns_path):
        return self._request(action='stat&format=xml',
                             method='GET',
                             path=self._get_full_path(ns_path))

    def mkdir(self, ns_path):
        return self._request(action='mkdir',
                             method='POST',
                             path=self._get_full_path(ns_path))

    def rmdir(self, ns_path):
        return self._request(action='rmdir',
                             method='POST',
                             path=self._get_full_path(ns_path))

    def mtime(self, ns_path, mtime):
        return self._request(action='mtime&format=xml&mtime={0}'.format(mtime),
                             method='POST',
                             path=self._get_full_path(ns_path))

    def delete(self, ns_path):
        return self._request(action='delete',
                             method='POST',
                             path=self._get_full_path(ns_path))

    def quick_delete(self, ns_path):
        return self._request(action='quick-delete&quick-delete=imreallyreallysure',
                             method='POST',
                             path=self._get_full_path(ns_path))

    def rename(self, ns_target, ns_destination):
        return self._request(action='rename&destination={0}'.format(quote_plus(ns_destination)),
                             method='POST',
                             path=self._get_full_path(ns_target))

    def symlink(self, ns_target, ns_destination):
        return self._request(action='symlink&target={0}'.format(quote_plus(ns_target)),
                             method='POST',
                             path=self._get_full_path(ns_destination))

    def upload(self, local_source, ns_destination, index_zip=False):
        if os.path.isfile(local_source):
            if ns_destination.endswith('/'):
                ns_destination = "{0}{1}".format(
                    ns_destination, ntpath.basename(local_source))
        else:
            raise NetstorageError(
                "[NetstorageError] {0} doesn't exist or is directory".format(local_source))

        action = 'upload'
        if index_zip is True or str(index_zip).lower() == 'true':
            action = action + '&index-zip=1'

        return self._request(action=action,
                             method='PUT',
                             source=local_source,
                             path=self._get_full_path(ns_destination))

    def stream_upload(self, data, ns_destination):
        return self._request(action='upload',
                             method='PUT',
                             stream=data,
                             path=self._get_full_path(ns_destination))


class NetstorageClient(BaseStorageClient):

    def __init__(self):
        self.client = Netstorage(hostname=os.getenv('NETSTORAGE_HOSTNAME', None),
                                 keyname=os.getenv('NETSTORAGE_KEYNAME', None),
                                 key=os.getenv('NETSTORAGE_KEY', None),
                                 cpcode=os.getenv('NETSTORAGE_CPCODE', None),
                                 ssl=os.getenv('NETSTORAGE_SSL', 's'))
    

    def ls(self, bucket, prefix, recursive=False):
        path = f'{bucket}/{prefix}'
        if recursive:
            files = []
            for file in self.client.list(path):
                if file.name.endswith('/'):
                    continue
                files.append(file)
            return files
        return self.client.dir(path)


    def fput(self, bucket, object_name, filepath):
        return self.client.upload(filepath, f'{bucket}/{object_name}')


    def put(self, bucket, object_name, data):
        if not hasattr(data, 'read'):
            data = io.BytesIO(data)
        self.client.stream_upload(data, f'{bucket}/{object_name}')


    def fget(self, bucket, object_name, filepath):
        self.client.download(f'{bucket}/{object_name}', filepath)


    def get(self, bucket, object_name):
        _, response = self.client.stream_download(f'{bucket}/{object_name}')
        file = io.BytesIO(response.content)
        file.seek(0)
        return file
    

    def copy(self, bucket, src, dst):
        self.put(bucket, dst, self.get(bucket, src))
    

    def delete(self, bucket, object_name):
        self.client.delete(f'{bucket}/{object_name}')


    def delete_dir(self, bucket, prefix):
        for file in self.ls(bucket, prefix, recursive=True):
            self.client.delete(remove_prefix(file.name, self.client.cpcode))
