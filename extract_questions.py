import easyocr
import fitz
import json
import re
import os
import sys

pdf_path = 'C:/Users/user/Desktop/2026_Cathay/AWS SAA/SAA-C03_题目参考答案_(4).pdf'
output_path = 'C:/Users/user/Desktop/2026_Cathay/AWS SAA/quiz-app/questions_data.js'
raw_text_path = 'C:/Users/user/Desktop/2026_Cathay/AWS SAA/raw_text.txt'

print("Initializing OCR reader...")
reader = easyocr.Reader(['en'], gpu=False)
doc = fitz.open(pdf_path)
total_pages = doc.page_count
print(f"PDF has {total_pages} pages")

all_text = ''
for i in range(total_pages):
    page = doc[i]
    pix = page.get_pixmap(dpi=150)  # lower DPI for speed
    img_bytes = pix.tobytes('png')
    temp_path = f'C:/Users/user/Desktop/2026_Cathay/AWS SAA/_temp_ocr.png'
    with open(temp_path, 'wb') as f:
        f.write(img_bytes)

    results = reader.readtext(temp_path, detail=0, paragraph=True)
    page_text = '\n'.join(results)
    all_text += page_text + '\n'

    os.remove(temp_path)
    print(f"Page {i+1}/{total_pages} done", flush=True)

# Save raw text
with open(raw_text_path, 'w', encoding='utf-8') as f:
    f.write(all_text)
print(f"Raw text saved ({len(all_text)} chars)")

# ---- Parse questions ----
print("Parsing questions...")

# Split by "Question #N"
question_blocks = re.split(r'(?=Question\s*#\s*\d+)', all_text)
questions = []

for block in question_blocks:
    m = re.match(r'Question\s*#\s*(\d+)', block)
    if not m:
        continue

    qid = int(m.group(1))

    # Extract topic
    topic_m = re.search(r'Topic\s*(\d+)', block[:100])
    topic = f"Topic {topic_m.group(1)}" if topic_m else ""

    # Find correct answer line
    ans_m = re.search(r'Correct\s*Answer\s*[:\.]?\s*([A-F,\s]+)', block, re.IGNORECASE)
    if not ans_m:
        continue

    answer_str = ans_m.group(1).strip()
    answers = re.findall(r'[A-F]', answer_str.upper())
    if not answers:
        continue

    # Extract question text (between question header and first option)
    # Find the first option marker
    first_opt = re.search(r'\n\s*A[\.\):\s]', block)
    if not first_opt:
        continue

    # Question text is between header and first option
    header_end = block.find('\n', m.end())
    if header_end == -1:
        header_end = m.end()

    # Skip topic line if present
    question_text_start = header_end
    remaining = block[header_end:first_opt.start()].strip()
    # Remove leading "Topic X" if present
    remaining = re.sub(r'^Topic\s*\d+\s*', '', remaining).strip()
    question_text = remaining

    # Extract options
    options = []
    opt_pattern = r'([A-F])[\.\):\s]\s*(.*?)(?=(?:\n\s*[A-F][\.\):\s])|(?:Reveal|Correct\s*Answer|Community|Denetl|$))'
    opt_matches = re.findall(opt_pattern, block[first_opt.start():], re.DOTALL)

    for letter, text in opt_matches:
        clean_text = text.strip().replace('\n', ' ')
        # Remove trailing artifacts
        clean_text = re.sub(r'\s*(Reveal|Correct|Community|Denetl|Binary).*$', '', clean_text, flags=re.IGNORECASE)
        if clean_text:
            options.append({"letter": letter, "text": clean_text})

    if len(options) < 2:
        continue

    questions.append({
        "id": qid,
        "topic": topic,
        "question": question_text,
        "options": options,
        "answer": answers
    })

# Sort by id
questions.sort(key=lambda q: q['id'])

# Remove duplicates
seen_ids = set()
unique_questions = []
for q in questions:
    if q['id'] not in seen_ids:
        seen_ids.add(q['id'])
        unique_questions.append(q)

questions = unique_questions
print(f"Parsed {len(questions)} questions")

# Save as JS file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write('const QUESTIONS_DATA = ')
    json.dump(questions, f, ensure_ascii=False, indent=2)
    f.write(';\n')

print(f"Saved to {output_path}")
print("Done!")
