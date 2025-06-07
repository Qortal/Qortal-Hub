import os
import json
import time
from deep_translator import GoogleTranslator

# === CONFIGURATION ===
base_folder = "./src/i18n/locales"
source_lang = "en"
filenames = ["auth.json", "core.json", "group.json", "question.json", "tutorial.json"]


# === SAFE TRANSLATION ===
def safe_translate(translator, text, retries=3):
    for attempt in range(retries):
        try:
            return translator.translate(text=text)
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                print(f"[{translator.target}] Failed to translate '{text}': {e}")
                return text


# === TRANSLATION LOGIC ===
def translate_json(obj, translator):
    if isinstance(obj, dict):
        return {k: translate_json(v, translator) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [translate_json(item, translator) for item in obj]
    elif isinstance(obj, str):
        if not obj.strip() or "{{" in obj or "}}" in obj or "<" in obj:
            return obj
        return safe_translate(translator, obj)
    return obj


# === FILE TRANSLATION ===
def translate_file(filename, target_lang):
    source_path = os.path.join(base_folder, source_lang, filename)
    if not os.path.isfile(source_path):
        print(f"❌ File not found: {source_path}")
        return

    with open(source_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"🔁 Translating {filename} → {target_lang}")
    translator = GoogleTranslator(source=source_lang, target=target_lang)
    translated = translate_json(data, translator)

    target_dir = os.path.join(base_folder, target_lang)
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, filename)

    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(translated, f, ensure_ascii=False, indent=2)

    print(f"✅ Saved: {target_path}")


# === MAIN FUNCTION ===
def main():
    print("Available files:")
    for name in filenames:
        print(f" - {name}")
    filename = input("Enter the filename to translate: ").strip()
    if filename not in filenames:
        print(f"❌ Invalid filename: {filename}")
        return

    target_lang = input("Enter the target language code (e.g., de, fr, ja): ").strip()
    if not target_lang:
        print("❌ No target language provided.")
        return

    translate_file(filename, target_lang)


if __name__ == "__main__":
    main()
