#!/usr/bin/env python3
import os
import re
import sys

# Target directory
TARGET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../packages"))

# File extensions to process
EXTENSIONS = {
    '.swift', '.m', '.h',  # iOS
    '.kt', '.java',        # Android
    '.ts', '.tsx', '.js', '.jsx'  # TS/JS
}

def clean_content(content, ext):
    """
    Cleans comments and logs from the content while preserving copyright headers.
    """
    # 1. Preserve Copyright/License Header
    header = ""
    rest = content
    
    # Try to find block comment at start
    block_match = re.match(r'^\s*/\*.*?\*/', content, re.DOTALL)
    if block_match:
        block = block_match.group(0)
        if "Copyright" in block.lower() or "license" in block.lower():
            header = block
            rest = content[len(header):]
    else:
        # Try to find sequence of // at start
        lines = content.split('\n')
        header_lines = []
        for line in lines:
            trimmed = line.strip()
            if trimmed.startswith('//') or not trimmed:
                header_lines.append(line)
            else:
                break
        
        combined = '\n'.join(header_lines)
        if "copyright" in combined.lower() or "license" in combined.lower():
            header = combined
            rest = content[len(header):]

    # 2. Define Patterns
    
    # Comments (be careful with strings, but this is a best-effort script)
    # Multi-line comments
    rest = re.sub(r'/\*.*?\*/', '', rest, flags=re.DOTALL)
    
    # Single-line comments (excluding those that look like URLs)
    # This pattern avoids matching // inside quotes if they are simple, but isn't perfect for all cases.
    rest = re.sub(r'(?<![:"\'/])//.*', '', rest)

    # Logging Patterns
    
    # iOS: NSLog, RJLog*, RJLogger calls
    ios_logs = [
        r'NSLog\s*\(.*?\)(?:\s*;)?',
        r'RJLog(?:Debug|Info|Warning|Error)\s*\(.*?\)(?:\s*;)?',
        r'\[RJLogger\s+.*?\]\s*\(.*?\)(?:\s*;)?',
        r'\[RJLogger\s+[^\]]+\](?:\s*;)?'
    ]
    
    # Android: Log.*, Logger.*, println, printStackTrace
    android_logs = [
        r'(?:android\.util\.)?Log\.[idwev]\s*\(.*?\)(?:\s*;)?',
        r'Logger\.(?:debug|info|warning|error)\s*\(.*?\)(?:\s*;)?',
        r'println\s*\(.*?\)(?:\s*;)?',
        r'\w+\.printStackTrace\s*\(.*?\)(?:\s*;)?'
    ]
    
    # TS/JS: console.*
    web_logs = [
        r'console\.(?:log|warn|error|debug|info|trace|table)\s*\(.*?\)(?:\s*;)?'
    ]

    all_logs = ios_logs + android_logs + web_logs
    
    for pattern in all_logs:
        rest = re.sub(pattern, '', rest, flags=re.DOTALL)

    # 3. Cleanup: Remove excessive whitespace
    # Replace 3+ newlines with 2
    rest = re.sub(r'\n\s*\n\s*\n+', '\n\n', rest)
    # Trim leading/trailing whitespace from the rest
    rest = rest.strip()

    result = header + '\n\n' + rest if header else rest
    return result.strip() + '\n'

import argparse

def process_directory(directory, dry_run=True):
    count = 0
    for root, _, files in os.walk(directory):
        # Skip node_modules and build dirs
        if 'node_modules' in root or 'build' in root or '.gradle' in root:
            continue
            
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in EXTENSIONS:
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    cleaned = clean_content(content, ext)
                    
                    if cleaned != content:
                        if not dry_run:
                            with open(file_path, 'w', encoding='utf-8') as f:
                                f.write(cleaned)
                            print(f"Cleaned: {os.path.relpath(file_path, TARGET_DIR)}")
                        else:
                            print(f"[DRY RUN] Would clean: {os.path.relpath(file_path, TARGET_DIR)}")
                        count += 1
                except Exception as e:
                    print(f"Error processing {file_path}: {e}")
    
    action = "Would clean" if dry_run else "Cleaned"
    print(f"\nTotal files: {count} ({action})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean logs and comments from codebase.")
    parser.add_argument("--run", action="store_true", help="Actually modify files.")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Don't modify files (default).")
    
    args = parser.parse_args()
    
    if not os.path.exists(TARGET_DIR):
        print(f"Error: Target directory {TARGET_DIR} does not exist.")
        sys.exit(1)
        
    is_dry_run = not args.run
    
    if is_dry_run:
        print("DRY RUN MODE: No files will be modified.")
    else:
        print("REAL RUN: Files will be modified.")
        
    print(f"Targeting: {TARGET_DIR}")
    print("Press Ctrl+C to abort.")
    
    process_directory(TARGET_DIR, dry_run=is_dry_run)
