import json
import re
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ROOT = Path(__file__).resolve().parents[1]
IMAGE_DIR = ROOT / 'data' / 'raw' / 'henan' / '2024'
OUTPUT = ROOT / 'data' / 'henan-2024-legacy.json'


def parse_image(path: Path, subject_group: str):
    result, _ = RapidOCR(use_cls=False)(Image.open(path).convert('RGB'))
    tokens = []
    for box, text, confidence in result or []:
        center_x = sum(point[0] for point in box) / 4
        center_y = sum(point[1] for point in box) / 4
        tokens.append({'x': center_x, 'y': center_y, 'text': text.strip(), 'confidence': confidence})
    clusters = []
    for token in sorted(tokens, key=lambda item: item['y']):
        if not clusters or abs(clusters[-1]['y'] - token['y']) > 9:
            clusters.append({'y': token['y'], 'tokens': [token]})
        else:
            clusters[-1]['tokens'].append(token)
    rows = []
    for cluster in clusters:
        ordered = sorted(cluster['tokens'], key=lambda item: item['x'])
        code = next((item['text'] for item in ordered if item['x'] < 80 and item['text'].isdigit()), '')
        school_name = ''.join(item['text'] for item in ordered if 80 <= item['x'] < 415)
        if not code:
            combined = next((item['text'] for item in ordered if item['x'] < 415 and re.match(r'^\d{4}.+', item['text'])), '')
            match = re.match(r'^(\d{4})(.+)', combined)
            if match:
                code, school_name = match.groups()
        width_scale = 812 / Image.open(path).width
        score_text = next((item['text'] for item in ordered if 620 <= item['x'] * width_scale < 720 and item['text'].isdigit()), '')
        rank_text = next((item['text'] for item in ordered if item['x'] * width_scale >= 720 and item['text'].isdigit()), '')
        if not code or not school_name or not score_text or not rank_text:
            continue
        score = int(score_text)
        rank = int(rank_text)
        if not 400 <= score <= 750 or rank <= 0:
            continue
        rows.append({
            'schoolCode': code,
            'schoolName': school_name,
            'score': score,
            'rank': rank,
            'subjectGroup': subject_group,
            'sourceImage': path.name,
            'confidence': min(item['confidence'] for item in ordered),
        })
    return rows


if __name__ == '__main__':
    existing = json.loads(OUTPUT.read_text(encoding='utf-8')) if OUTPUT.exists() else []
    records = parse_image(IMAGE_DIR / 'liberal.png', '文科')
    science_records = [row for row in existing if row['subjectGroup'] == '理科']
    if not science_records:
        for image_path in sorted(IMAGE_DIR.glob('science-*.png')):
            science_records.extend(parse_image(image_path, '理科'))
    records.extend(science_records)
    OUTPUT.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({
        'total': len(records),
        'liberal': sum(row['subjectGroup'] == '文科' for row in records),
        'science': sum(row['subjectGroup'] == '理科' for row in records),
    }, ensure_ascii=False))
