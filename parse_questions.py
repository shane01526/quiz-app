import json
import re

raw_text_path = r'C:\Users\user\Desktop\2026_Cathay\AWS SAA\raw_text.txt'
output_path = r'C:\Users\user\Desktop\2026_Cathay\AWS SAA\quiz-app\questions_data.js'

with open(raw_text_path, 'r', encoding='utf-8') as f:
    all_text = f.read()

# Fix common OCR errors
all_text = all_text.replace('$3 ', 'S3 ').replace('$3.', 'S3.')
all_text = all_text.replace('Accompany', 'A company')

# Split by "Question #N"
question_blocks = re.split(r'(?=Question\s*#\s*\d+)', all_text)
questions = []
failed_ids = []

for block in question_blocks:
    m = re.match(r'Question\s*#\s*(\d+)', block)
    if not m:
        continue

    qid = int(m.group(1))

    # Extract topic
    topic_m = re.search(r'Topic\s*(\d+)', block[:300])
    topic = f"Topic {topic_m.group(1)}" if topic_m else ""

    # Find correct answer - OCR adds artifacts like "fig", "jig" after the letter(s)
    # Real answers are like "A", "AB", "AC", "AE", "BCE" etc (no separators)
    # OCR misreads: "B" → "8", "A" → "4"
    ans_m = re.search(r'Correct\s*Answer\s*[:\.\-]?\s*([A-F48]{1,4})\s', block, re.IGNORECASE)
    if not ans_m:
        ans_m = re.search(r'Correct\s*Answer\s*[:\.\-]?\s*([A-F48](?:\s*[,]\s*[A-F48]){0,3})', block, re.IGNORECASE)
    if not ans_m:
        failed_ids.append(qid)
        continue

    answer_str = ans_m.group(1).strip().upper()
    # Replace OCR misreads
    answer_str = answer_str.replace('8', 'B').replace('4', 'A')
    # Extract only valid answer letters (A-F), but stop at first non-letter
    answers = list(dict.fromkeys(re.findall(r'[A-F]', answer_str)))  # preserve order, deduplicate
    if not answers:
        failed_ids.append(qid)
        continue

    # Sanity check: answers should only contain letters that exist as options
    # We'll validate after parsing options

    # Find the question body and options
    # Strategy: find option markers A. B. C. D. (or A) B) C) D))
    # The question text is between the header and first "A."

    # Find all option positions
    opt_positions = []
    for om in re.finditer(r'\n\s*([A-F])[\.\)]\s', block):
        opt_positions.append((om.start(), om.group(1)))

    if len(opt_positions) < 2:
        # Try without newline prefix
        opt_positions = []
        for om in re.finditer(r'(?:^|\n)\s*([A-F])[\.\)]\s', block):
            opt_positions.append((om.start(), om.group(1)))

    if len(opt_positions) < 2:
        failed_ids.append(qid)
        continue

    # Question text: from after header to first option
    header_end = block.find('\n', m.end())
    if header_end == -1:
        header_end = m.end()

    question_text = block[header_end:opt_positions[0][0]].strip()
    # Remove topic line
    question_text = re.sub(r'^Topic\s*\d+\s*\n?', '', question_text).strip()
    # Remove "Custom View Settings" or other artifacts at the start
    question_text = re.sub(r'^(?:Custom View Settings|Viewing\s+page.*?\n|Viewing\s+questions.*?\n)+', '', question_text).strip()

    # If question text is empty, the question might be merged into the first option text
    # Check if there are duplicate option letters (like two "A"s)
    opt_letters = [p[1] for p in opt_positions]

    # Find the answer line position to limit option extraction
    ans_pos = ans_m.start()

    # Handle cases where question text got merged into first option
    if not question_text and len(opt_positions) >= 2:
        # Check if first two options both have letter "A"
        if opt_letters[0] == 'A' and (len(opt_letters) < 2 or opt_letters[1] == 'A'):
            # First "A" is actually the question text
            second_a_pos = opt_positions[1][0] if len(opt_positions) > 1 else ans_pos
            question_text = block[opt_positions[0][0]:second_a_pos].strip()
            question_text = re.sub(r'^A[\.\)]\s*', '', question_text).strip()
            opt_positions = opt_positions[1:]

    # Check for duplicate first letters more carefully
    # If we have A, A, B, C, D -> first A is question text
    if len(opt_positions) >= 2:
        letters_seen = []
        real_opts_start = 0
        for idx, (pos, letter) in enumerate(opt_positions):
            if pos >= ans_pos:
                break
            if letter in letters_seen:
                # This is the real start of options
                real_opts_start = idx
                # Everything before this is question text (if we don't have it)
                if not question_text or len(question_text) < 20:
                    q_text_block = block[opt_positions[0][0]:pos].strip()
                    q_text_block = re.sub(r'^[A-F][\.\)]\s*', '', q_text_block).strip()
                    if len(q_text_block) > len(question_text):
                        question_text = q_text_block
                    opt_positions = opt_positions[idx:]
                break
            letters_seen.append(letter)

    # Extract options
    options = []
    for i, (pos, letter) in enumerate(opt_positions):
        if pos >= ans_pos:
            break
        # Option text extends to next option or answer line
        end_pos = opt_positions[i+1][0] if i+1 < len(opt_positions) and opt_positions[i+1][0] < ans_pos else ans_pos
        opt_text = block[pos:end_pos].strip()
        # Remove the letter prefix
        opt_text = re.sub(r'^[A-F][\.\)]\s*', '', opt_text).strip()
        opt_text = opt_text.replace('\n', ' ')
        opt_text = re.sub(r'\s+', ' ', opt_text)
        # Clean trailing artifacts
        opt_text = re.sub(r'\s*(Reveal|Correct|Community|Denetl|Binary|Most Voted).*$', '', opt_text, flags=re.IGNORECASE).strip()

        if opt_text and letter not in [o['letter'] for o in options]:
            options.append({"letter": letter, "text": opt_text})

    if len(options) < 2 or not question_text or len(question_text) < 10:
        failed_ids.append(qid)
        continue

    # Clean question text
    question_text = question_text.replace('\n', ' ')
    question_text = re.sub(r'\s+', ' ', question_text).strip()

    # Validate answers against available options
    valid_letters = {o['letter'] for o in options}
    answers = [a for a in answers if a in valid_letters]
    if not answers:
        failed_ids.append(qid)
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

print(f"Parsed {len(questions)} questions")
print(f"Failed to parse {len(failed_ids)} question IDs")
if failed_ids[:20]:
    print(f"Failed IDs (first 20): {failed_ids[:20]}")

# Show some stats
topics = set(q['topic'] for q in questions)
print(f"Topics: {sorted(topics)}")
print(f"ID range: {questions[0]['id']} - {questions[-1]['id']}")

# Distribution of option counts
from collections import Counter
opt_counts = Counter(len(q['options']) for q in questions)
print(f"Options distribution: {dict(opt_counts)}")

# Distribution of answer counts (single vs multi)
ans_counts = Counter(len(q['answer']) for q in questions)
print(f"Answer count distribution: {dict(ans_counts)}")

# Verify sample questions
for q in questions[:3]:
    print(f"\n--- Q#{q['id']} ({q['topic']}) ---")
    print(f"Q: {q['question'][:100]}...")
    print(f"Options: {len(q['options'])} ({', '.join(o['letter'] for o in q['options'])})")
    print(f"Answer: {q['answer']}")

# Save as JS file
with open(output_path, 'w', encoding='utf-8') as f:
    f.write('const QUESTIONS_DATA = ')
    json.dump(questions, f, ensure_ascii=False, indent=2)
    f.write(';\n')

print(f"\nSaved to {output_path}")
