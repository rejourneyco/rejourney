#!/usr/bin/env python3
import re
import os

def remove_junk_comments_in_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original_content = content

    # Remove documentation blocks for self-explanatory methods
    patterns_to_remove = [
        (r'\/\*\*\n \* Log a debug message\.\n \*\n \* @param format The format string \(NSLog-style\)\.\n \*\/\n', ''),
        (r'\/\*\*\n \* Log an info message\.\n \*\n \* @param format The format string \(NSLog-style\)\.\n \*\/\n', ''),
        (r'\/\*\*\n \* Log a warning message\.\n \*\n \* @param format The format string \(NSLog-style\)\.\n \*\/\n', ''),
        (r'\/\*\*\n \* Log an error message\.\n \*\n \* @param format The format string \(NSLog-style\)\.\n \*\/\n', ''),
        (r'\/\*\*\n \* Log a message with a specific level\.\n \*\n \* @param level The log level\.\n \* @param format The format string \(NSLog-style\)\.\n \*\/\n', ''),
    ]

    for pattern, replacement in patterns_to_remove:
        content = content.replace(pattern, replacement)

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Cleaned comments in {filepath}")

def main():
    ios_dir = '/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/ios'

    for root, dirs, files in os.walk(ios_dir):
        if 'Pods' in root or '. Pods' in root:
            continue

        for file in files:
            if file.endswith('.h') or file.endswith('.m') or file.endswith('.mm'):
                filepath = os.path.join(root, file)
                remove_junk_comments_in_file(filepath)

    print("Done!")

if __name__ == '__main__':
    main()
