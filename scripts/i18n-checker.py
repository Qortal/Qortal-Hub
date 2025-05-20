import os
import re
import json
import csv
import argparse

# Customize as needed
I18N_FUNCTIONS = ['t', 'i18next.t']
FILE_EXTENSIONS = ['.tsx']
EXCLUDED_DIRS = ['node_modules', 'build', 'dist']

# Regex patterns
STRING_LITERAL_REGEX = re.compile(r'(?<!t\()\s*["\']([A-Z][^"\']{2,})["\']')
JSX_TEXT_REGEX = re.compile(r'>\s*([A-Z][a-z].*?)\s*<')

def is_excluded(path):
    return any(excluded in path for excluded in EXCLUDED_DIRS)

def find_untranslated_strings(file_path):
    issues = []
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

        # Match suspicious string literals
        for match in STRING_LITERAL_REGEX.finditer(content):
            string = match.group(1)
            if not any(fn + '(' in content[match.start()-10:match.start()] for fn in I18N_FUNCTIONS):
                issues.append({
                    'file': file_path,
                    'position': match.start(),
                    'type': 'StringLiteral',
                    'text': string.strip()
                })

        # Match JSX text nodes
        for match in JSX_TEXT_REGEX.finditer(content):
            text = match.group(1)
            if not text.strip().startswith('{t('):  # naive check
                issues.append({
                    'file': file_path,
                    'position': match.start(),
                    'type': 'JSXText',
                    'text': text.strip()
                })

    return issues

def scan_directory(directory):
    all_issues = []
    for root, _, files in os.walk(directory):
        if is_excluded(root):
            continue
        for file in files:
            if any(file.endswith(ext) for ext in FILE_EXTENSIONS):
                file_path = os.path.join(root, file)
                issues = find_untranslated_strings(file_path)
                all_issues.extend(issues)
    return all_issues

def save_report(results, output_file):
    _, ext = os.path.splitext(output_file)
    if ext.lower() == '.json':
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2)
    elif ext.lower() == '.csv':
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=['file', 'position', 'type', 'text'])
            writer.writeheader()
            for row in results:
                writer.writerow(row)
    else:
        raise ValueError("Unsupported output format. Use .json or .csv")

def main():
    parser = argparse.ArgumentParser(description='Detect untranslated strings in React (.tsx) files.')
    parser.add_argument('-path', default='../src/', help='Path to the source directory (e.g. ./src)')
    parser.add_argument('-o', '--output', default='./i18n_report.json', help='Report output file (.json or .csv)')

    args = parser.parse_args()
    results = scan_directory(args.path)

    if results:
        save_report(results, args.output)
        print(f"⚠️  Found {len(results)} potential untranslated strings. Report saved to {args.output}")
    else:
        print("✅ No obvious untranslated strings found.")

if __name__ == "__main__":
    main()
