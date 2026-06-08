import pytesseract
import fitz
import json
import re
import os
from PIL import Image
import io
import sys

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

pdf_path = r'C:\Users\user\Desktop\2026_Cathay\AWS SAA\SAA-C03_题目参考答案_(4).pdf'
output_path = r'C:\Users\user\Desktop\2026_Cathay\AWS SAA\quiz-app\questions_data.js'
raw_text_path = r'C:\Users\user\Desktop\2026_Cathay\AWS SAA\raw_text.txt'

doc = fitz.open(pdf_path)
total_pages = doc.page_count
print(f"PDF has {total_pages} pages", flush=True)

all_text = ''
for i in range(total_pages):
    page = doc[i]
    pix = page.get_pixmap(dpi=150)
    img = Image.open(io.BytesIO(pix.tobytes('png')))

    text = pytesseract.image_to_string(img, lang='eng')
    all_text += text + '\n\n'

    print(f"Page {i+1}/{total_pages} done ({len(text)} chars)", flush=True)

# Save raw text
with open(raw_text_path, 'w', encoding='utf-8') as f:
    f.write(all_text)
print(f"\nRaw text saved ({len(all_text)} chars)", flush=True)

# ---- Parse questions ----
print("Parsing questions...", flush=True)

# Split by "Question #N"
question_blocks = re.split(r'(?=Question\s*#\s*\d+)', all_text)
questions = []

for block in question_blocks:
    m = re.match(r'Question\s*#\s*(\d+)', block)
    if not m:
        continue

    qid = int(m.group(1))

    # Extract topic
    topic_m = re.search(r'Topic\s*(\d+)', block[:200])
    topic = f"Topic {topic_m.group(1)}" if topic_m else ""

    # Find correct answer
    ans_m = re.search(r'Correct\s*Answer\s*[:\.\-]?\s*([A-F][A-F,\s]*)', block, re.IGNORECASE)
    if not ans_m:
        # Try alternative patterns
        ans_m = re.search(r'Correct\s*Answer\s*[:\.\-]?\s*([A-F](?:\s*,?\s*[A-F])*)', block, re.IGNORECASE)
    if not ans_m:
        continue

    answer_str = ans_m.group(1).strip()
    answers = re.findall(r'[A-F]', answer_str.upper())
    if not answers:
        continue

    # Find options section
    # Look for the first option A
    first_opt = re.search(r'\n\s*A[\.\):\s]', block)
    if not first_opt:
        first_opt = re.search(r'\bA[\.\)]\s', block[50:])  # skip header
        if first_opt:
            first_opt = type('obj', (object,), {'start': lambda s=first_opt.start(): s + 50})()
    if not first_opt:
        continue

    # Question text: between header line and first option
    header_end = block.find('\n', m.end())
    if header_end == -1:
        header_end = m.end()

    question_text = block[header_end:first_opt.start()].strip()
    # Remove leading "Topic X" lines
    question_text = re.sub(r'^Topic\s*\d+\s*\n?', '', question_text).strip()

    # Extract options - find each option letter and its text
    options = []
    # Get text from first option to answer line
    ans_pos = ans_m.start()
    options_text = block[first_opt.start():ans_pos]

    # Parse individual options
    opt_splits = re.split(r'\n\s*([A-F])[\.\):\s]', options_text)

    # Alternative parsing approach
    if len(opt_splits) < 3:
        opt_matches = re.finditer(r'([A-F])[\.\):\s]\s*(.*?)(?=(?:\n\s*[A-F][\.\):\s])|(?:Reveal|Correct|Community|$))',
                                   options_text, re.DOTALL)
        for om in opt_matches:
            letter = om.group(1)
            text = om.group(2).strip().replace('\n', ' ')
            text = re.sub(r'\s+', ' ', text)
            if text:
                options.append({"letter": letter, "text": text})
    else:
        # opt_splits: ['prefix', 'A', 'text...', 'B', 'text...', ...]
        i = 1
        while i < len(opt_splits) - 1:
            letter = opt_splits[i].strip()
            text = opt_splits[i + 1].strip().replace('\n', ' ')
            text = re.sub(r'\s+', ' ', text)
            # Clean trailing artifacts
            text = re.sub(r'\s*(Reveal|Correct|Community|Denetl|Binary).*$', '', text, flags=re.IGNORECASE)
            if letter and text:
                options.append({"letter": letter, "text": text})
            i += 2

    if len(options) < 2:
        continue

    questions.append({
        "id": qid,
        "topic": topic,
        "question": question_text,
        "options": options,
        "answer": answers
    })

# Sort and deduplicate
questions.sort(key=lambda q: q['id'])
seen_ids = set()
unique_questions = []
for q in questions:
    if q['id'] not in seen_ids:
        seen_ids.add(q['id'])
        unique_questions.append(q)
questions = unique_questions

print(f"Parsed {len(questions)} questions", flush=True)

# Show some stats
if questions:
    topics = set(q['topic'] for q in questions)
    print(f"Topics: {sorted(topics)}", flush=True)
    print(f"ID range: {questions[0]['id']} - {questions[-1]['id']}", flush=True)

# Save as JS file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write('const QUESTIONS_DATA = ')
    json.dump(questions, f, ensure_ascii=False, indent=2)
    f.write(';\n')

print(f"Saved to {output_path}", flush=True)
print("Done!", flush=True)
