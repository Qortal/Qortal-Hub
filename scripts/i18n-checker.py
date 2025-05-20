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

def is_ignorable(text):
    return (
        re.fullmatch(r'[A-Z0-9_]+', text) and 'action' in text
    )

def is_console_log_line(line):
    return any(kw in line for kw in ['console.log', 'console.error', 'console.warn'])

def find_untranslated_strings(file_path):
    issues = []
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.splitlines()

        for idx, line in enumerate(lines, start=1):
            if is_console_log_line(line):
                continue  # Skip entire line if it's a console log statement

            # Match suspicious string literals
            for match in STRING_LITERAL_REGEX.finditer(line):
                string = match.group(1).strip()
                if is_ignorable(string):
                    continue
                if not any(fn + '(' in line[:match.start()] for fn in I18N_FUNCTIONS):
                    issues.append({
                        'file': file_path,
                        'line': idx,
                        'type': 'StringLiteral',
                        'text': string
                    })

            # Match JSX text nodes
            for match in JSX_TEXT_REGEX.finditer(line):
                text = match.group(1).strip()
                if is_ignorable(text):
                    continue
                if not text.startswith('{t('):
                    issues.append({
                        'file': file_path,
                        'line': idx,
                        'type': 'JSXText',
                        'text': text
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
            writer = csv.DictWriter(f, fieldnames=['file', 'line', 'type', 'text'])
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
