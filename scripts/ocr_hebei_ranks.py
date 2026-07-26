import json
import re
import argparse
from pathlib import Path

from PIL import Image
from pypdf import PdfReader
from rapidocr_onnxruntime import RapidOCR

ROOT = Path(__file__).resolve().parents[1]
def parse_page(page_number: int, image: Image.Image):
    scale = 0.65
    resized = image.convert('RGB').resize((int(image.width * scale), int(image.height * scale)))
    result, _ = RapidOCR(use_cls=False)(resized)
    tokens = []
    for box, text, confidence in result or []:
        center_x = sum(point[0] for point in box) / 4 / scale
        center_y = sum(point[1] for point in box) / 4 / scale
        digits = re.sub(r'\D', '', text)
        if digits:
            tokens.append({'x': center_x, 'y': center_y, 'value': int(digits), 'confidence': confidence})

    clusters = []
    for token in sorted(tokens, key=lambda item: item['y']):
        if not clusters or abs(clusters[-1]['y'] - token['y']) > 20:
            clusters.append({'y': token['y'], 'tokens': [token]})
        else:
            clusters[-1]['tokens'].append(token)
    rows = []
    for cluster in clusters:
        columns = [None, None, None, None, None]
        boundaries = [0, 440, 690, 950, 1210, 1587]
        for token in sorted(cluster['tokens'], key=lambda item: item['x']):
            index = next((i for i in range(5) if boundaries[i] <= token['x'] < boundaries[i + 1]), None)
            if index is not None:
                columns[index] = token['value']
        score, _, physics_rank, _, history_rank = columns
        if score is None or not 140 <= score <= 750:
            continue
        if physics_rank is None and history_rank is None:
            continue
        rows.append({'score': score, 'physicsRank': physics_rank, 'historyRank': history_rank})
    return {'page': page_number, 'rows': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, required=True)
    args = parser.parse_args()
    pdf_path = ROOT / 'data' / 'raw' / 'hebei' / str(args.year) / 'score-ranks.pdf'
    page_dir = ROOT / '.scratch' / f'hebei-{args.year}-rank-pages'
    checkpoint_dir = ROOT / '.scratch' / f'hebei-{args.year}-rank-ocr'
    output = ROOT / 'data' / f'hebei-{args.year}-ranks.json'
    page_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(pdf_path))
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        checkpoint = checkpoint_dir / f'{index:02d}.json'
        if checkpoint.exists():
            parsed = json.loads(checkpoint.read_text(encoding='utf-8'))
        else:
            embedded = page.images[0]
            image_path = page_dir / f'{index:02d}.png'
            image_path.write_bytes(embedded.data)
            parsed = parse_page(index, embedded.image)
            checkpoint.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding='utf-8')
        pages.append(parsed)
        print(json.dumps({'page': index, 'rows': len(parsed['rows'])}, ensure_ascii=False), flush=True)
    records = [row for page in pages for row in page['rows']]
    records.sort(key=lambda item: item['score'], reverse=True)
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'pages': len(pages), 'records': len(records)}, ensure_ascii=False))
