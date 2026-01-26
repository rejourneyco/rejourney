#!/usr/bin/env python3
import re
import sys
import os
import glob

def replace_nslogs_in_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original_content = content

    # Simple replacement: NSLog -> RJLogInfo for all logs
    # Specific types will be manually adjusted later
    content = content.replace('NSLog(@"', 'RJLogInfo(@"')

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filepath}")

def main():
    ios_dir = '/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/ios'

    for root, dirs, files in os.walk(ios_dir):
        # Skip Pods directory
        if 'Pods' in root or '. Pods' in root:
            continue

        for file in files:
            if file.endswith('.m') or file.endswith('.mm'):
                filepath = os.path.join(root, file)
                replace_nslogs_in_file(filepath)

    print("Done!")

if __name__ == '__main__':
    main()
