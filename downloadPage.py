import requests
import os
import shutil
import signal
import time
import  sys

def download_image(url, folder_path, file_name):
    class TimeoutException(Exception):
        pass

    def handler(signum, frame):
        raise TimeoutException()

    signal.signal(signal.SIGALRM, handler)

    file_path = os.path.join(folder_path, file_name)
    attempts = 5

    for attempt in range(attempts):
        signal.alarm(20)
        try:
            response = requests.get(url, stream=True, timeout=20)
            if response.status_code == 200:
                with open(file_path, "wb") as out_file:
                    shutil.copyfileobj(response.raw, out_file)
                print(f"Downloaded: {file_name}")
                signal.alarm(0)
                return
            else:
                print(f"Failed to download image from {url} (status code {response.status_code})")
        except (requests.exceptions.Timeout, TimeoutException) as e:
            print(f"Timeout occurred, retrying {file_name} (attempt {attempt + 1})")
        except Exception as e:
            print(f"Error downloading {file_name}: {e}")
        finally:
            signal.alarm(0)
        time.sleep(2 ** attempt)

    raise ValueError("Download Failed")


def main():
    if len(sys.argv) > 3:
        url = sys.argv[1]
        download_directory = sys.argv[2]
        file_name = sys.argv[3]
        download_image(url, download_directory, file_name)

main()
