import os
import json
from deep_translator import GoogleTranslator
from concurrent.futures import ThreadPoolExecutor, as_completed

# === CONFIGURATION ===
base_folder = "../src/i18n/locales"
source_lang = "en"
target_langs = ["de", "es", "fr", "it", "ja", "ru", "zh_CN"]
filenames = ["auth.json", "core.json", "group.json", "question.json", "tutorial.json"]
max_workers = 12  # Adjust based on your CPU

# === TRANSLATION FUNCTION ===
def translate_json(obj, target_lang):
    if isinstance(obj, dict):
        return {k: translate_json(v, target_lang) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [translate_json(item, target_lang) for item in obj]
    elif isinstance(obj, str):
        if "{{" in obj or "}}" in obj or "<" in obj:
            return obj  # Skip templating/markup
        try:
            return GoogleTranslator(source='en', target=target_lang).translate(text=obj)
        except Exception as e:
            print(f"[{target_lang}] Error: {e}")
            return obj
    return obj

# === WORKER FUNCTION ===
def translate_file_for_lang(filename, data, lang):
    print(f"🔁 Translating {filename} → {lang}")
    translated = translate_json(data, lang)
    target_dir = os.path.join(base_folder, lang)
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, filename)
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(translated, f, ensure_ascii=False, indent=2)
    print(f"✅ Saved {target_path}")
    return target_path

# === MAIN FUNCTION ===
def main():
    tasks = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for filename in filenames:
            source_path = os.path.join(base_folder, source_lang, filename)
            if not os.path.isfile(source_path):
                print(f"⚠️ Missing file: {source_path}")
                continue

            with open(source_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            for lang in target_langs:
                tasks.append(executor.submit(translate_file_for_lang, filename, data, lang))

        for future in as_completed(tasks):
            _ = future.result()

if __name__ == "__main__":
    main()
